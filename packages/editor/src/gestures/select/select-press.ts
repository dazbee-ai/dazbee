// The select tool's press on the stage: what it picks, with Shift adding a layer or taking it out and
// the deep key (⌘ on a Mac, Ctrl elsewhere) selecting the deepest layer under it at once, inside the
// group gone into or on a locked layer, or the frame whose label it is on, or the star by that
// frame's name, which stars it, and which label offers that star as the pointer hovers its row; the drag it
// starts (a handle, a marquee, a move, an auto layout reorder, the picked frame's resize from one of
// its handles, from a label, a frame's move, or from a section's title or outline line, the
// section's move); and
// what a press that never became a drag selects once it ends, such as the frame whose empty area a
// click was on; and the text selected before a run of clicks, which its double click types into.
import type { Session } from '@dazbee/doc'
import type { SceneLayer } from '@dazbee/renderer'
import type { Point } from '@dazbee/schema'

import { toggled } from '../../across-frames.ts'
import { toWorld } from '../../canvas/camera.ts'
import { type Frame, frameAt, labelAt } from '../../canvas/frames.ts'
import { sectionAt } from '../../canvas/sections.ts'
import type { EditorView } from '../../canvas/view.ts'
import { type EditorBoxes, lockedInPlace } from '../../layers/boxes.ts'
import { runQuietly } from '../../run-quietly.ts'
import { type EditorSelection, firstFrameOf, type Picked, samePick, selectInto } from '../../selection.ts'
import { deepKeyHeld } from '../../shortcuts.ts'
import type { EditorTyping } from '../../text/typing.ts'
import { type Grab, onSelection, screenCorners } from '../hit-zones.ts'
import type { PointerInput } from '../inputs.ts'
import type { EditorAutoLayoutDrag, ReorderDrag } from './auto-layout-drag.ts'
import type { EditorFrameMove, FrameMoveDrag } from './frame-move.ts'
import type { EditorFrameResize, FrameResizeDrag } from './frame-resize.ts'
import { freeOf, type MoveDrag } from './move-drag.ts'
import type { EditorSectionMove, SectionMoveDrag } from './section-move.ts'
import type { EditorTransformDrag, HandleDrag, MarqueeDrag } from './transform-drag.ts'

/** A drag the select tool's press starts. */
export type SelectDrag = MoveDrag | HandleDrag | MarqueeDrag | ReorderDrag | FrameMoveDrag | FrameResizeDrag

export interface SelectPressDeps {
  /** Asks for the pointer to be held from the press being handled. */
  hold: () => void
  session: Pick<Session, 'readOnly' | 'run'>
  view: Pick<EditorView, 'camera' | 'design' | 'frames' | 'frameOf' | 'pointOn'>
  selection: Pick<
    EditorSelection,
    'current' | 'entered' | 'enter' | 'select' | 'selectAcross' | 'selectKeepingModes' | 'pickFrame' | 'pickSection'
  >
  boxes: Pick<
    EditorBoxes,
    | 'selectionBox'
    | 'selectionBoxes'
    | 'lockedSelection'
    | 'rootsByFrame'
    | 'target'
    | 'lockedAt'
    | 'insideEntered'
    | 'deepAt'
  >
  typing: Pick<EditorTyping, 'stop'>
  transformDrag: Pick<EditorTransformDrag, 'handleUnder' | 'pressHandle' | 'pressMove'>
  autoLayoutDrag: Pick<EditorAutoLayoutDrag, 'press' | 'reorders'>
  frameMove: Pick<EditorFrameMove, 'start' | 'shownSections'>
  sectionMove: Pick<EditorSectionMove, 'start'>
  /** The picked frame's handles, which a press takes before what is under them. */
  frameResize: Pick<EditorFrameResize, 'press'>
  /** Whether this computer is Apple's, whose deep key is ⌘ and where Ctrl with a click is the right-click. */
  onMac: () => boolean
}

export interface EditorSelectPress {
  /**
   * A press of the select tool at `screen`, on the frame and point `at` and the layer `deepest`
   * there, over the label of the frame `label`, if any: it selects what it picks and returns the
   * drag it starts, or null when it starts none. A press without the deep key grabs a radius dot the
   * selection shows; with it, the press passes over the dots, which stay drawn. A press on a handle
   * of the picked frame resizes the frame, and a click there keeps it picked.
   */
  press(
    e: PointerInput,
    screen: Point,
    at: { frame: Frame; p: Point } | null,
    deepest: SceneLayer | null,
    label?: string,
  ): SelectDrag | null
  /**
   * A press on a frame's label: it picks the frame, letting the selection and the group gone into
   * go, and returns the drag that moves the frame; null for a frame the shown page lacks. Inside
   * the reach of a handle of the picked frame, the handle wins, and the press resizes that frame.
   * A press on the star by the frame's name, in a tab that may edit, stars the frame or takes its
   * star off as one undo step, picking nothing and starting no drag (true).
   */
  pressLabel(e: PointerInput, screen: Point, frameId: string): FrameMoveDrag | FrameResizeDrag | true | null
  /**
   * A press on the title of section `title`, or off every frame (`at` null) on a section's outline
   * line, the newer where two are: it picks the section, letting the selection go, and returns the
   * drag that moves it, or true for a tab that may only view, which moves none; null for a press on
   * neither.
   */
  pressSection(
    e: PointerInput,
    screen: Point,
    at: { frame: Frame; p: Point } | null,
    title: string | undefined,
  ): SectionMoveDrag | true | null
  /**
   * Ends the press, `clicked` when it never went past the slop: such a press selects what it
   * clicked; a marquee lets the picked frame go, or picks the frame it was clicked on with Shift
   * and nothing selected.
   */
  release(gesture: MarqueeDrag | null, clicked: boolean): void
  /** Forgets what a press would select as a click, for a press the browser took away or Escape cancelled. */
  cancel(): void
  /**
   * Follows a hover of the select tool, `e` being where the pointer is, or null with none or while a
   * drag runs: a mouse or a pen over a frame label's row, in a tab that may edit, has that label
   * offer its star (`starOffered`). Returns whether the label offering it changed.
   */
  hoverStar(e: PointerInput | null): boolean
  /** The frame whose label offers its star, hollow while the frame isn't starred; null with none. */
  starOffered(): string | null
  /**
   * The drag of the selection a press at a stage point would start, `handle` being what it grabs
   * there (`handleUnder`): a reorder along the one flow that places it, a move of the layers no
   * flow places, or none, as on a handle, outside the selection's box, for a selection locked in
   * place, or with every layer in a flow among others.
   */
  dragAt(screen: Point, handle: Grab | null): 'move' | 'reorder' | null
  /** A click on the stage, by a mouse or a finger: the first of a run notes the text selected when its press went down. */
  clicked(e: PointerInput): void
  /**
   * The text selected alone in a frame when the last run of clicks began, though its first click
   * picked what shows beneath: the run's double click picks it anywhere in its box.
   */
  textBeforeClicks(frameId: string): string | undefined
}

export function editorSelectPress({
  hold,
  session,
  view,
  selection,
  boxes,
  typing,
  transformDrag,
  autoLayoutDrag,
  frameMove,
  sectionMove,
  frameResize,
  onMac,
}: SelectPressDeps): EditorSelectPress {
  const { frameOf } = view
  const { target, lockedAt, insideEntered } = boxes
  /**
   * What a click selects alone when the pointer doesn't move first: one of several selected
   * layers, a layer pressed inside the selection's box, which a drag moves instead, or what lies
   * under a press in a zone with no handle drawn there, which a drag resizes or turns; '' for a
   * press there on nothing, which a click deselects.
   */
  let clickedAlone: string | null = null
  /** The frame whose label a press in such a zone went down on: a click picks it. */
  let clickedLabel: string | null = null
  /** Whether that click was pressed with Shift, adding what it selects or taking it out. */
  let clickedWithShift = false
  /** Whether that click was pressed with the deep key, ⌘ on a Mac and Ctrl elsewhere, selecting the deepest layer and going into its group. */
  let clickedDeep = false
  /** The frame the press that may still be a click went down in. */
  let pressedFrame: string | null = null
  /** The locked layer under a press that started a marquee: a click, with no drag, selects it. */
  let lockedClick: (Picked & { shift: boolean }) | null = null
  /** The text selected alone when the last press went down, and when the last run of clicks began. */
  let pressedText: Picked | null = null
  let runText: Picked | null = null
  /** The frame whose label offers its star, as the last hover found it. */
  let starOffered: string | null = null

  function press(
    e: PointerInput,
    screen: Point,
    at: { frame: Frame; p: Point } | null,
    deepest: SceneLayer | null,
    label?: string,
  ): SelectDrag | null {
    pressedText = textSelected()
    const resize = frameResize.press(e, screen)
    if (resize) return resize
    typing.stop()
    clickedAlone = null
    clickedLabel = null
    clickedWithShift = false
    clickedDeep = deepKeyHeld(e, onMac())
    pressedFrame = at?.frame.id ?? null
    const grabbed = transformDrag.handleUnder(screen, e.pointerType === 'touch', !clickedDeep)
    const handled = boxes.selectionBox()
    if (grabbed && handled && selection.current()) {
      // Until it passes the slop, a press on a drawn handle is a click that keeps the selection;
      // elsewhere in a zone it is a click on what lies under it, as anywhere else, a frame's label first.
      if (grabbed.kind === 'rotate' || !grabbed.drawn) {
        const under =
          at &&
          (clickedDeep
            ? boxes.deepAt(at.frame, at.p)
            : (lockedAt(at.frame, at.p) ?? (deepest && target(deepest.id, at.frame.id))))
        clickedAlone = label ? '' : under || ''
        clickedLabel = label ?? null
      }
      clickedWithShift = e.shiftKey
      return transformDrag.pressHandle(e, screen, grabbed, handled)
    }
    // With the deep key, the layer the hover with it outlines is selected at once, and a drag moves it.
    const reached = at && clickedDeep ? boxes.deepAt(at.frame, at.p) : null
    if (at && reached) return pressDeep(e, at, reached)
    const inSelection = (id: string) =>
      Boolean(at && selection.current()?.some((layer) => samePick(layer, { id, frameId: at.frame.id })))
    const locked = at && !e.shiftKey ? lockedAt(at.frame, at.p) : null
    // Inside the selection's box, a press moves the selection, gaps and layers over it included:
    // a mask, which isn't drawn, or a layer under others, is dragged where it is.
    // A selection that can't move leaves the press to what is under it.
    const inOuter = at !== null && inBox(screen, at.frame.id)
    // A press outside the group or box double-clicked into leaves it.
    if (
      selection.entered() &&
      !inOuter &&
      !(deepest && insideEntered(deepest.id)) &&
      !(locked && insideEntered(locked))
    )
      selection.enter(null)
    const hit = at && deepest && !(locked && !inOuter) ? { id: target(deepest.id, at.frame.id) } : null
    if (at && hit) {
      if (e.shiftKey) {
        // Shift adds a layer to the selection, or a linked copy of a selected one in another frame,
        // or takes it out again.
        const wasIn = inSelection(hit.id)
        toggle(hit.id, at.frame.id)
        if (wasIn) return null
      } else if (inSelection(hit.id)) {
        if ((selection.current()?.length ?? 0) > 1) clickedAlone = hit.id
      } else if (inOuter) {
        clickedAlone = hit.id
      } else {
        pick(hit.id, at.frame.id)
      }
      // Inside the selection's box a drag still moves the selection; a click picks the locked layer
      // on top there.
      if (locked && inOuter) clickedAlone = locked
    } else if (!inOuter) {
      // Empty canvas, a frame's empty area, picked or not, or a locked layer: a marquee, which with
      // Shift toggles what it touches in the selection.
      hold()
      // With Shift, the locked layer a click lands on is added or taken out once the press ends a click.
      const under = at && (locked ?? (e.shiftKey ? lockedAt(at.frame, at.p) : null))
      lockedClick = at && under ? { id: under, frameId: at.frame.id, shift: e.shiftKey } : null
      const from = toWorld(view.camera(), screen)
      const base = e.shiftKey ? (selection.current() ?? []) : []
      // A press on a locked layer keeps the selection until it is a drag, so a click on the one
      // selected leaves it be.
      if (!e.shiftKey && !locked) selection.selectKeepingModes(null)
      if (!(locked && insideEntered(locked))) selection.enter(null)
      return { kind: 'marquee', from, to: from, base }
    } else if (!e.shiftKey) {
      // Inside the selection's box on no layer, a click picks the frame there; on a locked layer that
      // shows through a selected one, as through a round layer's corner, it keeps the selection.
      clickedAlone = locked ? null : ''
    }
    return pressMove(e, at)
  }
  /**
   * A press with the deep key on the layer it reaches: selects it, going into its group, or with
   * Shift adds it or takes it out; then drags the selection, unless that is locked in place.
   */
  function pressDeep(e: PointerInput, at: { frame: Frame; p: Point }, id: string): SelectDrag | null {
    const wasIn = selection.current()?.some((layer) => samePick(layer, { id, frameId: at.frame.id }))
    if (e.shiftKey) toggle(id, at.frame.id)
    else pick(id, at.frame.id)
    // A layer reached inside a group or box locked in place stays put, as the layer locked itself does.
    if ((e.shiftKey && wasIn) || boxes.lockedSelection() || lockedInPlace(view.design(), id)) return null
    return pressMove(e, at)
  }
  /**
   * Drags the selection from a press: the frame pressed in is dragged, when it holds selected
   * layers, else the first one's; the selected layers of the other frames go with it.
   */
  function pressMove(e: PointerInput, at: { frame: Frame; p: Point } | null): SelectDrag | null {
    const parts = boxes.rootsByFrame()
    const dragged = parts.find((part) => part.frame.id === at?.frame.id) ?? parts[0]
    const frame = at && dragged && frameOf(dragged.frame.id)
    if (!at || !frame || !dragged) return null
    const aroundIn = (frameId: string) => boxes.selectionBoxes().find((b) => b.frame.id === frameId)?.around ?? []
    const around = aroundIn(frame.id)
    hold()
    const others = parts.filter((part) => part !== dragged)
    const reorder = inOneFlow(parts) ? autoLayoutDrag.press(frame, around, at.p, dragged.ids) : null
    if (reorder) return reorder
    return transformDrag.pressMove(
      frame,
      around,
      at.p,
      dragged.ids,
      others.map((part) => ({ ...part, around: aroundIn(part.frame.id) })),
    )
  }
  /**
   * Whether a stage point is inside the box round the selected layers of a frame, which a press
   * there drags: never for a selection locked in place.
   */
  function inBox(screen: Point, frameId: string) {
    const outer = boxes.selectionBoxes().find((b) => b.frame.id === frameId)
    if (!outer || !selection.current() || boxes.lockedSelection()) return false
    return onSelection(screenCorners(outer.drawn, outer.frame, view.camera()), screen, view.camera().zoom)
  }
  /** Whether the selected layers are all in one frame and one flow places every one: a press on them drags them along it. */
  function inOneFlow(parts: { ids: string[] }[]) {
    const [only, ...others] = parts
    return only !== undefined && others.length === 0 && autoLayoutDrag.reorders(only.ids)
  }
  function dragAt(screen: Point, handle: Grab | null) {
    const at = view.pointOn(screen)
    if (!at || handle || !inBox(screen, at.frame.id)) return null
    const parts = boxes.rootsByFrame()
    if (inOneFlow(parts)) return 'reorder'
    return parts.some((part) => freeOf(view.design(), part.ids).length > 0) ? 'move' : null
  }
  function pressLabel(e: PointerInput, screen: Point, frameId: string) {
    if (e.star === frameId && !session.readOnly()) return pressStar(frameId)
    pressedText = textSelected()
    const resize = frameResize.press(e, screen)
    if (resize) return resize
    const frame = frameOf(frameId)
    if (!frame) return null
    typing.stop()
    clickedAlone = null
    selection.enter(null)
    selection.pickFrame(frame.id)
    hold()
    return frameMove.start(frame, toWorld(view.camera(), screen))
  }
  function pressStar(frameId: string): true {
    typing.stop()
    clickedAlone = null
    const starred = view.design().frames[frameId]?.starred === true
    runQuietly(() => session.run('frame.update', { frameId, starred: !starred }))
    return true
  }
  function pressSection(e: PointerInput, screen: Point, at: { frame: Frame; p: Point } | null, title?: string) {
    const outlines = frameMove.shownSections(null).outlines
    const sectionId = title ?? (at ? undefined : sectionAt(outlines, screen, ['line'])?.id)
    if (sectionId === undefined) return null
    pressedText = textSelected()
    typing.stop()
    clickedAlone = null
    selection.enter(null)
    selection.pickSection(sectionId)
    if (session.readOnly()) return true
    hold()
    return sectionMove.start(sectionId, toWorld(view.camera(), screen))
  }
  function release(gesture: MarqueeDrag | null, clicked: boolean) {
    // A press that became a drag selects nothing as a click.
    if (!clicked) clickedAlone = null
    // A click on a locked layer, not a drag, selects it; a click on a frame's empty area with nothing
    // selected picks the frame, and a marquee dragged, or off every frame, lets the picked frame go.
    const marqueeClicked = gesture?.kind === 'marquee' && clicked
    if (marqueeClicked && lockedClick?.shift) toggle(lockedClick.id, lockedClick.frameId)
    else if (marqueeClicked && lockedClick) pick(lockedClick.id, lockedClick.frameId)
    else if (gesture?.kind === 'marquee')
      selection.pickFrame(
        marqueeClicked && !selection.current() ? (frameAt(view.frames(), gesture.from)?.id ?? null) : null,
      )
    lockedClick = null
    const current = selection.current()
    if (clickedAlone !== null && current && clickedLabel) {
      // A click on a frame's label picks the frame, as it does anywhere.
      selection.pickFrame(clickedLabel)
    } else if (clickedAlone !== null && current && clickedWithShift) {
      // With Shift, a click adds what it picked or takes it out.
      if (clickedAlone && pressedFrame) toggle(clickedAlone, pressedFrame)
    } else if (clickedAlone !== null && current) {
      // A click that picks a layer outside the group gone into, or nothing, leaves it.
      if (selection.entered() && (!clickedAlone || !insideEntered(clickedAlone))) selection.enter(null)
      const frameId = pressedFrame ?? firstFrameOf(current) ?? null
      if (clickedAlone && frameId) pick(clickedAlone, frameId)
      else selection.select([], frameId)
      // A click inside the selection's box on no layer picks the frame there.
      if (!clickedAlone) selection.pickFrame(pressedFrame)
    }
    clickedAlone = null
    clickedLabel = null
    pressedFrame = null
  }
  function hoverStar(e: PointerInput | null) {
    const offers = e !== null && e.pointerType !== 'touch' && !session.readOnly()
    const next = offers ? (labelAt(view.frames(), view.camera(), e.at)?.id ?? null) : null
    const moved = next !== starOffered
    starOffered = next
    return moved
  }
  function cancel() {
    lockedClick = null
    clickedAlone = null
    clickedLabel = null
  }
  function clicked(e: PointerInput) {
    // Each click uses up what its press noted, so a run whose press went elsewhere notes no older text.
    if (e.detail <= 1) runText = pressedText
    pressedText = null
  }
  function textBeforeClicks(frameId: string) {
    return runText?.frameId === frameId ? runText.id : undefined
  }
  function textSelected(): Picked | null {
    const current = selection.current()
    const only = current?.length === 1 ? current[0] : undefined
    return only && view.design().nodes[only.id]?.type === 'text' ? only : null
  }
  /**
   * Adds a layer of a frame to the selection, or a linked copy of a selected one in another frame,
   * or takes it out again; pressed with the deep key, going into the group that layer is in.
   */
  function toggle(id: string, frameId: string) {
    const next = toggled(selection.current(), { id, frameId }, view.design())
    if (clickedDeep) selectInto(selection, view.design(), next)
    else selection.selectAcross(next)
  }
  /** Selects a layer of a frame alone; pressed with the deep key, going into the group it is in. */
  function pick(id: string, frameId: string) {
    if (clickedDeep) selectInto(selection, view.design(), [{ id, frameId }])
    else selection.select([id], frameId)
  }

  return {
    press,
    pressLabel,
    pressSection,
    release,
    cancel,
    hoverStar,
    starOffered: () => starOffered,
    dragAt,
    clicked,
    textBeforeClicks,
  }
}
