// Boxes in a frame as the renderer draws them: in the frame's design pixels, a box's rotation turns
// it about its centre, and a container's rotation turns what is inside it about the container's
// centre. Commands that keep layers where they are on screen (group, ungroup, hug) and the
// editor's transforms share it.
import type { Point, Rect } from '@dazbee/schema'

export type { Point }
export interface Box {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}
/** Whether a layer is mirrored across its box's vertical (`flipX`) or horizontal (`flipY`) centre line. */
export type Flips = { flipX?: boolean | undefined; flipY?: boolean | undefined }

const rad = (deg: number) => (deg * Math.PI) / 180
export const centreOf = (b: Box): Point => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 })
export const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

/** Turns a point about a centre. */
export function turn(p: Point, about: Point, deg: number): Point {
  if (deg === 0) return p
  const a = rad(deg)
  const dx = p.x - about.x
  const dy = p.y - about.y
  return { x: about.x + dx * Math.cos(a) - dy * Math.sin(a), y: about.y + dx * Math.sin(a) + dy * Math.cos(a) }
}

/** A box's four corners in its frame, as drawn: nw, ne, se, sw. */
export function cornersOf(b: Box): Point[] {
  const c = centreOf(b)
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.width, y: b.y },
    { x: b.x + b.width, y: b.y + b.height },
    { x: b.x, y: b.y + b.height },
  ].map((p) => turn(p, c, b.rotation))
}

/** The unturned box around boxes as they are drawn. */
export function boundsOf(boxes: Box[]): Box {
  const points = boxes.flatMap(cornersOf)
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, rotation: 0 }
}

/**
 * A box carried along when the box around it changes from `from` to `to` (same rotation): its
 * place and size scale with the outer box's, in the outer box's own unturned space. This is how a
 * layer inside a resized group follows it.
 */
export function carry(inner: Box, from: Rect, to: Rect): Box {
  const sx = from.width > 0 ? to.width / from.width : 1
  const sy = from.height > 0 ? to.height / from.height : 1
  return {
    x: to.x + (inner.x - from.x) * sx,
    y: to.y + (inner.y - from.y) * sy,
    width: inner.width * sx,
    height: inner.height * sy,
    rotation: inner.rotation,
  }
}

/**
 * A box when an unturned box around it is scaled from `from` to `to`: its centre scales with the
 * outer box, and its size by how much the scale stretches it along its own turned sides; its turn
 * stays. This is how a layer in a selection of several follows the selection's resize, and how a
 * turned layer follows its parent's resize by its drawn bounds.
 */
export function scaleWithin(box: Box, from: Box, to: Box): Box {
  const sx = from.width > 0 ? to.width / from.width : 1
  const sy = from.height > 0 ? to.height / from.height : 1
  const c = centreOf(box)
  const centre = { x: to.x + (c.x - from.x) * sx, y: to.y + (c.y - from.y) * sy }
  const a = rad(box.rotation)
  const width = box.width * Math.hypot(sx * Math.cos(a), sy * Math.sin(a))
  const height = box.height * Math.hypot(sx * Math.sin(a), sy * Math.cos(a))
  return { x: centre.x - width / 2, y: centre.y - height / 2, width, height, rotation: box.rotation }
}

/** An angle in degrees as the schema keeps it, in (-180, 180]. */
export function normalAngle(deg: number) {
  const a = ((deg % 360) + 360) % 360
  return a > 180 ? a - 360 : a
}

/**
 * Rounds what goes into the document: hundredths of a pixel or degree. A number too large to scale
 * holds no hundredths, and comes back as it is.
 */
export function round(n: number, places = 2) {
  const scaled = n * 10 ** places
  return Number.isFinite(scaled) ? Math.round(scaled) / 10 ** places : n
}

/** The flips of a layer's props, the flags alone; none for a layer that takes none, such as a group. */
export function flipsOf(props: object): Flips {
  const { flipX, flipY } = props as Flips
  return { flipX, flipY }
}

/**
 * A point mirrored across a box's centre lines as the box's flips say: where a flipped layer draws
 * what it would draw at the point unflipped, and the other way round.
 */
export function flippedPoint(p: Point, box: Rect & Flips): Point {
  return {
    x: box.flipX ? 2 * box.x + box.width - p.x : p.x,
    y: box.flipY ? 2 * box.y + box.height - p.y : p.y,
  }
}

/** A rect mirrored about a box's centre as the box's flips say. */
export function flippedRect(rect: Rect, box: Rect & Flips): Rect {
  return {
    x: box.flipX ? 2 * box.x + box.width - rect.x - rect.width : rect.x,
    y: box.flipY ? 2 * box.y + box.height - rect.y - rect.height : rect.y,
    width: rect.width,
    height: rect.height,
  }
}
