// Dashed strokes: marks of one colour along the edge of their box are one dashed stroke along an
// outline, not many small shapes. The marks, closed into a ring, give the outline's shape, fitted as
// any part's; when uneven dashes leave the ring open, their convex hull does. The marks' count, area
// and edge length give the stroke's width, dash and gap; the dash period is searched within 15% of
// the count's, with where the pattern starts, then everything is refined by drawing.

import type { CanvasKit } from '@dazbee/canvaskit'
import { cornerAt, drawnAtCorner, shapePoints } from '@dazbee/renderer'

import type { ShapeLayer } from './draw-layers.ts'
import { flatPaint } from './first-pass.ts'
import {
  fitShape,
  type Fitted,
  iouOf,
  refine,
  type ShapeFit,
  type ShapeKind,
  shapeLayer,
  shapeOf,
} from './fit/fit-shapes.ts'
import { windowOf } from './fit/fit-window.ts'
import { dashedName } from './layer-names.ts'
import { contours } from './parts/contours.ts'
import type { FloatPicture } from './parts/float-picture.ts'
import type { MarkedPart } from './parts/marks.ts'
import { sum } from './parts/stacking.ts'

/** The fewest marks that may be a dashed stroke. */
const FEWEST_DASHES = 6
/** Marks are along their box's edge when this share of them lies in its outer band. */
const ALONG_EDGE = 0.8
/** The outer band's width, as a share of the box's shorter side, at least 2 pixels. */
const EDGE_BAND = 0.15
/** The radii, in fitting pixels, the marks are grown by until they close into a ring. */
const CLOSING_RADII = [2, 3, 4, 6, 8, 10, 12]
/** Grown marks are a closed ring when the hole they enclose is over this share of what they fill. */
const RING_HOLE = 0.25
/** Fitting pixels a window reaches past the marks' box. */
const WINDOW_PAD = 4
/** Drawings refining the outline's shape before the dashes are searched. */
const OUTLINE_DRAWS = 20
/** The thinnest stroke, in piece pixels. */
const THINNEST = 0.8
/** A dash is at most this share of its period. */
const LONGEST_DASH = 0.9
/** The shortest gap, in piece pixels. */
const SHORTEST_GAP = 0.5
/** The dash periods searched, as shares of the count's, and the pattern's starts tried at each. */
const PERIOD_FROM = 0.85
const PERIOD_TO = 1.151
const PERIOD_STEP = 0.015
const STARTS = 12
/** A dashed stroke holding its marks below this soft IoU is no dashed stroke. */
const LEAST_IOU = 0.4

/**
 * A group of six or more marks along the edge of their box as one graphic with a dashed stroke along
 * an outline, in the marks' colour; null when the part is not such marks or no dashed stroke holds them.
 */
export function dashedStroke(
  ck: CanvasKit,
  part: MarkedPart,
  fitted: FloatPicture,
  scale: number,
  settings: { draws: number; kinds: readonly ShapeKind[] },
): ShapeLayer | null {
  if (!part.marks || part.marks < FEWEST_DASHES || !alongEdge(part, fitted.width)) return null
  const { width, height } = fitted
  const ring = closedRing(part.mask, width, height)
  const outline = ring
    ? fitShape(ck, windowOf(ring, width, height, scale, part.box, WINDOW_PAD), {
        draws: OUTLINE_DRAWS,
        kinds: ['rect', 'ellipse'],
      })
    : fitShape(ck, windowOf(hullMask(part.mask, width, height), width, height, scale, part.box, WINDOW_PAD), {
        draws: OUTLINE_DRAWS,
        kinds: settings.kinds.filter((kind) => kind !== 'line'),
      })
  const target = windowOf(part.mask, width, height, scale, part.box, WINDOW_PAD)
  // Each mark is about l × t: l + t is half its edge, l·t its area.
  let edge = 0
  for (const loop of contours(part.mask, width, height, 0.5))
    for (let i = 0; i < loop.length; i++) {
      const a = loop[i] ?? [0, 0]
      const b = loop[(i + 1) % loop.length] ?? [0, 0]
      edge += Math.hypot(a[0] - b[0], a[1] - b[1])
    }
  const { marks } = part
  const area = sum(part.mask) / marks / (scale * scale)
  const half = edge / marks / 2 / scale
  const stroke = Math.max(THINNEST, (half - Math.sqrt(Math.max(0, half * half - 4 * area))) / 2)
  const period = perimeterOf(outline.fit) / marks
  const dash = Math.min(period * LONGEST_DASH, area / stroke)
  let best: Fitted = {
    fit: {
      ...outline.fit,
      strokeOnly: true,
      stroke,
      dash,
      gap: Math.max(SHORTEST_GAP, period - dash),
      dashOffset: 0,
    },
    iou: -1,
  }
  // The period from the count is rough (specks count as marks) and its error adds up round the
  // outline: periods within 15% are searched with the pattern's start.
  const duty = dash / period
  for (let share = PERIOD_FROM; share <= PERIOD_TO; share += PERIOD_STEP) {
    const length = period * share
    for (let k = 0; k < STARTS; k++) {
      const fit: ShapeFit = {
        ...best.fit,
        dash: length * duty,
        gap: Math.max(SHORTEST_GAP, length * (1 - duty)),
        dashOffset: (length * k) / STARTS,
      }
      const iou = iouOf(ck, fit, target)
      if (iou > best.iou) best = { fit, iou }
    }
  }
  const refined = refine(ck, best.fit, best.iou, target, settings.draws)
  if (refined.iou < LEAST_IOU) return null
  return shapeLayer(refined.fit, flatPaint(part), dashedName(part.rgb, refined.fit))
}

/** Whether most of a part's covered pixels lie in the outer band of its box: a frame, not a texture. */
function alongEdge(part: MarkedPart, width: number): boolean {
  const { x0, y0, x1, y1 } = part.box
  const band = Math.max(2, EDGE_BAND * Math.min(x1 - x0, y1 - y0))
  let near = 0
  let all = 0
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if ((part.mask[y * width + x] ?? 0) < 0.5) continue
      all++
      if (x - x0 < band || x1 - x < band || y - y0 < band || y1 - y < band) near++
    }
  return all > 0 && near >= ALONG_EDGE * all
}

/**
 * The marks closed into a filled ring's outer outline: grown until they enclose a hole, every hole
 * filled, then shrunk back; null when no growth closes them.
 */
function closedRing(mask: Float32Array, width: number, height: number): Float32Array | null {
  const marks = new Float32Array(mask.length)
  for (let i = 0; i < marks.length; i++) marks[i] = (mask[i] ?? 0) >= 0.5 ? 1 : 0
  for (const radius of CLOSING_RADII) {
    const grown = morph(marks, width, height, radius, true)
    const filled = fillHoles(grown, width, height)
    if (sum(filled) - sum(grown) > RING_HOLE * sum(filled)) return morph(filled, width, height, radius, false)
  }
  return null
}

/**
 * The length of a shape's outline: Ramanujan's for an ellipse, a rounded rectangle's for a
 * rectangle, and for a polygon or a star its edges between the corners Dazbee draws, each rounded
 * corner's arc in place of the two straight runs it cuts off.
 */
function perimeterOf(fit: ShapeFit): number {
  const { width: w, height: h } = fit
  if (fit.kind === 'ellipse')
    return Math.PI * ((3 * (w + h)) / 2 - Math.sqrt(((3 * w) / 2 + h / 2) * (w / 2 + (3 * h) / 2)))
  const shape = shapeOf(fit)
  if (shape.kind !== 'polygon' && shape.kind !== 'star') return 2 * (w + h) - (8 - 2 * Math.PI) * fit.radius
  const corners = shapePoints({ x: 0, y: 0, width: w, height: h }, shape)
  let length = 0
  corners.forEach((at, i) => {
    const prev = corners[(i + corners.length - 1) % corners.length] ?? at
    const next = corners[(i + 1) % corners.length] ?? at
    length += Math.hypot(next[0] - at[0], next[1] - at[1])
    const { half, limit } = cornerAt(prev, at, next)
    const radius = drawnAtCorner(shape.cornerRadius, limit)
    if (radius > 0 && half > 0) length -= (2 * radius) / Math.tan(half) - radius * (Math.PI - 2 * half)
  })
  return length
}

/** A 0/1 mask of the convex hull of a mask's covered pixels (monotone chain). */
function hullMask(mask: Float32Array, width: number, height: number): Float32Array {
  type Point = [number, number]
  const points: Point[] = []
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) if ((mask[y * width + x] ?? 0) >= 0.5) points.push([x + 0.5, y + 0.5])
  points.sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: Point, a: Point, b: Point) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const chain = (list: readonly Point[]) => {
    const out: Point[] = []
    for (const p of list) {
      while (out.length >= 2) {
        const a = out[out.length - 2]
        const b = out[out.length - 1]
        if (!a || !b || cross(a, b, p) > 0) break
        out.pop()
      }
      out.push(p)
    }
    out.pop()
    return out
  }
  const hull = [...chain(points), ...chain([...points].reverse())]
  const out = new Float32Array(width * height)
  if (hull.length < 3) return out
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const p: Point = [x + 0.5, y + 0.5]
      let inside = true
      for (let k = 0; k < hull.length && inside; k++) {
        const a = hull[k]
        const b = hull[(k + 1) % hull.length]
        if (a && b && cross(a, b, p) < 0) inside = false
      }
      if (inside) out[y * width + x] = 1
    }
  return out
}

/** A 0/1 mask grown (dilated) or shrunk (eroded) by a square of the radius. */
function morph(mask: Float32Array, width: number, height: number, radius: number, grow: boolean): Float32Array {
  const across = new Float32Array(mask.length)
  const out = new Float32Array(mask.length)
  const pick = grow ? Math.max : Math.min
  const outside = grow ? 0 : 1
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let v = outside
      for (let d = -radius; d <= radius; d++) {
        const xx = x + d
        v = pick(v, xx < 0 || xx >= width ? outside : (mask[y * width + xx] ?? 0))
      }
      across[y * width + x] = v
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let v = outside
      for (let d = -radius; d <= radius; d++) {
        const yy = y + d
        v = pick(v, yy < 0 || yy >= height ? outside : (across[yy * width + x] ?? 0))
      }
      out[y * width + x] = v
    }
  return out
}

/** A 0/1 mask with every hole filled: all that the outside can't reach. */
function fillHoles(mask: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(mask.length).fill(1)
  const stack: number[] = []
  const flood = (i: number) => {
    if ((mask[i] ?? 0) < 0.5 && out[i] === 1) {
      out[i] = 0
      stack.push(i)
    }
  }
  for (let x = 0; x < width; x++) for (const y of [0, height - 1]) flood(y * width + x)
  for (let y = 0; y < height; y++) for (const x of [0, width - 1]) flood(y * width + x)
  while (stack.length) {
    const i = stack.pop() ?? 0
    const x = i % width
    for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
      if (j < 0 || j >= width * height || out[j] === 0 || (mask[j] ?? 0) >= 0.5) continue
      out[j] = 0
      stack.push(j)
    }
  }
  return out
}
