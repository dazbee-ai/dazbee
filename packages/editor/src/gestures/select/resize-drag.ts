// A resize of the selection from one of its handles, and of a line from one of its ends: what it
// changes as it begins, and each pointer move after, the handle following the pointer from where it
// was grabbed, its shape kept with Shift or the one layer's Lock ratio, about the centre with Alt, its dragged edges snapping, the
// text a corner scales scaled with it, what a box holds following its constraints or, with the deep
// key held, staying where it is on the page, and the selected layers of other frames resized as much.
import {
  descendants,
  type GestureStep,
  placedByFlow,
  type ScaledText,
  scaleText,
  type Session,
  smallestSize,
} from '@dazbee/doc'
import { type Design, type Point, ratioLocked, type RunStyle } from '@dazbee/schema'

import type { Camera } from '../../canvas/camera.ts'
import type { Frame } from '../../canvas/frames.ts'
import { fitResizedTexts } from '../../frame-actions.ts'
import type { EditorBoxes, SelectionBox } from '../../layers/boxes.ts'
import { heldDesign, resizedBoxes, scalingTexts, switchSizing } from '../../layers/resize.ts'
import { type DragSnap, SNAP_DISTANCE, snapResize, type Targets } from '../../layers/snap.ts'
import {
  type Box,
  boxAt,
  centreOf,
  type Handle,
  handleAt,
  isCorner,
  normalAngle,
  resize as resizeBox,
  round,
  turn,
  unturned,
  wholeFrom,
  wholeOnPage,
} from '../../layers/transform.ts'
import { runQuietly } from '../../run-quietly.ts'
import type { EditorTyping } from '../../text/typing.ts'
import { draggedRect } from '../drawing/draw-tools.ts'
import type { LineEnd } from '../hit-zones.ts'

/**
 * The layers of one frame a resize changes, inside their containers there: their box and each
 * one's as the drag began, the text a corner scales, with its sizes as the drag began, how much,
 * and the least it may, and whether the sides it drags have become Fixed yet.
 */
export interface ResizePart {
  frame: Frame
  around: Box[]
  outer: Box
  roots: string[]
  boxes: Map<string, Box>
  /** The design as the resize began, which what a box holds follows its constraints from. */
  start: Design
  texts: Map<string, ScaledText>
  factor: number
  floor: number
  switched: boolean
  /** It is one layer whose ratio is locked, as the resize began: an edge then grows both its sides. */
  ratioLocked: boolean
}
/**
 * A drag of one of the selection's handles, from the press until it ends: one undo step. The frame
 * whose box shows the handles is resized and snaps; `others` holds the selected layers of the other
 * frames, their boxes changed by the same amount.
 */
export interface ResizeDrag extends ResizePart {
  kind: 'resize'
  handle: Handle
  grab: Point
  targets: Targets | null
  others: ResizePart[]
  step: GestureStep
}
/**
 * A drag of one of a line's ends, the other staying where it is, from the press until it ends: one
 * undo step. It resizes the line from that end as every resize does.
 */
export interface EndDrag extends ResizePart {
  kind: 'end'
  end: LineEnd
  grab: Point
  step: GestureStep
}
/** The box of the layers a resize changes, with its frame and the containers around it. */
export type ResizedBox = Pick<SelectionBox, 'frame' | 'around' | 'box'>

export interface ResizeDragDeps {
  session: Session
  typing: Pick<EditorTyping, 'fitText'>
  boxes: Pick<EditorBoxes, 'startBoxes' | 'boxIn'>
  camera: () => Camera
  /** Shows what the drag snapped to; null when it snapped to nothing. */
  showSnap: (snapped: DragSnap | null) => void
  /** Writes new boxes: what changed from `start`, and what the drag changed and put back. */
  writeBoxes: (frame: Frame, start: Map<string, Box>, next: Map<string, Box>) => void
}

export interface EditorResizeDrag {
  /**
   * The layers of a frame a resize from `handle` changes, as it begins: `outer` is their box with
   * the containers around it. A drag other than the selection's handles, such as a crop's window,
   * resizes them through `resizePartTo`.
   */
  resizePart(outer: ResizedBox, ids: string[], handle: Handle): ResizePart
  /**
   * Follows the pointer: Shift keeps the box's shape, as Lock ratio does for the one layer selected,
   * Alt resizes about the centre, `snap` snaps the dragged edges, and `keep` (the deep key held)
   * keeps what a box holds where it is on the page. Upright on the page, the handle's place lands on whole design pixels before it
   * snaps; for one layer a flow places, a whole distance from what the resize keeps, so its size
   * is whole.
   */
  resizeTo(g: ResizeDrag, p: Point, keepRatio: boolean, fromCentre: boolean, snap: boolean, keep?: boolean): void
  /**
   * Resizes a part's layers from their box as the resize began to `to`, as every resize does: the
   * first time, the sides `handle` drags become Fixed; a layer a flow places keeps its place; what
   * a box holds follows its constraints, or with `keep` stays where it is on the page; the text a
   * corner scales scales with it, no less than it may. Gives the box they take.
   */
  resizePartTo(part: ResizePart, to: Box, handle: Handle, fromCentre: boolean, keep?: boolean): Box
  /** Moves a line's end to the pointer, the other end staying where it is; Shift holds it to 45° steps. */
  endTo(g: EndDrag, p: Point, shift: boolean): void
}

export function editorResizeDrag({
  session,
  typing,
  boxes: { startBoxes, boxIn },
  camera,
  showSnap,
  writeBoxes,
}: ResizeDragDeps): EditorResizeDrag {
  /** The layers of a frame a resize from `handle` changes, as it begins. */
  function resizePart({ frame, around, box: outer }: ResizedBox, ids: string[], handle: Handle): ResizePart {
    const texts = scalingTexts(session.design(), ids, handle)
    // Scaled down, the smallest size anywhere in the text stops at 1 px.
    const floor = Math.max(0, ...[...texts.values()].map((t) => 1 / smallestSize(t)))
    const [only] = ids
    const props = ids.length === 1 && only !== undefined ? session.design().nodes[only]?.props : undefined
    const locked = props !== undefined && ratioLocked(props)
    return {
      frame,
      around,
      outer,
      roots: ids,
      boxes: startBoxes(frame, ids),
      start: heldDesign(session.design(), ids),
      texts,
      factor: 1,
      floor,
      switched: false,
      ratioLocked: locked,
    }
  }
  /** Resizes the layers by the handle dragged, snapping its edges, scaling the text a corner scales. */
  function resizeTo(g: ResizeDrag, p: Point, keepRatio: boolean, fromCentre: boolean, snap: boolean, keep = false) {
    // The handle follows the pointer from where it was grabbed, so a press off its centre doesn't jump.
    // Upright on the page it lands on whole design pixels; for one layer a flow places, which the flow
    // puts where it goes, a whole distance from what the resize keeps, so its size dragged is whole.
    const handle = handleOf(g.outer, g.handle)
    const boxes = [...g.around, g.outer]
    const pointed = { x: handle.x + p.x - g.grab.x, y: handle.y + p.y - g.grab.y }
    const [only] = g.roots
    const placed = g.roots.length === 1 && only !== undefined && placedByFlow(session.design(), only)
    // About the centre each side moves half the size, so the place goes in half pixels.
    const to = placed
      ? wholeFrom(pointed, keptBy(g.outer, g.handle, fromCentre), boxes, fromCentre ? 0.5 : 1)
      : wholeOnPage(pointed, boxes)
    // A corner that scales text keeps the box's shape, so the text scales as one, and so does one
    // layer whose ratio is locked, with its linked copies in other frames whose ratio is too.
    const scales = g.texts.size > 0
    const ratio = keepRatio || scales || [g, ...g.others].every((part) => part.ratioLocked)
    let outer = resizeBox(g.outer, g.handle, to, { keepRatio: ratio, fromCentre })
    showSnap(null)
    // The dragged edges snap; a box turned in the space it is kept in has none that run along it.
    // With the shape kept, the edge nearest a snap line snaps and the other follows.
    if (snap && g.targets && unturned(g.outer)) {
      const corner = isCorner(g.handle)
      const s = snapResize(outer, g.handle, g.targets, SNAP_DISTANCE / camera().zoom, ratio && corner)
      if (ratio && corner && (s.dx !== 0 || s.dy !== 0) && g.outer.width > 0 && g.outer.height > 0) {
        // From the centre both edges move, so the box grows by twice what the dragged edge does.
        const grows = fromCentre ? 2 : 1
        const factor =
          s.dx !== 0
            ? (outer.width + grows * (g.handle.includes('e') ? s.dx : -s.dx)) / g.outer.width
            : (outer.height + grows * (g.handle.includes('s') ? s.dy : -s.dy)) / g.outer.height
        outer = boxAt(g.outer, g.handle, factor, fromCentre)
      } else if (s.dx !== 0 || s.dy !== 0)
        outer = resizeBox(g.outer, g.handle, { x: to.x + s.dx, y: to.y + s.dy }, { keepRatio: ratio, fromCentre })
      showSnap({ frame: g.frame, parent: g.targets.parent, layers: g.roots, snapLines: s.snapLines, gaps: [] })
    }
    outer = resizePartTo(g, outer, g.handle, fromCentre, keep)
    // The other frames' boxes change by the same amount: each one's handle moves as far, along its own sides.
    const moved = handleOf(outer, g.handle)
    const from = handleOf(g.outer, g.handle)
    const along = turn({ x: moved.x - from.x, y: moved.y - from.y }, { x: 0, y: 0 }, -g.outer.rotation)
    for (const other of g.others) {
      const start = handleOf(other.outer, g.handle)
      const by = turn(along, { x: 0, y: 0 }, other.outer.rotation)
      const to = { x: start.x + by.x, y: start.y + by.y }
      const box = resizeBox(other.outer, g.handle, to, { keepRatio: ratio, fromCentre })
      resizePartTo(other, box, g.handle, fromCentre, keep)
    }
  }
  /**
   * Resizes the layers of one frame from their box as the drag began to `to`: the first time, the
   * sides the handle drags stop following their content; what a box holds follows its constraints,
   * or with `keep` stays where it is on the page; the text a corner scales scales by as much, no less
   * than it may. Gives the box they take.
   */
  function resizePartTo(part: ResizePart, to: Box, handle: Handle, fromCentre: boolean, keep = false) {
    // A layer whose ratio is locked has both sides changed, from an edge too, so both become Fixed.
    const sides = part.ratioLocked ? bothSidesOf(handle) : handle
    if (!part.switched) switchSizing(session, part.roots, sides, session.design(), part.texts)
    part.switched = true
    let outer = to
    if (part.texts.size > 0) {
      const start = part.outer
      part.factor = start.width > 0 ? outer.width / start.width : start.height > 0 ? outer.height / start.height : 1
      if (part.factor < part.floor) {
        part.factor = part.floor
        outer = boxAt(start, handle, part.factor, fromCentre)
      }
    }
    const now = session.design()
    // How far each layer is drawn from where it is stored now: what writing a drawn box takes off.
    const shiftNow = (id: string) => {
      const [drawn, stored] = [boxIn(id, now), now.nodes[id]?.props]
      return drawn && stored ? { x: drawn.x - stored.x, y: drawn.y - stored.y } : null
    }
    const next = resizedBoxes(part.start, part.roots, part.boxes, part.outer, outer, keep, shiftNow)
    // The widths of the texts boxes hold, before the rule changes them.
    const inBoxes = part.roots.filter((root) => now.nodes[root]?.type === 'box')
    const widths = new Map(
      inBoxes.flatMap((root) => descendants(now, root)).map((id) => [id, now.nodes[id]?.props.width] as const),
    )
    writeBoxes(
      part.frame,
      part.boxes,
      new Map(
        [...next].map(([id, b]) => [
          id,
          { ...b, x: round(b.x), y: round(b.y), width: round(b.width), height: round(b.height) },
        ]),
      ),
    )
    // The text a corner scales takes its sizes scaled from where they were: its style's, and each
    // of its own runs' on that run's characters.
    for (const [id, start] of part.texts) {
      const { runs, ...sized } = scaleText(start, part.factor)
      runQuietly(() => session.run('node.update', { ids: [id], patch: sized }))
      for (const run of runs) {
        const style = sizesOf(run.style)
        if (Object.keys(style).length > 0)
          runQuietly(() =>
            session.run('text.edit', { id, op: { kind: 'style', at: run.start, length: run.end - run.start, style } }),
          )
      }
    }
    // Text that grows with its words takes the size its new width and sizes give it.
    for (const root of inBoxes) fitResizedTexts(session.design(), root, (id) => widths.get(id), typing.fitText)
    for (const id of new Set([...part.roots.filter((root) => now.nodes[root]?.type === 'text'), ...part.texts.keys()]))
      typing.fitText(id)
    return outer
  }
  /**
   * Moves a line's end to the pointer, the other end staying where it is, as the line tool draws
   * from the end that stays: Shift holds it to 45° steps. The line keeps its direction, so a start
   * stays a start and an arrow points the same way. It is a resize from that end.
   */
  function endTo(g: EndDrag, p: Point, shift: boolean) {
    // The end follows the pointer from where it was grabbed, so a press beside it doesn't jump.
    const end = handleOf(g.outer, g.end)
    const to = { x: end.x + p.x - g.grab.x, y: end.y + p.y - g.grab.y }
    const drawn = draggedRect('line', handleOf(g.outer, g.end === 'e' ? 'w' : 'e'), to, shift, false)
    const rotation = g.end === 'e' ? drawn.rotation : round(normalAngle(drawn.rotation + 180))
    resizePartTo(g, { ...drawn, y: drawn.y - g.outer.height / 2, height: g.outer.height, rotation }, g.end, false)
  }

  return { resizePart, resizeTo, resizePartTo, endTo }
}

/** Where a handle of a box is, turned with it. */
function handleOf(box: Box, handle: Handle): Point {
  const at = handleAt(handle)
  return turn({ x: box.x + at.x * box.width, y: box.y + at.y * box.height }, centreOf(box), box.rotation)
}

/** What a resize by a handle keeps where it is: the side or corner across from it, or with Alt the centre, turned with the box. */
function keptBy(box: Box, handle: Handle, fromCentre: boolean): Point {
  const at = handleAt(handle)
  const kept = fromCentre ? { x: 0.5, y: 0.5 } : { x: 1 - at.x, y: 1 - at.y }
  return turn({ x: box.x + kept.x * box.width, y: box.y + kept.y * box.height }, centreOf(box), box.rotation)
}

/** The sizes a run's style sets, which a corner scales: its font size, letter spacing, outline and tiled image. */
function sizesOf(style: RunStyle): RunStyle {
  const sizes: RunStyle = {}
  if (style.fontSize !== undefined) sizes.fontSize = style.fontSize
  if (style.letterSpacing !== undefined) sizes.letterSpacing = style.letterSpacing
  if (style.outline !== undefined) sizes.outline = style.outline
  if (style.image?.fit === 'tile' && style.image.tileScale !== undefined) sizes.image = style.image
  return sizes
}

/** A handle that drags both sides: an edge's with the side across it, a corner as it is. */
function bothSidesOf(handle: Handle): Handle {
  if (handle === 'n' || handle === 's') return `${handle}e`
  if (handle === 'e' || handle === 'w') return `s${handle}`
  return handle
}
