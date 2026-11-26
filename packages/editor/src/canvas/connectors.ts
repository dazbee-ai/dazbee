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
/** A connector's arrowhead, in screen pixels: its tip, at the curve's end, and the two corners of its base. */
export interface Arrowhead {
  tip: Point
  left: Point
  right: Point
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

/** An arrowhead's length along the curve and its half-width across it, in screen pixels. */
export const ARROW_LENGTH = 7
export const ARROW_HALF_WIDTH = 3.5

/** How far a control point stands off its end at least, in screen pixels, so close ends still curve. */
const MIN_BEND = 24
/** The most the ends' distance across the way the curve leaves adds to its bend, in screen pixels. */
const MAX_CROSS_BEND = 80
/** The sides of a box, each by the way it faces, in the order a tie between them is settled. */
const SIDES = [
  { out: { x: 1, y: 0 } },
  { out: { x: -1, y: 0 } },
  { out: { x: 0, y: 1 } },
  { out: { x: 0, y: -1 } },
] as const
/** The points along a curve checked against the boxes it must pass round. */
const CUT_SAMPLES = 48
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
 * The curve from box `a` to box `b`, as both are drawn on the stage, that passes through neither.
 * First choice: between the middles of the two facing sides nearest each other, END_GAP outside
 * them, leaving and reaching them square, so it runs horizontally when the boxes sit side by side and
 * vertically when they are stacked. It stands off each side by half the distance between the sides,
 * and by half the ends' distance across (up to MAX_CROSS_BEND) when that is more, so ends far apart
 * across but close along still meet in a smooth S. When that curve would cut through either box, the
 * same sides are tried with the curve kept between them (`tight`), then the facing sides the other
 * way, then the same side of both, round the outside of them (the side where the two are nearest in
 * line first). The boxes are the drawn ones, so the choice holds at
 * every zoom; when no route clears both, the one that cuts through least is taken.
 */
export function connectorCurve(a: Rect, b: Rect): ConnectorCurve {
  const across = Math.max(b.x - (a.x + a.width), a.x - (b.x + b.width))
  const down = Math.max(b.y - (a.y + a.height), a.y - (b.y + b.height))
  const [first, other] = across >= down ? [facingAcross, facingDown] : [facingDown, facingAcross]
  const routes = [first(a, b), first(a, b, true), other(a, b), ...sameSideCurves(a, b)]
  let best: { curve: ConnectorCurve; cuts: number } | null = null
  for (const curve of routes) {
    const cuts = cutsThrough(curve, a, b)
    if (cuts === 0) return curve
    if (!best || cuts < best.cuts) best = { curve, cuts }
  }
  return best?.curve ?? facingAcross(a, b)
}

/**
 * A curve's arrowhead at its end, ARROW_LENGTH long and pointing along the curve's last stretch: from
 * the point that far back along the curve to its end, and the curve cut at that point, which the line
 * is drawn along so it stops at the head's base.
 */
export function arrowheadOf(curve: ConnectorCurve): { head: Arrowhead; line: ConnectorCurve } {
  const t = arrowBaseAt(curve)
  const base = pointOn(curve, t)
  const { to } = curve
  const length = Math.hypot(to.x - base.x, to.y - base.y) || 1
  // Along the head, from its base to its tip, and across it.
  const [ux, uy] = [(to.x - base.x) / length, (to.y - base.y) / length]
  const back = { x: to.x - ux * ARROW_LENGTH, y: to.y - uy * ARROW_LENGTH }
  const head = {
    tip: to,
    left: { x: back.x - uy * ARROW_HALF_WIDTH, y: back.y + ux * ARROW_HALF_WIDTH },
    right: { x: back.x + uy * ARROW_HALF_WIDTH, y: back.y - ux * ARROW_HALF_WIDTH },
  }
  return { head, line: curveUntil(curve, t) }
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

/**
 * The curve between the facing left and right sides of two boxes, from `a`'s to `b`'s; `tight`, its
 * control points no further out than halfway between the sides, so it stays between them.
 */
function facingAcross(a: Rect, b: Rect, tight = false): ConnectorCurve {
  const right = b.x + b.width / 2 >= a.x + a.width / 2 ? 1 : -1
  const from = { x: right > 0 ? a.x + a.width + END_GAP : a.x - END_GAP, y: a.y + a.height / 2 }
  const to = { x: right > 0 ? b.x - END_GAP : b.x + b.width + END_GAP, y: b.y + b.height / 2 }
  const bend = right * (tight ? Math.abs(to.x - from.x) / 2 : bendOf(to.x - from.x, to.y - from.y))
  return { from, c1: { x: from.x + bend, y: from.y }, c2: { x: to.x - bend, y: to.y }, to }
}

/** The curve between the facing top and bottom sides of two boxes, from `a`'s to `b`'s; `tight` as for `facingAcross`. */
function facingDown(a: Rect, b: Rect, tight = false): ConnectorCurve {
  const lower = b.y + b.height / 2 >= a.y + a.height / 2 ? 1 : -1
  const from = { x: a.x + a.width / 2, y: lower > 0 ? a.y + a.height + END_GAP : a.y - END_GAP }
  const to = { x: b.x + b.width / 2, y: lower > 0 ? b.y - END_GAP : b.y + b.height + END_GAP }
  const bend = lower * (tight ? Math.abs(to.y - from.y) / 2 : bendOf(to.y - from.y, to.x - from.x))
  return { from, c1: { x: from.x, y: from.y + bend }, c2: { x: to.x, y: to.y - bend }, to }
}

/**
 * The curves from the middle of one side of box `a` to the middle of the same side of box `b`, round
 * the outside of both, for each side whose two ends lie clear of the other box: the side where the
 * two are nearest in line first (right, left, bottom, top on a tie). Both control points stand past
 * the outer of the two sides, so the curve leaves and reaches them square.
 */
function sameSideCurves(a: Rect, b: Rect): ConnectorCurve[] {
  const routes: { curve: ConnectorCurve; apart: number }[] = []
  for (const side of SIDES) {
    const [from, to] = [sidePoint(a, side), sidePoint(b, side)]
    if (holds(b, from) || holds(a, to)) continue
    const out = side.out
    // How far out each end is along the way the side faces, and the distance across between them.
    const reach = (p: Point) => p.x * out.x + p.y * out.y
    const apart = Math.abs(reach(from) - reach(to))
    const across = Math.abs(out.x === 0 ? to.x - from.x : to.y - from.y)
    const stand = Math.max(Math.min(across / 2, MAX_CROSS_BEND), MIN_BEND)
    const beyond = (p: Point) => Math.max(reach(from), reach(to)) - reach(p) + stand
    const control = (p: Point) => ({ x: p.x + out.x * beyond(p), y: p.y + out.y * beyond(p) })
    routes.push({ curve: { from, c1: control(from), c2: control(to), to }, apart })
  }
  return routes.sort((x, y) => x.apart - y.apart).map(({ curve }) => curve)
}

/**
 * How many of a curve's points, CUT_SAMPLES of them along it, fall inside either box: 0 for a curve
 * that passes through neither. A curve whose control points' box meets neither box's inside passes
 * through neither, without sampling.
 */
function cutsThrough(curve: ConnectorCurve, a: Rect, b: Rect): number {
  const { from, c1, c2, to } = curve
  const hull = {
    x: Math.min(from.x, c1.x, c2.x, to.x),
    y: Math.min(from.y, c1.y, c2.y, to.y),
    width: Math.max(from.x, c1.x, c2.x, to.x) - Math.min(from.x, c1.x, c2.x, to.x),
    height: Math.max(from.y, c1.y, c2.y, to.y) - Math.min(from.y, c1.y, c2.y, to.y),
  }
  const inner = [a, b].filter((box) => overlaps(hull, box))
  if (inner.length === 0) return 0
  let cuts = 0
  for (let i = 0; i <= CUT_SAMPLES; i++) {
    const p = pointOn(curve, i / CUT_SAMPLES)
    if (inner.some((box) => strictlyIn(box, p))) cuts += 1
  }
  return cuts
}

/** Whether two boxes' insides meet: touching edges don't count. */
function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

/** Whether a point lies inside a box, more than half a pixel in from its edges. */
function strictlyIn(box: Rect, p: Point) {
  return p.x > box.x + 0.5 && p.x < box.x + box.width - 0.5 && p.y > box.y + 0.5 && p.y < box.y + box.height - 0.5
}

/** The middle of a box's side, END_GAP outside it, the side by the way it faces. */
function sidePoint(box: Rect, { out }: (typeof SIDES)[number]): Point {
  const [midX, midY] = [box.x + box.width / 2, box.y + box.height / 2]
  return {
    x: out.x === 0 ? midX : midX + out.x * (box.width / 2 + END_GAP),
    y: out.y === 0 ? midY : midY + out.y * (box.height / 2 + END_GAP),
  }
}

/** Whether a point lies inside a box, its edges included. */
function holds(box: Rect, p: Point) {
  return p.x >= box.x && p.x <= box.x + box.width && p.y >= box.y && p.y <= box.y + box.height
}

/** How far a curve's control points stand off its ends: `along` and `across` are the ends' distances the way it leaves and across it. */
function bendOf(along: number, across: number) {
  return Math.max(Math.abs(along) / 2, Math.min(Math.abs(across) / 2, MAX_CROSS_BEND), MIN_BEND)
}

/** Where along a curve, from 0 to 1, its arrowhead's base is: ARROW_LENGTH back from its end, or its start on a shorter curve. */
function arrowBaseAt(curve: ConnectorCurve) {
  const { to } = curve
  const away = (t: number) => {
    const p = pointOn(curve, t)
    return Math.hypot(to.x - p.x, to.y - p.y)
  }
  if (away(0) <= ARROW_LENGTH) return 0
  // Back from the end in small steps until past the head, then halved down onto it.
  let [near, far] = [1, 1]
  while (far > 0 && away(far) < ARROW_LENGTH) [near, far] = [far, Math.max(0, far - 1 / 64)]
  for (let i = 0; i < 12; i++) {
    const mid = (near + far) / 2
    if (away(mid) < ARROW_LENGTH) near = mid
    else far = mid
  }
  return far
}

/** The point at `t`, from 0 to 1, along a curve. */
function pointOn({ from, c1, c2, to }: ConnectorCurve, t: number): Point {
  const u = 1 - t
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
  return { x: a * from.x + b * c1.x + c * c2.x + d * to.x, y: a * from.y + b * c1.y + c * c2.y + d * to.y }
}

/** The part of a curve from its start to `t`, from 0 to 1, as a curve of its own. */
function curveUntil({ from, c1, c2, to }: ConnectorCurve, t: number): ConnectorCurve {
  const lerp = (p: Point, q: Point) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t })
  const [a, b, c] = [lerp(from, c1), lerp(c1, c2), lerp(c2, to)]
  const [d, e] = [lerp(a, b), lerp(b, c)]
  return { from, c1: a, c2: d, to: lerp(d, e) }
}

/** How far a point is from the straight piece between `a` and `b`. */
function segmentDistance(p: Point, a: Point, b: Point) {
  const [dx, dy] = [b.x - a.x, b.y - a.y]
  const length = dx * dx + dy * dy
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
