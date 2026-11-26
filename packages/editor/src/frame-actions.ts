// What the keys, menus and fields do to a frame or a section: the picked frame's and the picked
// section's keys (Esc, Delete, Duplicate, F2 and the arrows) and the picked connector's (Esc and
// Delete), adding a frame of a size or a size of a frame, resizing a frame by its typed size, and
// showing a frame just added.
import { descendants, round, type Session, smallerRatio } from '@dazbee/doc'
import { type Design, FRAME_GAP, freeSpot, sectionBox, sectionOf, sizeIssue } from '@dazbee/schema'

import { LABEL_ROOM } from './canvas/frames.ts'
import { OUTLINE_PAD, TITLE_ROW } from './canvas/sections.ts'
import type { EditorView } from './canvas/view.ts'
import { hug } from './layers/hug.ts'
import { listenerSet } from './listener-set.ts'
import { runQuietly } from './run-quietly.ts'
import type { EditorSelection, PickedItem } from './selection.ts'
import { NUDGES, type ShortcutAction } from './shortcuts.ts'
import type { EditorTyping } from './text/typing.ts'
import type { EditorTools } from './tools.ts'

export interface FrameActionsDeps {
  session: Session
  view: Pick<EditorView, 'page' | 'showWhole' | 'camera'>
  tools: Pick<EditorTools, 'setTool'>
  /** The name a frame added from a size takes, in the app's words. */
  frameName: (width: number, height: number) => string
  selection: Pick<EditorSelection, 'pickFrame' | 'pickedFrame' | 'pickSection' | 'pickConnector'>
  typing: Pick<EditorTyping, 'fitText'>
  /** Asks the page to rename a picked frame or section in place. */
  rename: (item: PickedItem) => void
  /** Tells that what is shown changed. */
  shownChanged: () => void
}

/** A frame's width and height. */
export interface Size {
  width: number
  height: number
}

export interface EditorFrameActions {
  /** What a key does to the picked page item, a frame, a section or a connector; false for a key that does nothing to it. */
  itemAction(action: ShortcutAction, item: PickedItem): boolean
  /**
   * Adds an empty white frame of a size to the shown page, under the name given (a size tile's) or
   * else named after the size, as one undo step, then shows it as `showAdded` does: where the frame
   * rule puts it, or with a frame in a section picked, in that section, at the free spot right of it
   * (`freeSpot`). Returns its id; null, with nothing changed, for a size past the limits.
   */
  addFrame(size: Size, name?: string): string | null
  /**
   * Add size: a frame of a size on a frame's page, named by its size, holding linked copies of its
   * layers scaled to it and placed by their constraints, no text under the readable size there
   * (`frame.addSize`), where the frame rule puts it, each text whose width the placing changed or
   * whose letters were raised fitted to its words, and the groups around it to it, as one undo step,
   * then shown as `showAdded` does. Returns its id; null, with nothing changed, for a frame gone or a size past
   * the limits.
   */
  addSize(frameId: string, size: Size): string | null
  /**
   * Resizes a frame from its top left, its layers following their constraints (`frame.resize`), each
   * text whose width that changed fitted to its words, as one undo step called `resize`. Returns
   * whether it did; false, with nothing written, for a frame gone or a size `sizeIssue` refuses.
   */
  resizeFrame(frameId: string, size: Size): boolean
  /**
   * Shows a frame just added: picks it, the select tool back, and glides to bring it whole into view
   * with its label beside the chrome along the least pan, zoomed out only when it doesn't fit
   * (`showWhole`). Nothing for a frame gone.
   */
  showAdded(frameId: string): void
  /** Calls back with a frame's name once Delete has deleted it as the picked frame, so the page can offer its undo. */
  onFrameDelete(listener: (name: string) => void): () => boolean
}

export function editorFrameActions({
  session,
  view: { page, showWhole, camera },
  tools,
  frameName,
  selection,
  typing,
  rename,
  shownChanged,
}: FrameActionsDeps): EditorFrameActions {
  /** Told of each frame Delete deleted, by its name. */
  const frameDeletes = listenerSet<[name: string]>()

  function itemAction(action: ShortcutAction, item: PickedItem): boolean {
    if (item.kind === 'connector') return connectorAction(action, item.id)
    if (!actsOnItem(action)) return false
    if (action === 'rename') rename(item)
    else if (item.kind === 'section') sectionAction(action, item.id)
    else return frameAction(action, item.id)
    return true
  }
  /**
   * What a key does to the picked frame: Esc lets it go, Delete deletes it with its layers, Mod+D
   * duplicates it, picks the copy and glides to show it whole beside the chrome (`showWhole`), and
   * the arrows move it; each is one undo step. The layers' other keys do nothing to it.
   */
  function frameAction(action: ShortcutAction, frameId: string): boolean {
    const step = NUDGES[action]
    const stored = session.design().frames[frameId]
    if (step) {
      // Another tab may have deleted the frame a moment ago; the key then does nothing.
      if (!stored) return false
      runQuietly(() => session.run('frame.update', { frameId, x: stored.x + step[0], y: stored.y + step[1] }))
    } else if (action === 'deselect') {
      selection.pickFrame(null)
    } else if (action === 'delete') {
      // A frame whose delete is refused, as a tab that may only view refuses it, stays picked.
      const deleted = stored !== undefined && runQuietly(() => session.run('frame.delete', { frameId }))
      if (deleted) frameDeletes.emit(stored.name)
      if (deleted || !stored) selection.pickFrame(null)
    } else {
      let copy = ''
      if (runQuietly(() => (copy = session.run('frame.duplicate', { frameId })))) selection.pickFrame(copy)
      const made = session.design().frames[copy]
      if (made) showWhole({ x: made.x, y: made.y, width: made.width, height: made.height })
    }
    shownChanged()
    return true
  }
  /**
   * What a key does to the picked section: Esc lets it go, Delete ungroups it, keeping its frames
   * where they are, Mod+D copies it beside itself, picks the copy and glides to show it whole, and
   * the arrows move it; each is one undo step.
   */
  function sectionAction(action: ShortcutAction, sectionId: string) {
    const step = NUDGES[action]
    // Another tab may have changed the section a moment ago; a refused key then does nothing.
    if (step) runQuietly(() => session.run('section.move', { sectionId, dx: step[0], dy: step[1] }))
    else if (action === 'deselect') selection.pickSection(null)
    // A section whose ungroup is refused stays picked.
    else if (action === 'delete') {
      if (runQuietly(() => session.run('section.ungroup', { sectionId }))) selection.pickSection(null)
    } else {
      let copy = ''
      // Far enough right that the copy's outline, the same size on screen at any zoom, clears the section's.
      const gap = FRAME_GAP + (LABEL_ROOM + TITLE_ROW + 2 * OUTLINE_PAD) / camera().zoom
      if (runQuietly(() => (copy = session.run('section.duplicate', { sectionId, gap })))) selection.pickSection(copy)
      const box = sectionBox(session.design(), copy)
      if (box) showWhole(box)
    }
    shownChanged()
  }

  /**
   * What a key does to the picked connector: Esc lets it go, and Delete deletes it, one undo step;
   * its other keys do nothing to it.
   */
  function connectorAction(action: ShortcutAction, connectorId: string) {
    if (!actsOnConnector(action)) return false
    if (action === 'deselect') selection.pickConnector(null)
    // A connector whose delete is refused, as a tab that may only view refuses it, stays picked.
    else if (runQuietly(() => session.run('connector.delete', { connectorId }))) selection.pickConnector(null)
    shownChanged()
    return true
  }

  function addFrame({ width, height }: Size, name = frameName(width, height)) {
    const now = session.design()
    const sectionId = sectionOf(now, selection.pickedFrame() ?? '')
    const box = sectionId === undefined ? undefined : sectionBox(now, sectionId)
    const pageId = page()
    // In the picked frame's section: beside it, where a copy of one of its frames would go.
    const at = box && sectionId ? { ...freeSpot(now, pageId, { width, height }, box, sectionId), sectionId } : {}
    return added(() => session.run('frame.add', { pageId, name, width, height, ...at }))
  }

  function addSize(frameId: string, { width, height }: Size) {
    const before = session.design()
    const scaled = scaledTexts(before, frameId, { width, height })
    return added(() =>
      session.gesture('addSize', () => {
        const id = session.run('frame.addSize', { frameId, width, height })
        const now = session.design()
        // A fixed box isn't fitted to its words, so the groups around one the placing changed are fitted to it here.
        const fixed: string[] = []
        for (const copy of descendants(now, id)) {
          const node = now.nodes[copy]
          const was = node?.type === 'text' ? scaled.get(node.link) : undefined
          if (node?.type !== 'text' || !was) continue
          if (node.props.width === was.width && node.props.style.fontSize === was.fontSize) continue
          typing.fitText(copy)
          if (node.props.boxMode === 'fixed') fixed.push(copy)
        }
        hug(session, fixed)
        return id
      }),
    )
  }

  function resizeFrame(frameId: string, { width, height }: Size) {
    const design = session.design()
    if (!design.frames[frameId] || sizeIssue(width, height)) return false
    // The design is live: the widths are kept as they are before the resize changes them.
    const before = new Map(descendants(design, frameId).map((id) => [id, design.nodes[id]?.props.width]))
    return runQuietly(() =>
      session.gesture('resize', () => {
        session.run('frame.resize', { frameId, width, height })
        fitResizedTexts(session.design(), frameId, (id) => before.get(id), typing.fitText)
      }),
    )
  }

  function showAdded(frameId: string) {
    const made = session.design().frames[frameId]
    if (!made) return
    tools.setTool('select')
    selection.pickFrame(frameId)
    showWhole({ x: made.x, y: made.y, width: made.width, height: made.height })
    shownChanged()
  }

  /** Runs a command that adds a frame and shows the frame: its id, or null when the command refused. */
  function added(add: () => string): string | null {
    let id = ''
    if (!runQuietly(() => (id = add()))) return null
    showAdded(id)
    return id
  }

  return {
    itemAction,
    addFrame,
    addSize,
    resizeFrame,
    showAdded,
    onFrameDelete: frameDeletes.on,
  }
}

/**
 * Fits to its words, with `fitText`, each text under a frame in `design` whose width differs from
 * the one `widthBefore` gives it, as a step that resized the frame's layers left it: the width
 * stays, and the height follows its words where it grows with them. A text `widthBefore` gives no
 * width for is left as it is.
 */
export function fitResizedTexts(
  design: Design,
  frameId: string,
  widthBefore: (id: string) => number | undefined,
  fitText: (id: string) => void,
) {
  for (const id of descendants(design, frameId)) {
    const node = design.nodes[id]
    const was = widthBefore(id)
    if (node?.type === 'text' && was !== undefined && node.props.width !== was) fitText(id)
  }
}

/** Whether a key acts on the picked frame or section while no layer is selected: Esc, Delete, Duplicate, F2 and the arrows. */
export function actsOnItem(action: ShortcutAction) {
  return (
    action === 'deselect' ||
    action === 'delete' ||
    action === 'duplicate' ||
    action === 'rename' ||
    NUDGES[action] !== undefined
  )
}

/** Whether a key acts on the picked connector while no layer is selected: Esc and Delete. */
export function actsOnConnector(action: ShortcutAction) {
  return action === 'deselect' || action === 'delete'
}

/**
 * The width and font size each text of a frame takes from Add size's scale to `size` alone, before
 * its constraints place it or its letters are raised to the readable size, by its link id, which its
 * copy shares.
 */
function scaledTexts(design: Design, frameId: string, size: Size): Map<string, { width: number; fontSize: number }> {
  const frame = design.frames[frameId]
  const texts = new Map<string, { width: number; fontSize: number }>()
  if (!frame) return texts
  const s = smallerRatio({ from: frame, to: size })
  for (const id of descendants(design, frameId)) {
    const node = design.nodes[id]
    if (node?.type === 'text')
      texts.set(node.link, { width: round(node.props.width * s), fontSize: round(node.props.style.fontSize * s) })
  }
  return texts
}
