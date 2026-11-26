// Whether an action can run now: whether running it, as its key or `perform` runs it, would change
// the design, the selection or what it is in (a group gone into, a crop, a path's points, the text
// being typed in), the picked frame, the camera, the tool, the rulers, the hidden layers shown or
// the remembered values. It reads the rules the actions run by, never runs them: a step tried and
// cancelled still reaches other tabs as a preview, tells notices and moves the camera. A tab that
// may only view has only the actions that view. It reads what layers can move, not where they are:
// the zoom rows are ready whatever the camera, Select all whatever is selected on a page with
// frames, and align and distribute on layers that can move, even when they are lined up already;
// the arrows on any layer not locked in place, even at a flow's end.
// Each rule it reads has its home beside the code that acts on it.
import type { Session } from '@dazbee/doc'
import { type Design, type Layer, styleOf } from '@dazbee/schema'

import { cropItemOf, type EditorActions, TOOL_ACTIONS } from './actions.ts'
import type { EditorView } from './canvas/view.ts'
import { type Remembered, styleKept } from './clipboard.ts'
import type { EditorPngCopy } from './export/png-copy.ts'
import { actsOnConnector, actsOnItem } from './frame-actions.ts'
import type { EditorPen } from './gestures/pen/pen.ts'
import { lineUpOf, SPREAD_MIN } from './layers/arrange.ts'
import { layoutChangeOf, whyNotLaidOut } from './layers/box-layout.ts'
import { type EditorBoxes, lockedInPlace } from './layers/boxes.ts'
import { flipReady } from './layers/flip.ts'
import { sharedImageFill } from './layers/photo-fill.ts'
import { type SameBy, sameByOf, selectedSame } from './layers/select-same.ts'
import { stackEnds } from './layers/stack-ends.ts'
import { wrapStateOf } from './layers/wrap-state.ts'
import { deletesAll, type EditorLinkedCopies, isLinkedAction, type LinkedAction } from './linked-copies.ts'
import type { EditorPlace } from './place.ts'
import { goInWay, layerBeside, typingAllOf } from './reach.ts'
import { type EditorSelection, idsOf, parentsOfSelected, type Picked } from './selection.ts'
import { NUDGES, type ShortcutAction, type StageAction, viewAction } from './shortcuts.ts'
import { isStyleToggle, type StyleToggle } from './text/text-edit.ts'
import type { EditorTextStyles } from './text/text-styles.ts'
import type { EditorTyping } from './text/typing.ts'
import type { EditorTools } from './tools.ts'

export interface ActionReadyDeps {
  session: Pick<Session, 'design' | 'readOnly' | 'canUndo' | 'canRedo'>
  /** Where the copied style is kept on this device, which Copy style would keep again. */
  remembered: Remembered
  view: Pick<EditorView, 'frameOf' | 'frames'>
  tools: Pick<EditorTools, 'tool'>
  selection: Pick<EditorSelection, 'current' | 'pickedFrame' | 'pickedItem' | 'cropping' | 'pathEditing'>
  boxes: Pick<EditorBoxes, 'roots' | 'rootsByFrame' | 'cropTarget'>
  pen: Pick<EditorPen, 'drawing'>
  typing: Pick<EditorTyping, 'editing' | 'selectedText'>
  actions: Pick<EditorActions, 'ungroupState' | 'wrapState' | 'maskState'>
  linked: Pick<EditorLinkedCopies, 'menu'>
  textStyles: Pick<EditorTextStyles, 'state'>
  place: Pick<EditorPlace, 'canCopy' | 'canPasteLayers'>
  /** What Copy as PNG draws. */
  pngCopy: Pick<EditorPngCopy, 'pngToCopy'>
  /** Whether the hidden layers shown would turn on or off now (`hiddenToggles`, where they may show). */
  hiddenToggles: () => boolean
}

export interface EditorActionReady {
  /**
   * Whether an action can run now: in a tab that may only view, only an action that views
   * (`viewAction`); else whether running it now changes the design, the selection, the picked
   * frame, the camera, the tool, the rulers or the remembered values. Copy has something to copy,
   * Cut has that and Delete is ready, Paste has layers kept, Pick a colour has a selection or a
   * picked frame to pick for; the shortcuts list and Quick actions always open.
   */
  actionReady(action: ShortcutAction): boolean
}

/** The rows that change only the camera, so always do something: the zooms. */
const VIEW_ROWS: ReadonlySet<StageAction> = new Set(['zoomIn', 'zoomOut', 'zoomToFit', 'zoomToSelection', 'zoomTo100'])
/** The end of its stack each layer-order row has nothing to do at. */
const REORDER_ENDS: Partial<Record<StageAction, 'front' | 'back'>> = {
  bringForward: 'front',
  bringToFront: 'front',
  sendBackward: 'back',
  sendToBack: 'back',
}
const ALIGNS: ReadonlySet<StageAction> = new Set([
  'alignLeft',
  'alignCentre',
  'alignRight',
  'alignTop',
  'alignMiddle',
  'alignBottom',
])
const SPREADS: ReadonlySet<StageAction> = new Set(['distributeHorizontal', 'distributeVertical'])
const COMBINES: ReadonlySet<StageAction> = new Set([
  'booleanUnion',
  'booleanSubtract',
  'booleanIntersect',
  'booleanExclude',
])

export function editorActionReady({
  session,
  remembered,
  view: { frameOf, frames },
  tools,
  selection,
  boxes,
  pen,
  typing,
  actions,
  linked,
  textStyles,
  place,
  pngCopy,
  hiddenToggles,
}: ActionReadyDeps): EditorActionReady {
  function actionReady(action: ShortcutAction): boolean {
    if (session.readOnly() && !viewAction(action)) return false
    switch (action) {
      // The page opens these: a card, a flyout or a list. Save version opens the Versions card's form, never
      // in a tab that may only view (above).
      case 'findReplace':
      case 'saveVersion':
      case 'showVersions':
      case 'assets':
      case 'shortcuts':
      case 'quickActions':
        return true
      case 'copy':
        return place.canCopy()
      // The page copies the picked frame, or the layers Copy takes when they draw something, as a PNG.
      case 'copyPng':
        return pngCopy.pngToCopy() !== null
      case 'cut':
        return place.canCopy() && (typing.editing() !== null || stageReady('delete'))
      case 'paste':
        return place.canPasteLayers()
      case 'pickColour':
        // The page picks for the selection's Colour, or the picked frame's Background (eyedropper.tsx).
        return idsOf(selection.current()).length > 0 || selection.pickedFrame() !== null
      default:
        return stageReady(action)
    }
  }

  /** As `perform` sends an action: undo and redo, the linked-copy actions, the text styles, Select all with same, then the rest. */
  function stageReady(action: StageAction): boolean {
    // Undo and redo first end the pen's path and typing, which is something done.
    if (action === 'undo') return session.canUndo() || pen.drawing() || typing.editing() !== null
    if (action === 'redo') return session.canRedo() || pen.drawing() || typing.editing() !== null
    if (isLinkedAction(action)) return linkedReady(action)
    if (isStyleToggle(action)) return styleReady(action)
    const same = sameByOf(action)
    if (same) return sameReady(same)
    return actionsReady(action)
  }

  /** As the linked-copy actions run: each item of the full menu ready, Copy style keeping a new style. */
  function linkedReady(action: LinkedAction) {
    const menu = linked.menu()
    if (!menu) return false
    switch (action) {
      case 'copyStyle': {
        const node = session.design().nodes[idsOf(selection.current())[0] ?? '']
        return menu.copyStyle === 'ready' && node !== undefined && !styleKept(remembered, styleOf(node as Layer))
      }
      case 'pasteStyle':
        return menu.pasteStyle === 'ready'
      case 'styleToLinked':
        return menu.style === 'ready'
      case 'textToLinked':
        return menu.text === 'ready'
      case 'layerToLinked':
        return menu.layer === 'ready'
      case 'deleteLinked':
        return menu.delete === 'ready'
      case 'lockLinked':
      case 'hideLinked':
        return true
    }
  }

  /** As Select all with same runs: the selection it makes differs from the one there is. */
  function sameReady(by: SameBy) {
    const current = selection.current()
    return current !== null && selectedSame(session.design(), current, by) !== null
  }

  /** As the text styles run: a text to act on, whose family has the weight Bold would write. */
  function styleReady(toggle: StyleToggle) {
    const state = textStyles.state()
    return state !== null && !state[toggle].disabled
  }

  /** As the actions run (`editorActions`' `perform`), in the same order. */
  function actionsReady(action: StageAction): boolean {
    // Enter, Escape and the crop item end the pen's path, a crop and a path's points.
    const ends = action === 'deselect' || action === 'goIn' || action === 'editPoints'
    const editingPath = selection.pathEditing()
    if (ends && (pen.drawing() || selection.cropping() || editingPath)) return true
    if (editingPath && action === 'delete') return editingPath.selected.length > 0
    if (action === 'deselect' && tools.tool() !== 'select') return true
    if (VIEW_ROWS.has(action) || action === 'toggleRulers') return true
    if (action === 'toggleHiddenShown') return hiddenToggles()
    // Select all selects in some frame of the shown page, whatever is selected; a page with none has nothing.
    if (action === 'selectAll') return frames().length > 0
    const tool = TOOL_ACTIONS[action]
    if (tool) return tools.tool() !== tool
    const current = selection.current()
    const picked = selection.pickedItem()
    if (picked !== null && !current) return picked.kind === 'connector' ? actsOnConnector(action) : actsOnItem(action)
    const frame = current && frameOf(current[0]?.frameId)
    if (!current || !frame) return false
    return selectedReady(action, current, session.design())
  }

  /** As the actions run on selected layers. */
  function selectedReady(action: StageAction, current: readonly Picked[], design: Design): boolean {
    const ids = idsOf(current)
    const end = REORDER_ENDS[action]
    if (end) return !stackEnds(design, ids)[end]
    if (ALIGNS.has(action)) return linesUp(design, 1)
    if (SPREADS.has(action)) return linesUp(design, SPREAD_MIN)
    if (COMBINES.has(action)) return combines(design)
    if (NUDGES[action]) return boxes.roots(design).some((id) => !lockedInPlace(design, id))
    switch (action) {
      case 'selectLinkedCopies':
        return linked.menu()?.select === 'ready'
      case 'deselect':
      case 'duplicate':
      case 'lock':
      case 'hide':
        return true
      case 'delete':
        // Delete runs in each frame where it takes all the selected layers.
        return boxes.rootsByFrame(design).some(({ ids }) => deletesAll(design, ids))
      case 'group':
        return actions.wrapState() === 'ready'
      case 'boxSelection':
        return wrapStateOf(design, boxes.rootsByFrame(design), 'box') === 'ready'
      case 'autoLayout':
        return whyNotLaidOut(design, boxes.rootsByFrame(design)) === null
      case 'layoutFree':
        return layoutChangeOf(design, boxes.roots(design), 'free').does === 'set'
      case 'ungroup':
        return actions.ungroupState() === 'ready'
      case 'flipHorizontal':
      case 'flipVertical':
        return flipReady(design, boxes.rootsByFrame(design))
      case 'mask': {
        const state = actions.maskState()
        return state !== null && !state.why
      }
      case 'goOut':
        return parentsOfSelected(current, design).length > 0
      case 'nextLayer':
      case 'previousLayer':
        return layerBeside(current, design, action === 'nextLayer' ? 1 : -1) !== null
      case 'goIn':
        return goesIn(current, design)
      case 'editPoints':
        return editsPoints(current, design)
      default:
        return false
    }
  }

  /**
   * Whether align or distribute moves a layer: in a frame, `least` of the selected layers it lines up
   * (`lineUpOf`), one of them not locked in place.
   */
  function linesUp(design: Design, least: number) {
    return boxes.rootsByFrame(design).some(({ ids }) => {
      const free = lineUpOf(design, ids)
      return free.length >= least && free.some((id) => !lockedInPlace(design, id))
    })
  }

  /**
   * Combine's rule, as the edit panel offers it and `wrapEach` runs it: some frame holds two or more
   * selected layers, which Combine wraps there; every selected layer is a graphic or a boolean; they
   * are not a photo selection (`sharedImageFill`); and they can be wrapped in a boolean.
   */
  function combines(design: Design) {
    const parts = boxes.rootsByFrame(design)
    const nodes = parts.flatMap(({ ids }) => ids.map((id) => design.nodes[id]))
    const shapes = nodes.every((node) => node?.type === 'graphic' || node?.type === 'boolean')
    const photo = sharedImageFill(nodes.map((node) => (node && 'fills' in node.props ? (node.props.fills ?? []) : [])))
    return (
      parts.some(({ ids }) => ids.length >= 2) &&
      shapes &&
      photo === null &&
      wrapStateOf(design, parts, 'boolean') === 'ready'
    )
  }

  /** Enter: into what the layers hold, typing into a text not already typed in with all its words selected, or the crop item's action. */
  function goesIn(current: readonly Picked[], design: Design) {
    const ids = idsOf(current)
    const way = goInWay(design, ids)
    if (way === 'editPoints') return editsPoints(current, design)
    if (way !== 'type') return way === 'inside'
    return !typingAllOf(design, ids[0] ?? '', typing)
  }

  /** The crop item (`cropItemOf`): an image fill to crop (`cropTarget`, as the crop starts) or a path's points to open. */
  function editsPoints(current: readonly Picked[], design: Design) {
    const frame = frameOf(current[0]?.frameId)
    const item = cropItemOf(design, idsOf(current), { readOnly: session.readOnly() })
    return frame !== undefined && item !== null && (item.path || boxes.cropTarget(frame, item.id) !== null)
  }

  return { actionReady }
}
