// The pointer on the stage: presses, drags and double-clicks, each pointer input routed to the
// behaviour that owns its gesture, with the hover outline, the deepest layer's while the deep key is
// held, and the layers under a right-click; panning and the wheel are `pan.ts`'s, the keys held
// `held-keys.ts`'s, followed from each pointer input and told to a move as Alt changes, what Alt
// measures `measuring.ts`'s, the cursor `stage-cursor.ts`'s, and what a double click does, such as
// asking to rename the frame whose label it is on, `double-click.ts`'s. A press on a frame label's
// text grabs the frame, after the selection's handles, and one on a section's title or outline line
// grabs the section, after a frame's label. A press on a ruler or a guide is the guide
// drag's (`guides/guide-drag.ts`), after the selection's handles. While a colour is picked,
// `colour-pick.ts` takes the inputs, but a pan's and the wheel.
import type { Session } from '@dazbee/doc'
import type { Point } from '@dazbee/schema'

import { toWorld } from '../canvas/camera.ts'
import type { Frame } from '../canvas/frames.ts'
import type { EditorView } from '../canvas/view.ts'
import type { EditorBoxes } from '../layers/boxes.ts'
import { type Box, localTo } from '../layers/transform.ts'
import { type EditorSelection, type HeldSelection, idsOf, samePick } from '../selection.ts'
import { deepKeyHeld, rightClick } from '../shortcuts.ts'
import { paragraphAt } from '../text/text-edit.ts'
import type { EditorTyping } from '../text/typing.ts'
import type { EditorTools } from '../tools.ts'
import type { EditorColourPick } from './colour-pick.ts'
import type { CropDrag, EditorCropping } from './crop/cropping.ts'
import { editorDoubleClick } from './double-click.ts'
import type { EditorDragStart } from './drag-start.ts'
import {
  type EditorDrawing,
  type FrameDrag,
  type ImageBoxDrag,
  isDrawing,
  type SectionDrag,
  type ShapeDrag,
  type TextBoxDrag,
} from './drawing/drawing.ts'
import { toolPress } from './drawing/tool-press.ts'
import type { EditorGuideDrag, GuideDrag } from './guides/guide-drag.ts'
import { type EditorHeldKeys, editorHeldKeys } from './held-keys.ts'
import type { Grab } from './hit-zones.ts'
import type { EditorHold } from './hold.ts'
import type { KeyInput, PointerAnswer, PointerInput } from './inputs.ts'
import { type EditorMeasuring, editorMeasuring } from './measuring.ts'
import { editorPan } from './pan.ts'
import type { EditorPen, PathDrag } from './pen/pen.ts'
import type { EditorAutoLayoutDrag, ReorderDrag } from './select/auto-layout-drag.ts'
import { type EditorFrameResize, type FrameGesture, isFrameGesture } from './select/frame-resize.ts'
import type { MoveDrag } from './select/move-drag.ts'
import type { EditorSectionMove, SectionMoveDrag } from './select/section-move.ts'
import type { EditorSelectPress } from './select/select-press.ts'
import { carried, type EditorTransformDrag, type HandleDrag, type MarqueeDrag } from './select/transform-drag.ts'
import { editorStageCursor } from './stage-cursor.ts'

/** What a drag on the stage is doing, from pointer down to up. */
export type Gesture =
  | MoveDrag
  | HandleDrag
  | ReorderDrag
  | MarqueeDrag
  | { kind: 'textSelect'; frame: Frame; around: Box[] }
  | TextBoxDrag
  | ImageBoxDrag
  | CropDrag
  | ShapeDrag
  | FrameDrag
  | SectionDrag
  | FrameGesture
  | SectionMoveDrag
  | PathDrag
  | GuideDrag

export interface PointerDeps {
  /** The press in progress, told of each press and asked on each move whether it has become a drag. */
  dragStart: EditorDragStart
  /** Holds the pointer from a press, and says after each pointer input whether one asked for it. */
  hold: EditorHold
  session: Pick<Session, 'design' | 'readOnly'>
  view: Pick<EditorView, 'camera' | 'design' | 'redraw' | 'setCamera' | 'stopGlide' | 'viewport' | 'zoomTo' | 'pointOn'>
  tools: Pick<EditorTools, 'tool' | 'setTool' | 'imageToPlace' | 'snapping'>
  selection: Pick<
    EditorSelection,
    | 'current'
    | 'hover'
    | 'hovered'
    | 'cropping'
    | 'pathEditing'
    | 'enter'
    | 'select'
    | 'selectKeepingModes'
    | 'held'
    | 'restore'
    | 'editPath'
  >
  boxes: Pick<
    EditorBoxes,
    'pickable' | 'selectionBox' | 'target' | 'lockedAt' | 'pickAt' | 'layersAt' | 'deepAt' | 'drawnBoxOf'
  >
  typing: Pick<EditorTyping, 'editing' | 'caretFromPoint' | 'caretTo' | 'selectText' | 'start' | 'stop'>
  pen: Pick<EditorPen, 'drawing' | 'down' | 'move' | 'up' | 'pressPoints' | 'pointsAt' | 'dragPoints' | 'releasePoints'>
  cropping: Pick<EditorCropping, 'start' | 'cursorAt' | 'press' | 'drag' | 'release'>
  drawing: Pick<
    EditorDrawing,
    'pressShape' | 'pressImage' | 'pressText' | 'pressFrame' | 'pressSection' | 'drag' | 'release'
  >
  transformDrag: Pick<
    EditorTransformDrag,
    | 'handleUnder'
    | 'sawPointer'
    | 'hoverDot'
    | 'marquee'
    | 'drag'
    | 'release'
    | 'clearSnapLines'
    | 'setAlt'
    | 'carries'
    | 'copiesUnmoved'
  >
  autoLayoutDrag: Pick<EditorAutoLayoutDrag, 'drag' | 'setAlt' | 'cancel' | 'release'>
  frameResize: Pick<EditorFrameResize, 'drag' | 'release' | 'handleUnder'>
  sectionMove: Pick<EditorSectionMove, 'drag' | 'release'>
  /** Guides: a press on a ruler or a guide, its drag and release, the guide under the pointer and its cursor. */
  guideDrag: Pick<EditorGuideDrag, 'press' | 'drag' | 'release' | 'hover' | 'cursorAt'>
  /** What the select tool's press picks, and what it selects once it ends as a click. */
  selectPress: EditorSelectPress
  /** Picking a colour, which takes the pointer's inputs while it is on, but a pan's and the wheel. */
  colourPick: Pick<EditorColourPick, 'route' | 'stop' | 'picking'>
  /** Asks the page to rename a frame in place, after a double click on its label, and a section, after one on its title. */
  renameFrame: (frameId: string) => void
  renameSection: (sectionId: string) => void
  /** Whether this computer is Apple's, whose deep key is ⌘ and where Ctrl with a click is the right-click. */
  onMac: () => boolean
  /** Tells that what is shown changed. */
  shownChanged: () => void
}

/** A layer that shows under a point of the stage, in its frame, how many groups, boxes and booleans deep. */
export interface LayerAt {
  id: string
  frameId: string
  depth: number
}

export interface EditorPointer {
  /**
   * Takes one pointer input and sends it to what it is for. Answers whether it was the editor's
   * alone, a press that pans or a turn of the wheel, and whether the pointer is to be held from it.
   */
  route(e: PointerInput): PointerAnswer
  /** The drag on the stage, from its press until it ends, or null. */
  gesture(): Gesture | null
  /** Where the pointer last was over the stage, as a stage point, or null. */
  pointerAt(): Point | null
  /** What Alt measures (see `EditorMeasuring`). */
  measured: EditorMeasuring['measured']
  /** Whether a drag runs or Alt shows a measure: when the small menu by the selection keeps out of the way. */
  busy(): boolean
  /** Outlines the layer under the pointer, as a move there does; returns whether the hover changed. */
  rehover(): boolean
  /** Shows the cursor for the tool, a pan, a move that copies, or the handle under the pointer. */
  showCursor(): void
  /** The cursor the stage shows now, as CSS names it; empty for the browser's own. */
  cursor(): string
  /** Adds a listener told the cursor each time it changes; returns the function that stops it. */
  onCursor(listener: (cursor: string) => void): () => void
  /** Ends the drag on the stage, as a pointerup does. */
  endDrag(): void
  /**
   * Picks what a right-click at a stage point acts on: the selection when the point is on it, else
   * the layer there, selected, locked or not. Returns the selected layers.
   */
  selectAt(stage: Point): string[]
  /**
   * Every layer that shows at a stage point, front-most first, each before the layers it holds
   * there, locked ones too, as the right-click's Select layer lists them; none off every frame.
   */
  layersAt(stage: Point): LayerAt[]
  /**
   * Drops the drag held, if one is: all its step wrote is put back, leaving no undo step, with the
   * selection as the press found it, and no drop, snap lines or click. Returns whether one was held.
   */
  dropDrag(): boolean
  /**
   * Escape while a colour is picked ends picking, and while a drag is held drops it (`dropDrag`).
   * Returns whether there was either, whose key it then is and nothing else's.
   */
  cancelOnEscape(e: KeyInput): boolean
  /**
   * The keys and the window's blur that hold and let go of Space's pan, the deep key and Alt (see
   * `EditorHeldKeys`); each key answers whether it is the editor's alone.
   */
  keyDown: EditorHeldKeys['keyDown']
  followKey: EditorHeldKeys['followKey']
  keyUp: EditorHeldKeys['keyUp']
  blur: EditorHeldKeys['blur']
}

export function editorPointer({
  dragStart,
  hold,
  session,
  view,
  tools,
  selection,
  boxes,
  typing,
  pen,
  cropping,
  drawing,
  transformDrag,
  autoLayoutDrag,
  frameResize,
  sectionMove,
  guideDrag,
  selectPress,
  colourPick,
  renameFrame,
  renameSection,
  onMac,
  shownChanged,
}: PointerDeps): EditorPointer {
  const { target } = boxes
  /** The drag on the stage, from its press until it ends. */
  let gesture: Gesture | null = null
  /** Whether a press on the stage is held, from its pointerdown until it ends. */
  let pressing = false
  /** Where the pointer last was over the stage, so the hover outline follows edits under it. */
  let pointer: PointerInput | null = null
  /** The selection, the group gone into and the picked frame as the last press found them, which Escape puts back. */
  let pressedOn: HeldSelection | null = null
  const pan = editorPan({ view, tools, hold: hold.hold, showCursor })
  const held = editorHeldKeys({ view, pan, onMac, keysChanged })

  const currentGesture = () => gesture
  // Screen points are CSS pixels from the canvas's corner: stage points.
  const screenOf = (e: PointerInput): Point => e.at
  /** The frame under the pointer and the point in its design pixels. */
  function pointIn(e: PointerInput) {
    return view.pointOn(e.at)
  }
  const panning = pan.ready
  const measuring = editorMeasuring({
    view,
    tools,
    selection,
    boxes,
    typing,
    held,
    hoverAt: () => (pointer && pointer.pointerType !== 'touch' && !pressing && !panning() ? pointIn(pointer) : null),
  })
  /** Where the pointer last was over the stage, as a stage point, or null. */
  const pointerAt = () => (pointer ? pointer.at : null)
  const stageCursor = editorStageCursor({
    tools,
    selection,
    boxes,
    cropping,
    transformDrag,
    frameResize,
    guideDrag,
    held,
    pan,
    panning,
    dragAt,
    gesture: currentGesture,
    pointerAt,
    picking: colourPick.picking,
  })
  const busy = () => gesture !== null || measuring.measured() !== null
  /** The frame whose label's name or size is under the pointer, as last drawn. */
  const labelUnder = (e: PointerInput) => e.label

  function showCursor() {
    stageCursor.showCursor()
  }
  /**
   * The deep key or Alt pressed or let go by a key or the focus leaving, or found changed at a
   * release: the move or the reorder held is told Alt, and the cursor follows both.
   */
  function keysChanged() {
    if (gesture?.kind === 'move') transformDrag.setAlt(gesture, held.alt())
    else if (gesture?.kind === 'reorder') autoLayoutDrag.setAlt(gesture, held.alt())
    showCursor()
  }
  /**
   * The deepest layer that shows at a point of a frame, as a press, a double click and a hover pick
   * it: the text being typed in shows anywhere in its box, below its lines too, and so does `text`,
   * when not typing; a selected layer that shows nothing counts all over its box. With `pickable`,
   * what can't be picked (locked) is passed over.
   */
  const deepestAt = (at: { frame: Frame; p: Point }, pickable?: PointerDeps['boxes']['pickable'], text?: string) =>
    boxes.pickAt(at.frame, at.p, { pickable, wholeBox: typing.editing()?.id ?? text })
  const { doubleClick } = editorDoubleClick({
    session,
    view,
    tools,
    selection,
    boxes,
    typing,
    cropping,
    selectPress,
    renameFrame,
    renameSection,
    shownChanged,
    panning,
    labelUnder,
    pointIn,
    deepestAt,
  })
  /**
   * The drag of the selection a press at a stage point would start, as the press routes it, `handle`
   * being the handle under the point: none with a tool other than Select, on the points of the path
   * being edited or on the crop, which take the press, or in the text being typed in, where it puts
   * the caret; else the select tool's (`EditorSelectPress`'s `dragAt`).
   */
  function dragAt(screen: Point, handle: Grab | null) {
    const at = view.pointOn(screen)
    const editing = typing.editing()
    if (tools.tool() !== 'select' || (selection.pathEditing() && pen.pointsAt(at))) return null
    if (selection.cropping() && cropping.cursorAt(screen) !== '') return null
    if (at && editing?.frameId === at.frame.id && deepestAt(at, boxes.pickable)?.id === editing.id) return null
    return selectPress.dragAt(screen, handle)
  }
  function rehover() {
    const at = pointer && !gesture && !panning() ? pointIn(pointer) : null
    const hit = at && (held.deep() ? boxes.deepAt(at.frame, at.p, typing.editing()?.id) : deepestAt(at)?.id)
    const next = at && hit ? { id: held.deep() ? hit : target(hit, at.frame.id), frameId: at.frame.id } : null
    // The radius dot under the pointer, which the deep key passes over, is drawn big.
    const dot = transformDrag.hoverDot(pointer && !gesture && !panning() && !held.deep() ? pointer.at : null)
    const guide = guideDrag.hover(pointer && !gesture && !panning() ? pointer.at : null)
    return selection.hover(next) || dot || guide
  }
  /** Once a drag has ended: the cursor, the hover outline and the radius dot under the pointer follow where it is, and what is shown is told. */
  function dragEnded() {
    showCursor()
    rehover()
    shownChanged()
  }
  const endDrag = () => {
    pressing = false
    const clicked = dragStart.clicking()
    transformDrag.clearSnapLines()
    if (pen.drawing() && !pan.held()) {
      pen.up()
      return
    }
    if (isDrawing(gesture)) {
      drawing.release(gesture)
      gesture = null
      dragEnded()
      return
    }
    if (gesture?.kind === 'textSelect' || gesture?.kind === 'guide') {
      if (gesture.kind === 'guide') guideDrag.release(gesture)
      gesture = null
      dragEnded()
      return
    }
    if (gesture?.kind === 'reorder') autoLayoutDrag.release(gesture)
    else if (isFrameGesture(gesture)) frameResize.release(gesture)
    else if (gesture?.kind === 'sectionMove') sectionMove.release(gesture)
    else if (gesture?.kind === 'path') pen.releasePoints(gesture)
    else if (gesture?.kind === 'crop') cropping.release(gesture)
    else if (gesture && gesture.kind !== 'marquee') transformDrag.release(gesture)
    // What the drag carried was drawn faintly past its frame: the canvas draws again without it.
    if (carried(gesture)) view.redraw()
    selectPress.release(gesture?.kind === 'marquee' ? gesture : null, clicked)
    gesture = null
    pan.release()
    dragEnded()
  }
  function dropDrag(selected = pressedOn) {
    const g = gesture
    if (!g) return false
    gesture = null
    // A drag that has written nothing yet, such as a marquee or a text box being dragged out, holds no step.
    if ('step' in g) g.step?.cancel()
    transformDrag.clearSnapLines()
    selectPress.cancel()
    if (selected) selection.restore(selected)
    // What the drag carried was drawn faintly past its frame: the canvas draws again without it.
    if (carried(g)) view.redraw()
    dragEnded()
    return true
  }
  function cancelOnEscape(e: KeyInput) {
    if (e.code === 'Escape' && colourPick.stop()) return true
    if (e.code !== 'Escape' || !gesture) return false
    return dropDrag()
  }
  const cancelDrag = () => {
    // A drag the browser took away drops nothing into a flow, and selects nothing as a click.
    if (gesture?.kind === 'reorder') autoLayoutDrag.cancel(gesture)
    if (gesture?.kind === 'move') Object.assign(gesture, { drop: null, target: null })
    if (gesture?.kind === 'guide') Object.assign(gesture, { to: null, onRuler: false })
    selectPress.cancel()
    endDrag()
  }

  function selectAt(stage: Point): string[] {
    const at = view.pointOn(stage)
    if (!at) return []
    const { frame } = at
    const deepest = deepestAt(at)
    if (!deepest) return []
    const id = target(deepest.id, frame.id)
    if (!selection.current()?.some((layer) => samePick(layer, { id, frameId: frame.id })))
      selection.select([id], frame.id)
    return idsOf(selection.current())
  }
  function layersAt(stage: Point): LayerAt[] {
    const at = view.pointOn(stage)
    return at ? boxes.layersAt(at.frame, at.p).map((layer) => ({ ...layer, frameId: at.frame.id })) : []
  }

  /** A press: the right-click's and one off the main button start nothing; a pan takes its own, and is the editor's alone. */
  function down(e: PointerInput) {
    pressing = true
    // On a Mac a press with Ctrl is the right-click, which opens the menu and does nothing else.
    if (rightClick(e, onMac())) return false
    if (pan.press(e)) return true
    held.followPointer(e)
    if (e.button === 0) press(e)
    showCursor()
    return false
  }
  /** A press of the main button that neither pans nor is the right-click: what the tool does with it. */
  function press(e: PointerInput) {
    pressedOn = selection.held()
    const screen = screenOf(e)
    dragStart.press(screen, e.pointerType)
    const at = pointIn(e)
    const pressed = toolPress(e, screen, at, { view, tools, drawing, pen })
    if (pressed) {
      if (pressed.drag) gesture = pressed.drag
      return
    }
    if (selection.pathEditing()) {
      const drag = pen.pressPoints(e, at)
      if (drag) {
        gesture = drag
        shownChanged()
        return
      }
    }
    if (selection.cropping()) {
      const drag = cropping.press(e, screen)
      if (drag) {
        gesture = drag
        return
      }
    }
    // A ruler or a guide takes the press first, then a frame label's text, drawn over the canvas,
    // before what is under it, once the selection's handles and turning zones have let it go; a
    // click in a zone over it picks its frame.
    const label = labelUnder(e)
    const zone = selection.current() && transformDrag.handleUnder(screen, e.pointerType === 'touch')
    const grabbed =
      guideDrag.press(e) ||
      (label && !zone && selectPress.pressLabel(e, screen, label)) ||
      (!zone && selectPress.pressSection(e, screen, at, e.title))
    if (grabbed) {
      if (grabbed !== true) gesture = grabbed
      shownChanged()
      return
    }
    const editing = typing.editing()
    const deepest = at && deepestAt(at, boxes.pickable)
    if (at && editing && deepest?.id === editing.id && editing.frameId === at.frame.id) {
      // In the text being edited (#47): a press puts the caret there, Shift extends the range to
      // it, a drag selects, and a third click selects the paragraph.
      const offset = typing.caretFromPoint(at.p)
      const node = session.design().nodes[editing.id]
      if (e.detail >= 3 && node?.type === 'text') {
        typing.selectText(paragraphAt(node.props.text, offset))
      } else {
        typing.caretTo(offset, e.shiftKey)
        if (e.detail <= 1) {
          hold.hold()
          gesture = { kind: 'textSelect', frame: at.frame, around: [] }
        }
      }
      shownChanged()
      return
    }
    // A press that starts no drag leaves the one held, if any, as it is.
    const drag = selectPress.press(e, screen, at, deepest, label)
    if (!drag) return
    gesture = drag
    shownChanged()
  }
  function move(e: PointerInput) {
    pointer = e
    if (pan.move(e)) return
    const screen = screenOf(e)
    if (pen.drawing()) {
      pen.move(e, screen)
      return
    }
    if (!gesture) {
      // Hovering: outline the layer under the pointer and show what a press on a handle would do.
      const keys = held.followPointer(e)
      stageCursor.cursorFor(screen)
      // While measuring, the lines follow the pointer over empty space too.
      if (rehover() || keys || held.alt()) shownChanged()
      return
    }
    if (held.followPointer(e)) showCursor()
    // Asked on each move of a press, so a marquee and a text selection, which start at once, end as a click or a drag.
    const dragged = dragStart.moved(screen)
    const world = toWorld(view.camera(), screen)
    if (gesture.kind === 'marquee') {
      gesture.to = world
      transformDrag.marquee(gesture)
      shownChanged()
      return
    }
    if (gesture.kind === 'textSelect') {
      typing.caretTo(typing.caretFromPoint(localIn(gesture, world)), true)
      shownChanged()
      return
    }
    // Every other drag waits until the press has gone past the slop, writing nothing before.
    if (!dragged) return
    // Holding the deep key turns snapping off for as long as it is held.
    const snap = tools.snapping() && !deepKeyHeld(e, onMac())
    if (gesture.kind === 'guide') return guideDrag.drag(gesture, screen, snap)
    if (gesture.kind === 'sectionMove') return sectionMove.drag(gesture, world, e.shiftKey)
    if (gesture.kind === 'frameDraw' || gesture.kind === 'sectionDraw') {
      drawing.drag(gesture, world, e.shiftKey, e.altKey)
      return
    }
    if (isFrameGesture(gesture)) return frameResize.drag(gesture, world, e)
    const p = localIn(gesture, world)
    if (isDrawing(gesture)) {
      drawing.drag(gesture, p, e.shiftKey, e.altKey)
      return
    }
    if (gesture.kind === 'path') {
      pen.dragPoints(gesture, p, e.shiftKey, e.altKey)
      return
    }
    if (gesture.kind === 'crop') {
      cropping.drag(gesture, p)
      return
    }
    if (gesture.kind === 'reorder') {
      autoLayoutDrag.drag(gesture, p, e.altKey)
      shownChanged()
      return
    }
    transformDrag.drag(gesture, p, e.shiftKey, e.altKey, snap, deepKeyHeld(e, onMac()))
  }
  /** A world point as the layers inside the containers a drag is in see it, in its frame. */
  function localIn(g: { frame: Frame; around: Box[] }, world: Point) {
    return localTo({ x: world.x - g.frame.x, y: world.y - g.frame.y }, g.around)
  }
  function leave() {
    pointer = null
    if (rehover() || held.alt()) shownChanged()
  }
  function route(e: PointerInput): PointerAnswer {
    if (colourPick.route(e, pan)) return { handled: true, hold: hold.taken() }
    let handled = false
    if (e.type === 'pointerdown') handled = down(e)
    else if (e.type === 'pointermove') move(e)
    else if (e.type === 'pointerup') {
      // A release follows the held keys too: Alt let go with no key heard still counts.
      if (held.followPointer(e)) keysChanged()
      // Copies released each where its original is are no copies: the drag is dropped as Escape drops
      // it, with the originals selected as they were when the copies were made.
      const unmoved = gesture?.kind === 'move' ? transformDrag.copiesUnmoved(gesture) : null
      if (unmoved) dropDrag(unmoved)
      endDrag()
    } else if (e.type === 'pointercancel') cancelDrag()
    // A press whose pointer capture goes without a pointerup or pointercancel, as when another
    // element takes the pointer, ends as a cancelled one does; after either, nothing is held.
    else if (e.type === 'lostpointercapture') {
      if (pressing) cancelDrag()
    } else if (e.type === 'pointerleave') leave()
    else if (e.type === 'click') selectPress.clicked(e)
    else if (e.type === 'dblclick') doubleClick(e)
    else {
      pan.wheel(e)
      handled = true
    }
    // A press is judged by the dots shown before it; once the pointer type changes they show or go.
    const seen = e.type === 'pointerdown' || e.type === 'pointermove'
    if (seen && transformDrag.sawPointer(e.pointerType)) shownChanged()
    return { handled, hold: hold.taken() }
  }

  return {
    route,
    gesture: currentGesture,
    pointerAt,
    measured: measuring.measured,
    busy,
    rehover,
    showCursor,
    cursor: stageCursor.cursor,
    onCursor: stageCursor.onCursor,
    endDrag,
    selectAt,
    layersAt,
    dropDrag: () => dropDrag(),
    cancelOnEscape,
    keyDown: held.keyDown,
    followKey: held.followKey,
    keyUp: held.keyUp,
    blur: held.blur,
  }
}
