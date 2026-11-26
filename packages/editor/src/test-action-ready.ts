// The invariant `actionReady` is held to, for its tests: from a state of an editor, each row of the
// shortcut table is asked whether it is ready and then run; one not ready changes nothing and tells
// no notice but the two that explain a key's no-op, and one ready changes something. The editor is
// put back between runs. The page's actions are held against the clipboard's own answers.
import { type ShortcutAction, SHORTCUTS } from './shortcuts.ts'
import type { TestEditor } from './test-editor.ts'
import { sortedJson } from './test-matrix/index.ts'

/** A state of the grid: how to bring an editor to it from nothing selected on the page it opened on. */
export interface State {
  name: string
  setup: (ed: TestEditor) => void
}

/** What runs of a state found: each disagreement, and how many runs found the action ready and not. */
export interface Found {
  wrong: string[]
  ready: number
  notReady: number
}

/** The remembered values the editor keeps, by key: the last copy and the copied style. */
export const REMEMBERED = ['dazbee.copiedLayers', 'dazbee.copiedStyle']
/** The rows that move the view whatever is shown, ready even when the view is already there. */
const ZOOMS = new Set<ShortcutAction>(['zoomIn', 'zoomOut', 'zoomToFit', 'zoomToSelection', 'zoomTo100'])
/** The notices that explain why a key did nothing; no other may come of an action that is not ready. */
const EXPLAINING = new Set(['refused', 'placedByLayout'])
/**
 * The rows that read what can move, not where it is (action-ready.ts): align and distribute on
 * layers lined up already, and the arrows on a layer at a flow's end, are ready and change nothing.
 */
const MOVES = new Set<ShortcutAction>(
  SHORTCUTS.filter(({ group }) => group === 'align' || group === 'move').map(({ action }) => action),
)

/**
 * Runs every row of the table from a state, each from the state afresh, putting the editor back
 * after each. With `still`, the rows that read what can move (`MOVES`) may be ready and change nothing.
 */
export function runState(ed: TestEditor, state: State, { still = false } = {}): Found {
  const opened = {
    design: sortedJson(ed.core.design()),
    camera: JSON.stringify(ed.core.camera()),
    rulers: ed.core.rulers(),
    page: ed.core.shownPage(),
  }
  const found: Found = { wrong: [], ready: 0, notReady: 0 }
  for (const { action } of SHORTCUTS) {
    state.setup(ed)
    ed.core.redraw()
    const { ready, why } = runOne(ed, action)
    found[ready ? 'ready' : 'notReady']++
    if (why && !(still && why === 'ready, changed nothing' && MOVES.has(action))) found.wrong.push(`${action} ${why}`)
    try {
      reset(ed, opened)
    } catch (error) {
      throw new Error(`${state.name}: ${action}: ${String(error)}`, { cause: error })
    }
  }
  return found
}

/** Whether an action was ready, and what running it did against that; no `why` when they agree. */
function runOne(ed: TestEditor, action: ShortcutAction): { ready: boolean; why?: string } {
  const { core, clipboard, told } = ed
  const ready = core.actionReady(action)
  const before = snapshot(ed)
  const designBefore = JSON.stringify(core.design())
  const notices = told.length
  let did: boolean
  if (action === 'copy') did = clipboard.copy() !== null
  // The page copies what Copy as PNG draws, or says it is too big.
  else if (action === 'copyPng') did = ed.modules.pngCopy.pngToCopy() !== null
  else if (action === 'cut') did = clipboard.cut() !== null && JSON.stringify(core.design()) !== designBefore
  else if (action === 'paste') did = core.pasteLayers()
  else if (
    action === 'findReplace' ||
    action === 'showVersions' ||
    action === 'assets' ||
    action === 'shortcuts' ||
    action === 'quickActions'
  )
    did = true
  // The page opens the Versions card's save form, which a tab that may only view never has.
  else if (action === 'saveVersion') did = !core.readOnly()
  // The page starts picking for the selection's Colour or the picked frame's Background, as Shift+I
  // does (eyedropper.tsx); with neither, or in a tab that may only view, it does nothing.
  else if (action === 'pickColour')
    did = !core.readOnly() && (core.selection().length > 0 || core.pickedFrame() !== null)
  else {
    core.perform(action)
    did = snapshot(ed) !== before
    const unexplained = told.slice(notices).filter(([notice]) => !EXPLAINING.has(notice))
    if (!ready && unexplained.length > 0)
      return { ready, why: `not ready, told ${unexplained.map(([n]) => n).join(', ')}` }
    if (ZOOMS.has(action)) return ready ? { ready } : { ready, why: 'a zoom row not ready' }
  }
  if (ready && !did) return { ready, why: 'ready, changed nothing' }
  if (!ready && did) return { ready, why: 'not ready, changed something' }
  return { ready }
}

/** An editor at rest with nothing selected on the page it opened on: what an action left open ends, and what it changed is put back. */
function reset(ed: TestEditor, opened: { design: string; camera: string; rulers: boolean; page: string }) {
  const { core, modules, remembered } = ed
  core.settle()
  if (core.gesturing()) throw new Error('a gesture is left open')
  modules.selection.crop(null)
  modules.selection.editPath(null)
  while (sortedJson(core.design()) !== opened.design && core.canUndo()) core.perform('undo')
  if (sortedJson(core.design()) !== opened.design) throw new Error('the design could not be put back')
  core.select([])
  modules.selection.enter(null)
  core.pickFrame(null)
  core.renamed()
  core.setTool('select')
  if (core.shownPage() !== opened.page) core.showPage(opened.page)
  if (core.rulers() !== opened.rulers) core.perform('toggleRulers')
  core.setHiddenShown(false)
  core.setCamera(JSON.parse(opened.camera))
  remembered.clear()
  core.redraw()
}

/** Everything an action may change: the design, the selection and its modes, the picked page item and its rename, the page, the camera, the tool, the rulers, the hidden layers shown, the history and the remembered values. */
function snapshot(ed: TestEditor) {
  const { core, modules, remembered } = ed
  return JSON.stringify({
    design: core.design(),
    selection: modules.selection.current(),
    entered: modules.selection.entered(),
    picked: modules.selection.pickedItem(),
    renaming: [modules.selection.renamingFrame(), modules.selection.renamingSection()],
    crop: modules.selection.cropping(),
    path: modules.selection.pathEditing(),
    typing: modules.typing.editing(),
    range: modules.typing.selectedText(),
    page: core.shownPage(),
    camera: core.camera(),
    tool: core.tool(),
    armed: core.imageArmed(),
    rulers: core.rulers(),
    hidden: core.hiddenShown(),
    history: [core.canUndo(), core.canRedo(), core.undoName(), core.redoName()],
    remembered: REMEMBERED.map((key) => remembered.get(key) ?? null),
  })
}
