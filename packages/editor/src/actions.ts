// What the shortcuts and the menus do to the selection, the picked frame and the view: delete,
// group, mask, box, auto layout, combine, reorder, lock and hide, align and distribute, nudge,
// duplicate, select all, zoom and the tools.
import type { Session } from '@dazbee/doc'
import { descendants, flowLayoutOf } from '@dazbee/doc'
import { type Design, LOCK_FLAGS, type Rect } from '@dazbee/schema'

import { withCopies } from './across-frames.ts'
import type { Frame } from './canvas/frames.ts'
import type { FrameScenes } from './canvas/scenes.ts'
import type { EditorView } from './canvas/view.ts'
import type { CoreOptions, NoticeDetail } from './core-interface.ts'
import type { EditorFrameActions } from './frame-actions.ts'
import type { EditorCropping } from './gestures/crop/cropping.ts'
import type { EditorPen } from './gestures/pen/pen.ts'
import type { EditorAutoLayoutDrag } from './gestures/select/auto-layout-drag.ts'
import type { EditorTransformDrag } from './gestures/select/transform-drag.ts'
import { align, type Alignment, distribute, type Distribution, lineUpOf, type Offset } from './layers/arrange.ts'
import { type EditorBoxLayout, layOutWayOf, whyNotLaidOut } from './layers/box-layout.ts'
import { type EditorBoxes, visibleIn } from './layers/boxes.ts'
import { deleteLayers, setHidden } from './layers/delete-hide.ts'
import type { EditorDuplicate } from './layers/duplicate.ts'
import { flipAxisOf, flipLayers } from './layers/flip.ts'
import { hug as hugIn } from './layers/hug.ts'
import { maskPart, type MaskState, maskStateOf, runMaskPart } from './layers/masks.ts'
import { boundsOf, type Box, round } from './layers/transform.ts'
import { ungroupable, type UngroupState, ungroupStateOf } from './layers/ungroup.ts'
import { whyNotWrapped, type WrapState, wrapStateOf } from './layers/wrap-state.ts'
import { type EditorReach, goInAction } from './reach.ts'
import { runQuietly } from './run-quietly.ts'
import { type EditorSelection, firstFrameOf, idsOf, isPath, pairsIn, type Picked, selectInto } from './selection.ts'
import { NUDGES, type StageAction } from './shortcuts.ts'
import type { EditorTools, Tool } from './tools.ts'

export interface ActionsDeps {
  session: Session
  view: Pick<
    EditorView,
    | 'design'
    | 'frameOf'
    | 'page'
    | 'nearestFrame'
    | 'fitAll'
    | 'fitArea'
    | 'zoomTo'
    | 'zoomIn'
    | 'zoomOut'
    | 'toggleRulers'
    | 'viewChanged'
  >
  tools: Pick<EditorTools, 'tool' | 'setTool'>
  selection: Pick<
    EditorSelection,
    | 'current'
    | 'entered'
    | 'lastFrameOn'
    | 'pickedFrame'
    | 'pickedItem'
    | 'cropping'
    | 'pathEditing'
    | 'select'
    | 'selectAcross'
    | 'enter'
    | 'pickFrame'
    | 'crop'
    | 'editPath'
  >
  scenes: Pick<FrameScenes, 'scene'>
  boxes: Pick<
    EditorBoxes,
    | 'roots'
    | 'rootsByFrame'
    | 'startBoxes'
    | 'movedBoxes'
    | 'boxIn'
    | 'selectionBox'
    | 'pickable'
    | 'drawnInFlow'
    | 'drawnBoxOf'
    | 'drawnHolders'
    | 'drawnAlike'
  >
  pen: Pick<EditorPen, 'drawing' | 'finish' | 'deletePoints'>
  cropping: Pick<EditorCropping, 'start'>
  transformDrag: Pick<EditorTransformDrag, 'writeBoxes'>
  autoLayoutDrag: Pick<EditorAutoLayoutDrag, 'nudge'>
  boxLayout: Pick<EditorBoxLayout, 'setLayout' | 'layOutInPlace' | 'wrapInLayout' | 'box'>
  frameActions: Pick<EditorFrameActions, 'itemAction'>
  reach: Pick<EditorReach, 'goIn' | 'goOut' | 'step'>
  duplicate: Pick<EditorDuplicate, 'duplicate'>
  /**
   * Tells the app that auto layout places some of the layers an align or distribute would move, or
   * why a wrap, the mask item or a layout key changed nothing.
   */
  notify: (...told: NoticeDetail<'placedByLayout' | 'refused'>) => void
  /** Tells that what is shown changed. */
  shownChanged: () => void
  /** The name a new group, Mask group or box takes, in the app's words. */
  layerName: CoreOptions['layerName']
}

/** The tool each tool shortcut picks, whatever is selected. */
export const TOOL_ACTIONS: Readonly<Partial<Record<StageAction, Tool>>> = {
  toolSelect: 'select',
  toolHand: 'hand',
  toolFrame: 'frame',
  toolSection: 'section',
  toolRect: 'rect',
  toolEllipse: 'ellipse',
  toolBox: 'box',
  toolLine: 'line',
  toolArrow: 'arrow',
  toolPen: 'pen',
  toolText: 'text',
}

/** Where each layer-order shortcut moves the selected layers among their siblings. */
const REORDERS = {
  bringForward: 'forward',
  sendBackward: 'backward',
  bringToFront: 'front',
  sendToBack: 'back',
} as const

export interface EditorActions {
  /**
   * Does what a shortcut names. Returns whether there was anything to do it to; the keys that act
   * on the selection do nothing without one. Undo and redo are the editor's, which ends what is
   * open on the stage first: they do nothing here.
   */
  perform(action: StageAction): boolean
  /**
   * What Ungroup would do for the selection: `ready` while a selected group, box or boolean comes
   * apart with every layer of its frame staying where it is drawn; otherwise why none can, the
   * first that holds of: `locked` when one is locked against deleting, `maskLocked` when a mask one
   * would free has its style locked, `placedByLayout` when an auto layout box would place what one
   * holds elsewhere; `none` with no group, box or boolean selected.
   */
  ungroupState(): UngroupState
  /** What Group and the Box action would do for the selection (`wrapStateOf`); a group and a box wrap alike. */
  wrapState(): WrapState
  /** What the Full menu's mask item shows for the selection: Use as mask or Release mask, and why it is greyed; null when it is left out. */
  maskState(): MaskState
  /** Fits the selection in view, else the picked frame, else the shown page's frames. */
  fitSelection(): void
}

export function editorActions({
  session,
  view: {
    design: drawn,
    frameOf,
    page,
    nearestFrame,
    fitAll,
    fitArea,
    zoomTo,
    zoomIn,
    zoomOut,
    toggleRulers,
    viewChanged,
  },
  tools,
  selection,
  scenes,
  boxes,
  pen,
  cropping,
  transformDrag,
  autoLayoutDrag,
  boxLayout,
  frameActions,
  reach,
  duplicate,
  notify,
  shownChanged,
  layerName,
}: ActionsDeps): EditorActions {
  /** Groups fit what they hold again after a change inside them, in the same undo step. */
  const hug = (ids: string[]) => hugIn(session, ids)
  function fitSelection() {
    const outer = boxes.selectionBox()
    const picked = frameOf(selection.pickedFrame() ?? undefined)
    if (!outer && picked) return fitArea({ x: picked.x, y: picked.y, width: picked.width, height: picked.height })
    if (!outer) return fitAll()
    const { frame, box } = outer
    const b = boundsOf([box])
    fitArea({ x: frame.x + b.x, y: frame.y + b.y, width: b.width, height: b.height })
  }

  /**
   * Runs a change on the selected layers of each frame that holds some, the first one's frame
   * first, as one undo step: a frame where the change is refused is left as it is, its layers still
   * selected. `change` returns the layers to select in that frame, or null to keep its selected
   * layers; once any frame returns some, the selection becomes them across the frames. Returns
   * whether the change ran in any frame.
   */
  function eachFrame(change: (frame: Frame, ids: string[], now: Design) => string[] | null) {
    const next: Picked[] = []
    let selects = false
    let ran = false
    session.gesture(() => {
      for (const { frame, ids } of boxes.rootsByFrame()) {
        let picked: string[] | null = null
        const done = runQuietly(() => (picked = change(frame, ids, session.design())))
        ran ||= done
        selects ||= picked !== null
        next.push(...pairsIn(frame.id, picked ?? ids))
      }
    })
    if (selects) selection.selectAcross(next)
    return ran
  }

  const ungroupState = () => ungroupStateOf(session, boxes)
  const wrapState = () => wrapStateOf(session.design(), boxes.rootsByFrame(), 'group')

  /** Each frame's part of the mask item, by frame, judged on the design before anything runs. */
  function maskParts(now = session.design()) {
    return new Map(boxes.rootsByFrame(now).map(({ frame, ids }) => [frame.id, maskPart(now, ids)]))
  }
  const maskState = () => maskStateOf([...maskParts().values()])

  /** Combines the selected shapes into a live boolean (#44) and selects it. One undo step. */
  function combine(op: 'union' | 'subtract' | 'intersect' | 'exclude') {
    wrapEach('boolean', (ids) => session.run('node.boolean', { ids, op, drawn: boxes.drawnInFlow(ids) }))
  }
  /**
   * Wraps each frame's selected layers in one new layer of `type` that `wrap` makes, as one undo
   * step, selecting the new layers; a frame where `wrap` makes none keeps its layers selected.
   * While `wrapStateOf` finds they can't be wrapped nothing changes, and the app says why.
   */
  function wrapEach(type: 'group' | 'box' | 'boolean', wrap: (ids: string[]) => string | null) {
    const state = wrapStateOf(session.design(), boxes.rootsByFrame(), type)
    const why = whyNotWrapped(state)
    if (why) notify('refused', { why })
    else if (state === 'ready')
      eachFrame((_, ids) => {
        const made = wrap(ids)
        return made === null ? null : [made]
      })
  }

  /**
   * Shift+A: each frame's selected layers get what it does there alone (`layOutWayOf`), one Free
   * box alone laid out in place and anything else wrapped as the Box action wraps, as one undo step,
   * selecting the boxes. While a frame's can't be, nothing changes and the app says why: a lone box
   * locked against style changes, or the Box action's reason for the frames it would wrap.
   */
  function layOut() {
    const now = session.design()
    const parts = boxes.rootsByFrame(now)
    const ways = new Map(parts.map(({ frame, ids }) => [frame.id, layOutWayOf(now, ids)]))
    const why = whyNotLaidOut(now, parts)
    if (why) {
      notify('refused', { why })
      return
    }
    eachFrame(({ id }, ids) => {
      if (ways.get(id) === 'wrap') return [boxLayout.wrapInLayout(ids)]
      for (const box of ids) boxLayout.layOutInPlace(box)
      return null
    })
  }

  /**
   * Moves each selected layer, with what is inside it, by an offset worked out from the boxes
   * around them as drawn: align and distribute (#42). One undo step.
   */
  function arrange(offsets: (boxes: Rect[], within: Rect) => Offset[]) {
    const now = session.design()
    const roots = boxes.roots(now)
    const layout = flowLayoutOf(now, roots)
    if (layout) notify('placedByLayout', { layout })
    session.gesture(() => {
      for (const { frame, ids } of boxes.rootsByFrame(now)) {
        const free = lineUpOf(now, ids)
        if (free.length > 0) arrangeFree(frame, free, offsets, now)
      }
    })
  }
  /** Align or distribute layers that aren't in a flow. */
  function arrangeFree(frame: Frame, ids: string[], offsets: (boxes: Rect[], within: Rect) => Offset[], now: Design) {
    const start = boxes.startBoxes(frame, ids)
    // One layer lines up with what holds it: its group or box, or the frame.
    const parent = now.nodes[ids[0] ?? '']?.parentId
    const holder = parent && now.nodes[parent] ? boxes.boxIn(parent, now) : null
    const within = holder ?? { x: 0, y: 0, width: frame.width, height: frame.height }
    const moves = offsets(
      ids.map((id) => boundsOf([start.get(id) as Box])),
      within,
    )
    const next = new Map<string, Box>()
    ids.forEach((id, i) => {
      const { dx, dy } = moves[i] ?? { dx: 0, dy: 0 }
      for (const inner of [id, ...descendants(now, id)]) {
        const b = start.get(inner)
        if (b) next.set(inner, { ...b, x: round(b.x + dx), y: round(b.y + dy) })
      }
    })
    session.gesture(() => {
      transformDrag.writeBoxes(frame, start, next)
      hug(ids)
    })
    return true
  }
  const alignTo = (to: Alignment) => arrange((boxes, within) => align(boxes, to, within))
  const distributeAlong = (axis: Distribution) => arrange((boxes) => distribute(boxes, axis))

  /**
   * Moves the selection by whole pixels in each of its frames, every frame's layers by the same
   * amount, one undo step per press.
   */
  function nudge(dx: number, dy: number) {
    const now = session.design()
    session.gesture(() => {
      for (const { frame, ids } of boxes.rootsByFrame(now)) {
        // A tab that may only view says View only for the move refused, never a flow's end.
        if (!session.readOnly() && autoLayoutDrag.nudge(ids, dx, dy, now)) continue
        // Arrows move along the frame as drawn, also inside a turned group.
        const moved = boxes.movedBoxes(frame, ids, () => ({ x: dx, y: dy }))
        transformDrag.writeBoxes(frame, boxes.startBoxes(frame, ids), moved)
        hug(ids)
      }
    })
  }

  /**
   * Selects every top-level layer that can be picked in the selection's frame; with nothing
   * selected, in the picked frame, else the frame last selected in on the shown page, else the
   * frame nearest the middle of the view.
   */
  function selectAll() {
    const frame =
      frameOf(firstFrameOf(selection.current())) ??
      frameOf(selection.pickedFrame() ?? undefined) ??
      frameOf(selection.lastFrameOn(page()) ?? undefined) ??
      nearestFrame()
    if (!frame) return
    selection.select(
      scenes
        .scene(frame)
        .layers.filter(boxes.pickable)
        .map((layer) => layer.id),
      frame.id,
    )
  }

  /**
   * Does what a shortcut names. Returns whether there was anything to do it to; the keys that act
   * on the selection do nothing without one.
   */
  function perform(action: StageAction): boolean {
    const withoutSelection: Partial<Record<StageAction, () => void>> = {
      zoomToFit: fitAll,
      zoomToSelection: fitSelection,
      zoomTo100: () => zoomTo(1),
      zoomIn,
      zoomOut,
      selectAll,
      toggleRulers: () => {
        toggleRulers()
        shownChanged()
        viewChanged()
      },
    }
    // Enter, Escape and the crop item end the pen's path, open as it is (#45), a crop and a path's points.
    const ends = action === 'deselect' || action === 'goIn' || action === 'editPoints'
    if (pen.drawing() && ends) {
      pen.finish()
      return true
    }
    if (selection.cropping() && ends) {
      selection.crop(null)
      shownChanged()
      return true
    }
    if (selection.pathEditing()) {
      if (ends) {
        selection.editPath(null)
        shownChanged()
        return true
      }
      if (action === 'delete') {
        pen.deletePoints()
        shownChanged()
        return true
      }
    }
    // Escape in any other tool goes back to Select; the next one deselects.
    if (action === 'deselect' && tools.tool() !== 'select') {
      tools.setTool('select')
      return true
    }
    const anytime = withoutSelection[action]
    if (anytime) {
      anytime()
      return true
    }
    const tool = TOOL_ACTIONS[action]
    if (tool) {
      tools.setTool(tool)
      return true
    }
    const picked = selection.pickedItem()
    if (picked !== null && !selection.current()) return frameActions.itemAction(action, picked)
    const current = selection.current()
    const frame = current && frameOf(current[0]?.frameId)
    if (!current || !frame) return false
    const axis = flipAxisOf(action)
    if (axis) return flipLayers({ session, boxes, transformDrag }, axis)
    const selected = idsOf(current)
    const nodes = session.design().nodes
    switch (action) {
      case 'selectLinkedCopies': {
        // The linked copies of the selected layers in the shown page's other frames join them.
        const next = withCopies(current, session.design())
        if (next.length === current.length) return true
        selection.selectAcross(next)
        break
      }
      case 'deselect': {
        // Out of a group or box one level at a time: it gets selected, then nothing.
        const up = selection.entered()
        selectInto(selection, drawn(), up ? [{ id: up, frameId: frame.id }] : [])
        break
      }
      case 'delete':
        eachFrame((_, ids) => {
          deleteLayers(session, boxes, ids)
          return []
        })
        break
      case 'group':
        wrapEach('group', (ids) =>
          session.run('node.group', { ids, name: layerName('group'), drawn: boxes.drawnInFlow(ids) }),
        )
        break
      case 'alignLeft':
        alignTo('left')
        break
      case 'alignCentre':
        alignTo('centre')
        break
      case 'alignRight':
        alignTo('right')
        break
      case 'alignTop':
        alignTo('top')
        break
      case 'alignMiddle':
        alignTo('middle')
        break
      case 'alignBottom':
        alignTo('bottom')
        break
      case 'distributeHorizontal':
        distributeAlong('horizontal')
        break
      case 'distributeVertical':
        distributeAlong('vertical')
        break
      case 'goOut':
        reach.goOut()
        break
      case 'nextLayer':
      case 'previousLayer':
        reach.step(action === 'nextLayer' ? 1 : -1)
        break
      case 'goIn': {
        // Enter runs the action it names for the selection, else goes into it or types into its text.
        const runs = goInAction(session.design(), selected)
        if (runs) return perform(runs)
        if (!reach.goIn()) return false
        break
      }
      case 'editPoints': {
        // The crop item: one layer with an image fill crops, and one path goes into its points, also
        // while it is hidden or locked in place. A tab that may only view starts neither (C35), by
        // Enter, the Crop item or Fit's Crop alike.
        const item = cropItemOf(session.design(), selected, { readOnly: session.readOnly() })
        if (!item) return false
        if (cropping.start(frame, item.id)) break
        if (item.path) selection.editPath({ id: item.id, frameId: frame.id })
        else return false
        break
      }
      case 'mask': {
        // Use as mask or Release mask in each frame whose part can run; while the item is greyed,
        // nothing, and the app says why, the reason the item gives.
        const parts = maskParts()
        const state = maskStateOf([...parts.values()])
        if (!state) return false
        if (state.why) notify('refused', { why: state.why })
        else eachFrame((f) => runMaskPart(session, parts.get(f.id) ?? null, layerName('maskGroup')))
        break
      }
      case 'boxSelection':
        wrapEach('box', boxLayout.box)
        break
      case 'autoLayout':
        layOut()
        break
      case 'layoutFree': {
        // A box laid out with its style locked stays as it is, and the app says why.
        const done = boxLayout.setLayout('free')
        if (done === 'none') return false
        if (done === 'locked') notify('refused', { why: 'locked' })
        break
      }
      case 'booleanUnion':
        combine('union')
        break
      case 'booleanSubtract':
        combine('subtract')
        break
      case 'booleanIntersect':
        combine('intersect')
        break
      case 'booleanExclude':
        combine('exclude')
        break
      case 'ungroup': {
        // Boxes and booleans come apart the same way: what a box laid out stays where it is drawn,
        // and a boolean's shapes show their own paints again. In an auto layout box, a layer comes
        // apart only when what it held takes its place in the flow with nothing moving, and one
        // locked against deleting stays whole; while none can, the menus grey Ungroup with the
        // reason and its key does nothing. In a mixed selection what can come apart does, and the
        // rest stays as it is, with no notice.
        const { parts, selected: containers } = ungroupable(session, boxes)
        if (containers === 0) return false
        if (parts.every((part) => part.groups.length === 0)) return true
        const freeing = new Map(parts.map((part) => [part.frame.id, part.groups]))
        eachFrame((f, ids) => {
          const groups = freeing.get(f.id) ?? []
          if (groups.length === 0) return ids
          const freed = session.run('node.ungroup', {
            ids: groups.map((group) => group.id),
            drawn: Object.assign({}, ...groups.map((g) => g.drawn)),
          })
          return [...ids.filter((id) => !groups.some((group) => group.id === id)), ...freed]
        })
        break
      }
      case 'duplicate':
        duplicate.duplicate()
        break
      case 'bringForward':
      case 'sendBackward':
      case 'bringToFront':
      case 'sendToBack': {
        const to = REORDERS[action]
        eachFrame((_, ids) => {
          session.run('node.reorder', { ids, to })
          return null
        })
        break
      }
      case 'lock': {
        // Locks every flag, or unlocks them all when every selected layer is already locked.
        const locked = selected.every((id) => LOCK_FLAGS.every((flag) => nodes[id]?.lock?.[flag]))
        runQuietly(() =>
          session.run('node.lock', {
            ids: selected,
            lock: Object.fromEntries(LOCK_FLAGS.map((flag) => [flag, !locked])),
          }),
        )
        break
      }
      case 'hide': {
        // Hidden in its frame, its linked copies left as they are; the layer stays selected so it can be shown again.
        const shown = selected.some((id) => visibleIn(session.design(), id))
        runQuietly(() => setHidden(session, boxes, selected, shown))
        break
      }
      default: {
        const step = NUDGES[action]
        if (!step) return false
        nudge(...step)
      }
    }
    shownChanged()
    return true
  }

  return {
    perform,
    ungroupState,
    wrapState,
    maskState,
    fitSelection,
  }
}

/**
 * The layer the crop item acts on among the selected layers `ids`: the one layer, also hidden or
 * locked in place, unless its style is locked. It crops the layer's image fill when it has one to
 * crop (`cropTarget`), else opens its points when it is a path (`path`). Null for several layers,
 * one whose style is locked, or in a tab that may only view, which starts neither.
 */
export function cropItemOf(
  design: Design,
  ids: readonly string[],
  { readOnly = false }: { readOnly?: boolean } = {},
): { id: string; path: boolean } | null {
  const [only] = ids
  if (readOnly || ids.length !== 1 || only === undefined || !design.nodes[only] || design.nodes[only]?.lock?.style)
    return null
  return { id: only, path: isPath(design, only) }
}
