// The connectors of the shown page as the stage draws them (ADR-0024), in screen pixels: where each
// end is drawn now (a frame's box with its label's row, or a section's outline), the facing sides of
// the two ends nearest each other, the cubic curve between their middles, horizontal when the ends
// sit side by side and vertical when they are stacked, its arrowhead's angle, and what a stage point
// is on. The curve is worked out on every draw from where its ends are, and never stored.
import { connectorsOf, type Design, type Point, type Rect } from '@dazbee/schema'

import { type Camera, toScreen } from './camera.ts'
import { type Frame, LABEL_ROOM } from './frames.ts'
import type { SectionOutline } from './sections.ts'

/** A connector's curve on the stage, in screen pixels: from its start through two control points to its end. */
export interface ConnectorCurve {
  from: Point
  c1: Point
  c2: Point
  to: Point
}
/** A connector the stage draws: its id, its two ends' ids and its curve. */
export interface ShownConnector {
  id: string
  from: string
  to: string
  curve: ConnectorCurve
}

/** How far either side of a connector's curve a press still takes it, in screen pixels. */
export const CONNECTOR_REACH = 6
/** How far outside its end's side a connector starts and ends, so its dot and arrowhead show beside the frame drawn over it. */
export const END_GAP = 6

/** How far a control point stands off its end at least, in screen pixels, so close ends still curve. */
const MIN_BEND = 24
/** The straight pieces a curve is cut into to measure how far a point is from it. */
const PIECES = 24

/** The connectors of the shown page with both ends drawn, by order, each with its curve between its ends' boxes. */
export function connectorsShown(
  design: Design,
  frames: readonly Frame[],
  outlines: readonly SectionOutline[],
  camera: Camera,
): ShownConnector[] {
  const [first] = frames
  if (!first) return []
  const listed = connectorsOf(design, first.pageId)
  if (listed.length === 0) return []
  const boxes = endBoxes(frames, outlines, camera)
  return listed.flatMap(([id, { from, to }]) => {
    const [a, b] = [boxes.get(from), boxes.get(to)]
    return a && b ? [{ id, from, to, curve: connectorCurve(a, b) }] : []
  })
}

/** Where each frame and drawn section of the shown page is drawn as a connector's end, by its id, in screen pixels. */
export function endBoxes(
  frames: readonly Frame[],
  outlines: readonly SectionOutline[],
  camera: Camera,
): Map<string, Rect> {
  const boxes = new Map<string, Rect>()
  for (const frame of frames) boxes.set(frame.id, frameEndBox(frame, camera))
  for (const { id, box } of outlines) boxes.set(id, box)
  return boxes
}

/** A frame as a connector's end on the stage, in screen pixels: its box with its label's row above it. */
export function frameEndBox(frame: Frame, camera: Camera): Rect {
  const at = toScreen(camera, frame)
  return {
    x: at.x,
    y: at.y - LABEL_ROOM,
    width: frame.width * camera.zoom,
    height: frame.height * camera.zoom + LABEL_ROOM,
  }
}

/**
 * The curve from box `a` to box `b`: between the middles of the two facing sides nearest each other,
 * END_GAP outside them, leaving and reaching them square, so it runs horizontally when the boxes sit
 * side by side and vertically when they are stacked.
 */
export function connectorCurve(a: Rect, b: Rect): ConnectorCurve {
  const across = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width))
  const down = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height))
  if (across >= down) {
    const right = b.x + b.width / 2 >= a.x + a.width / 2 ? 1 : -1
    const from = { x: right > 0 ? a.x + a.width + END_GAP : a.x - END_GAP, y: a.y + a.height / 2 }
    const to = { x: right > 0 ? b.x - END_GAP : b.x + b.width + END_GAP, y: b.y + b.height / 2 }
    const bend = right * Math.max(Math.abs(to.x - from.x) / 2, MIN_BEND)
    return { from, c1: { x: from.x + bend, y: from.y }, c2: { x: to.x - bend, y: to.y }, to }
  }
  const lower = b.y + b.height / 2 >= a.y + a.height / 2 ? 1 : -1
  const from = { x: a.x + a.width / 2, y: lower > 0 ? a.y + a.height + END_GAP : a.y - END_GAP }
  const to = { x: b.x + b.width / 2, y: lower > 0 ? b.y - END_GAP : b.y + b.height + END_GAP }
  const bend = lower * Math.max(Math.abs(to.y - from.y) / 2, MIN_BEND)
  return { from, c1: { x: from.x, y: from.y + bend }, c2: { x: to.x, y: to.y - bend }, to }
}

/** The angle the curve reaches its end at, in radians from the x axis, which its arrowhead points along. */
export function arrowAngle({ from, c1, c2, to }: ConnectorCurve): number {
  const before = [c2, c1, from].find((p) => p.x !== to.x || p.y !== to.y) ?? from
  return Math.atan2(to.y - before.y, to.x - before.x)
}

/** Whether a stage point is within `reach` screen pixels of a curve. */
export function nearCurve(curve: ConnectorCurve, p: Point, reach = CONNECTOR_REACH): boolean {
  const { from, c1, c2, to } = curve
  const xs = [from.x, c1.x, c2.x, to.x]
  const ys = [from.y, c1.y, c2.y, to.y]
  // The curve lies inside the box round its four points.
  if (p.x < Math.min(...xs) - reach || p.x > Math.max(...xs) + reach) return false
  if (p.y < Math.min(...ys) - reach || p.y > Math.max(...ys) + reach) return false
  let last = from
  for (let i = 1; i <= PIECES; i++) {
    const next = pointOn(curve, i / PIECES)
    if (segmentDistance(p, last, next) <= reach) return true
    last = next
  }
  return false
}

/** The connector on top at a stage point: the last by order whose curve is within CONNECTOR_REACH of it. */
export function connectorAt(shown: readonly ShownConnector[], p: Point): ShownConnector | undefined {
  return shown.findLast(({ curve }) => nearCurve(curve, p))
}

/** The point at `t`, from 0 to 1, along a curve. */
function pointOn({ from, c1, c2, to }: ConnectorCurve, t: number): Point {
  const u = 1 - t
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
  return { x: a * from.x + b * c1.x + c * c2.x + d * to.x, y: a * from.y + b * c1.y + c * c2.y + d * to.y }
}

/** How far a point is from the straight piece between `a` and `b`. */
function segmentDistance(p: Point, a: Point, b: Point) {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
