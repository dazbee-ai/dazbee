// Shape fitting: the Dazbee shape that best covers a part's coverage. Each kind starts in closed
// form (moments for the centre and angle, the coverage's reach for the size, the area for a
// rectangle's radius), then the three best kinds are refined by drawing: each step draws the shape
// with Dazbee's renderer and keeps it when its soft IoU with the coverage rises.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Paint } from '@dazbee/schema'

import { coverage, type ShapeLayer } from './draw-layers.ts'
import type { FitWindow } from './fit-window.ts'

/** The kinds of shape the first pass fits. */
export type ShapeKind = 'rect' | 'ellipse' | 'line'

/** A shape's settings, in piece pixels and degrees. */
export interface ShapeFit {
  kind: ShapeKind
  cx: number
  cy: number
  width: number
  height: number
  rotation: number
  /** A rectangle's corner radius; for a line, 1 for round ends. */
  radius: number
  /** The stroke's width; for a ring, the shape is the outer edge and the stroke sits inside it. */
  stroke: number
  /** Drawn by its stroke alone, with no fill. */
  strokeOnly: boolean
}

/** The best fit, and its soft IoU with the coverage. */
export interface Fitted {
  fit: ShapeFit
  iou: number
}

/** Coverage at or past which a pixel counts towards a shape's reach. */
const REACH_FROM = 0.3
/** A kind within this IoU of the best that is simpler wins. */
const SIMPLER_BY = 0.004
const WHITE: Paint = { type: 'solid', color: '#FFFFFFFF' }

/**
 * The best shape for a window among the kinds allowed. For a ring, the shapes start from the window
 * and are judged against `ring.target`, the ring itself, with its stroke.
 */
export function fitShape(
  ck: CanvasKit,
  window: FitWindow,
  options: { draws: number; kinds: readonly ShapeKind[] },
  ring?: { target: FitWindow; stroke: number },
): Fitted {
  const starts = startsOf(window, options.kinds).map((fit) =>
    ring ? { ...fit, strokeOnly: true, stroke: ring.stroke } : fit,
  )
  const target = ring?.target ?? window
  // Nothing covered to start from: the window's box at IoU 0, which every caller takes as a poor fit.
  if (starts.length === 0) return { fit: windowBox(window, ring?.stroke), iou: 0 }
  const scored = starts.map((fit) => {
    return { fit, iou: iouOf(ck, fit, target) }
  })
  scored.sort((a, b) => b.iou - a.iou)
  // The three best kinds are refined: the leading one with every draw allowed, the others a quarter.
  const leaders: Fitted[] = []
  const kinds = new Set<ShapeKind>()
  for (const s of scored) {
    if (kinds.has(s.fit.kind)) continue
    kinds.add(s.fit.kind)
    leaders.push(s)
    if (leaders.length >= 3) break
  }
  const refined = leaders.map((s, i) =>
    refine(ck, s.fit, s.iou, target, i === 0 ? options.draws : Math.floor(options.draws / 4)),
  )
  refined.sort((a, b) => b.iou - a.iou)
  const bestIoU = refined[0]?.iou ?? 0
  const simplest = refined
    .filter((r) => r.iou >= bestIoU - SIMPLER_BY)
    .sort((a, b) => complexity(a.fit) - complexity(b.fit))
  return simplest[0] ?? { fit: windowBox(window, ring?.stroke), iou: 0 }
}

/** The graphic a shape's settings draw, filled with the paint, or stroked with it for a ring or a line. */
export function shapeLayer(fit: ShapeFit, paint: Paint, name = 'Shape'): ShapeLayer {
  const box = {
    x: fit.cx - fit.width / 2,
    y: fit.cy - fit.height / 2,
    width: Math.max(0.01, fit.width),
    height: Math.max(0.01, fit.height),
    rotation: fit.rotation,
  }
  if (fit.kind === 'line') {
    return {
      type: 'graphic',
      name,
      props: {
        ...box,
        shape: { kind: 'line', start: 'none', end: 'none' },
        fills: [],
        strokes: [{ paint, width: Math.max(0.1, fit.height), align: 'center', cap: fit.radius > 0 ? 'round' : 'butt' }],
      },
    }
  }
  return {
    type: 'graphic',
    name,
    props: {
      ...box,
      shape: fit.kind === 'rect' ? { kind: 'rect', cornerRadius: Math.max(0, fit.radius) } : { kind: 'ellipse' },
      fills: fit.strokeOnly ? [] : [paint],
      strokes: fit.strokeOnly ? [{ paint, width: Math.max(0.1, fit.stroke), align: 'inside' }] : [],
    },
  }
}

/** The soft IoU of two coverages, leaving out the pixels `free` covers by half or more. */
export function softIoU(a: Float32Array, b: Float32Array, free?: Float32Array): number {
  let overlap = 0
  let union = 0
  for (let i = 0; i < a.length; i++) {
    if (free && (free[i] ?? 0) >= 0.5) continue
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    overlap += x < y ? x : y
    union += x > y ? x : y
  }
  return union > 0 ? overlap / union : 1
}

/** The soft IoU of a shape drawn by Dazbee's renderer with a window's mask. */
function iouOf(ck: CanvasKit, fit: ShapeFit, window: FitWindow): number {
  const layer = shapeLayer(fit, WHITE)
  const moved: ShapeLayer = {
    ...layer,
    props: { ...layer.props, x: layer.props.x - window.offsetX, y: layer.props.y - window.offsetY },
  }
  return softIoU(
    coverage(ck, moved, window.pieceWidth, window.pieceHeight, window.scale, window.width, window.height),
    window.mask,
    window.free,
  )
}

/** The window's own box as a rectangle, stroked only when given a stroke. */
function windowBox(window: FitWindow, stroke?: number): ShapeFit {
  return {
    kind: 'rect',
    cx: window.offsetX + window.pieceWidth / 2,
    cy: window.offsetY + window.pieceHeight / 2,
    width: window.pieceWidth,
    height: window.pieceHeight,
    rotation: 0,
    radius: 0,
    stroke: stroke ?? 0,
    strokeOnly: stroke !== undefined,
  }
}

/** How plain a shape is to edit: a rounded rectangle is a hair less plain than a square one. */
function complexity(fit: ShapeFit): number {
  return fit.radius > 0 ? 0.1 : 0
}

/**
 * Where each kind starts: the centre from the mask's moments, at 0° and, when the mask is clearly
 * turned, at its own angle; the size from its reach along those axes; a rectangle at the radius its
 * area gives, as a pill and square; a line when it is long and thin.
 */
function startsOf(window: FitWindow, kinds: readonly ShapeKind[]): ShapeFit[] {
  const { width, height, mask, scale } = window
  let area = 0
  let sx = 0
  let sy = 0
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = mask[y * width + x] ?? 0
      area += v
      sx += v * (x + 0.5)
      sy += v * (y + 0.5)
    }
  if (area <= 0) return []
  const cx = sx / area
  const cy = sy / area
  let mxx = 0
  let myy = 0
  let mxy = 0
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = mask[y * width + x] ?? 0
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      mxx += v * dx * dx
      myy += v * dy * dy
      mxy += v * dx * dy
    }
  mxx /= area
  myy /= area
  mxy /= area
  const theta = 0.5 * Math.atan2(2 * mxy, mxx - myy)
  const degrees = (theta * 180) / Math.PI
  // A shape turned only a little is levelled: a designer sets 0°, not 1.3°.
  const angles = new Set<number>([0])
  const nearest90 = Math.round(degrees / 90) * 90
  if (Math.abs(degrees - nearest90) > 2.5 && Math.abs(mxx - myy) > 0.05 * (mxx + myy)) angles.add(degrees)
  const starts: ShapeFit[] = []
  const pieceArea = area / (scale * scale)
  for (const rotation of angles) {
    const reach = reachOf(window, cx, cy, rotation)
    const w = reach.width / scale
    const h = reach.height / scale
    const base = {
      cx: reach.cx / scale + window.offsetX,
      cy: reach.cy / scale + window.offsetY,
      width: w,
      height: h,
      rotation,
      radius: 0,
      stroke: 0,
      strokeOnly: false,
    }
    if (kinds.includes('rect')) {
      // A rounded rectangle's area is wh − (4 − π)r².
      const radius = Math.sqrt(Math.max(0, (w * h - pieceArea) / (4 - Math.PI)))
      starts.push({ ...base, kind: 'rect', radius: Math.min(radius, Math.min(w, h) / 2) })
      starts.push({ ...base, kind: 'rect', radius: Math.min(w, h) / 2 })
      starts.push({ ...base, kind: 'rect', radius: 0 })
    }
    if (kinds.includes('ellipse')) starts.push({ ...base, kind: 'ellipse' })
    if (kinds.includes('line') && Math.min(w, h) <= 10 && Math.max(w, h) >= 6 * Math.min(w, h)) {
      const along = w >= h
      const line = {
        ...base,
        kind: 'line' as const,
        width: along ? w : h,
        height: along ? h : w,
        rotation: along ? rotation : rotation + 90,
      }
      starts.push({ ...line, radius: 0 }, { ...line, radius: 1 })
    }
  }
  return starts
}

/** The centre and size along the axes turned by `rotation`: where the coverage reaches, with sub-pixel edges. */
function reachOf(window: FitWindow, cx: number, cy: number, rotation: number) {
  const { width, height, mask } = window
  const cos = Math.cos((rotation * Math.PI) / 180)
  const sin = Math.sin((rotation * Math.PI) / 180)
  let u0 = Infinity
  let u1 = -Infinity
  let v0 = Infinity
  let v1 = -Infinity
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = mask[y * width + x] ?? 0
      // A blurred edge's faint tail is not the edge.
      if (v < REACH_FROM) continue
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const u = dx * cos + dy * sin
      const w = -dx * sin + dy * cos
      // A partly covered pixel reaches (v − 0.5) past its centre.
      const past = v - 0.5
      u0 = Math.min(u0, u - past)
      u1 = Math.max(u1, u + past)
      v0 = Math.min(v0, w - past)
      v1 = Math.max(v1, w + past)
    }
  const uc = (u0 + u1) / 2
  const vc = (v0 + v1) / 2
  return { cx: cx + uc * cos - vc * sin, cy: cy + uc * sin + vc * cos, width: u1 - u0, height: v1 - v0 }
}

/** A coordinate search with shrinking steps, one drawing a step, kept while the IoU rises. */
function refine(ck: CanvasKit, start: ShapeFit, startIoU: number, window: FitWindow, budget: number): Fitted {
  let fit = { ...start }
  let iou = startIoU
  let draws = 0
  if (budget <= 0) return { fit, iou }
  const keys: (keyof ShapeFit & ('cx' | 'cy' | 'width' | 'height' | 'rotation' | 'radius' | 'stroke'))[] = [
    'cx',
    'cy',
    'width',
    'height',
  ]
  if (fit.rotation !== 0) keys.push('rotation')
  if (fit.kind === 'rect') keys.push('radius')
  if (fit.strokeOnly) keys.push('stroke')
  const unit = 1 / window.scale
  const stepOf = (key: (typeof keys)[number], scale: number) =>
    key === 'rotation' ? 2 * scale : Math.max(0.15, unit) * 2 * scale
  let scale = 2
  while (draws < budget && scale > 0.06) {
    let improved = false
    for (const key of keys) {
      for (const direction of [1, -1]) {
        if (draws >= budget) break
        const next = { ...fit, [key]: fit[key] + direction * stepOf(key, scale) }
        if (next.width <= 0.5 || next.height <= 0.1 || next.radius < 0 || next.stroke < 0) continue
        if (next.kind === 'rect' && next.radius > Math.min(next.width, next.height) / 2) {
          // A pill keeps its round ends as it narrows: the radius follows the size.
          if (key === 'radius') continue
          next.radius = Math.min(next.width, next.height) / 2
        }
        draws++
        const v = iouOf(ck, next, window)
        if (v > iou + 1e-5) {
          fit = next
          iou = v
          improved = true
          break
        }
      }
    }
    if (!improved) scale /= 2
  }
  return { fit, iou }
}
