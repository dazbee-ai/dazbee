// Shape fitting: a shape's settings, and the regular polygon or star that best covers a patch's
// coverage. Each kind starts in closed form (the coverage's centre of mass and reach for the centre
// and size, its rotational symmetry for a polygon's sides or a star's points and for the turn), then
// is refined by drawing: each step draws the shape with Dazbee's renderer and keeps it when its soft
// IoU with the coverage rises. The neighbouring counts are tried too.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Paint, Shape } from '@dazbee/schema'

import { coverage, type ShapeLayer } from '../draw-layers.ts'
import type { FitWindow } from './fit-window.ts'
import { MOST_SIDES, neighbourCounts, symmetryOf } from './symmetry.ts'

/** The kinds of shape a patch can be. */
export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'polygon' | 'star'

/** A shape's settings, in piece pixels and degrees. */
export interface ShapeFit {
  kind: ShapeKind
  cx: number
  cy: number
  width: number
  height: number
  rotation: number
  /** A rectangle's, polygon's or star's corner radius, the largest of a rectangle's four. */
  radius: number
  /** A polygon's sides or a star's points; 0 for the other kinds. */
  count: number
  /** A star's inner corners' reach, as a share of its outer; 0.5 for the other kinds. */
  innerRadius: number
  /** The stroke's width; for a ring, the shape is the outer edge and the stroke sits inside it. */
  stroke: number
  /** Drawn by its stroke alone, with no fill. */
  strokeOnly: boolean
}

/** A fit, and its soft IoU with the coverage. */
export interface Fitted<Fit extends ShapeFit = ShapeFit> {
  fit: Fit
  iou: number
}

/** The kinds fitted by drawing. */
type RegularKind = 'polygon' | 'star'

/** A polygon's or star's settings. */
type RegularFit = ShapeFit & { kind: RegularKind }

/** The settings a refining step moves: every number but the count and the stroke. */
type SteppedKey = Exclude<keyof ShapeFit, 'kind' | 'count' | 'stroke' | 'strokeOnly'>

/** Coverage at or past which a pixel counts towards a shape's reach. */
const REACH_FROM = 0.3
/** A star's inner radius moves this much, times the step's scale, at each refining step. */
const INNER_STEP = 0.04
/** A kind within this IoU of the best that is simpler wins. */
const SIMPLER_BY = 0.004
/** How plain each kind is to edit, the plainer the lower. */
const KIND_COMPLEXITY: Record<RegularKind, number> = { polygon: 1, star: 2 }
const WHITE: Paint = { type: 'solid', color: '#FFFFFFFF' }

/**
 * The best regular polygon or star for a window, among the kinds allowed. With nothing covered, or no
 * rotational symmetry to start from, the window's own box at IoU 0.
 */
export function fitShape(
  ck: CanvasKit,
  window: FitWindow,
  options: { draws: number; kinds: readonly RegularKind[] },
): Fitted {
  const scored = startsOf(window, options.kinds).map((fit) => {
    return { fit, iou: iouOf(ck, fit, window) }
  })
  scored.sort((a, b) => b.iou - a.iou)
  // The leading kind is refined with every draw allowed, the other with a quarter.
  const refined = scored
    .map((s, i) => refine(ck, s.fit, s.iou, window, i === 0 ? options.draws : Math.floor(options.draws / 4)))
    .map((fitted) => withBestCount(ck, fitted, window, options.draws))
  refined.sort((a, b) => b.iou - a.iou)
  const bestIoU = refined[0]?.iou ?? 0
  const simplest = refined
    .filter((r) => r.iou >= bestIoU - SIMPLER_BY)
    .sort((a, b) => complexity(a.fit) - complexity(b.fit))
  return simplest[0] ?? { fit: windowBox(window), iou: 0 }
}

/** The graphic a polygon's or star's settings draw, filled with the paint. */
export function shapeLayer(fit: ShapeFit, paint: Paint, name = 'Shape'): ShapeLayer {
  return {
    type: 'graphic',
    name,
    props: {
      x: fit.cx - fit.width / 2,
      y: fit.cy - fit.height / 2,
      width: Math.max(0.01, fit.width),
      height: Math.max(0.01, fit.height),
      rotation: fit.rotation,
      shape: shapeOf(fit),
      fills: [paint],
      strokes: [],
    },
  }
}

/**
 * Where each kind starts: centred and sized by the mask's reach about its centre of mass, with no
 * corner radius, at the count and turn its rotational symmetry gives, a star at the inner radius it
 * gives too. A polygon starts only at a count a polygon may have, and nothing starts on an empty mask
 * or one with no symmetry.
 */
function startsOf(window: FitWindow, kinds: readonly RegularKind[]): RegularFit[] {
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
  const reach = reachOf(window, sx / area, sy / area)
  const symmetry = symmetryOf(mask, width, height, reach.cx, reach.cy, reach.width / 2, reach.height / 2)
  if (!symmetry) return []
  const start = {
    cx: reach.cx / scale + window.offsetX,
    cy: reach.cy / scale + window.offsetY,
    width: reach.width / scale,
    height: reach.height / scale,
    rotation: symmetry.rotation,
    radius: 0,
    count: symmetry.count,
    innerRadius: 0.5,
    stroke: 0,
    strokeOnly: false,
  }
  const starts: RegularFit[] = []
  if (kinds.includes('polygon') && symmetry.count <= MOST_SIDES) starts.push({ ...start, kind: 'polygon' })
  if (kinds.includes('star')) starts.push({ ...start, kind: 'star', innerRadius: symmetry.innerRadius })
  return starts
}

/** The soft IoU of a shape drawn by Dazbee's renderer with a window's mask. */
function iouOf(ck: CanvasKit, fit: RegularFit, window: FitWindow): number {
  const layer = shapeLayer(fit, WHITE)
  const moved: ShapeLayer = {
    ...layer,
    props: { ...layer.props, x: layer.props.x - window.offsetX, y: layer.props.y - window.offsetY },
  }
  return softIoU(
    coverage(ck, moved, window.pieceWidth, window.pieceHeight, window.scale, window.width, window.height),
    window.mask,
  )
}

/** A coordinate search with shrinking steps, one drawing a step, kept while the IoU rises. */
function refine(
  ck: CanvasKit,
  start: RegularFit,
  startIoU: number,
  window: FitWindow,
  budget: number,
): Fitted<RegularFit> {
  let fit = { ...start }
  let iou = startIoU
  let draws = 0
  if (budget <= 0) return { fit, iou }
  const keys: SteppedKey[] = ['cx', 'cy', 'width', 'height', 'rotation', 'radius']
  if (fit.kind === 'star') keys.push('innerRadius')
  const unit = 1 / window.scale
  const stepOf = (key: SteppedKey, scale: number) =>
    key === 'rotation' ? 2 * scale : key === 'innerRadius' ? INNER_STEP * scale : Math.max(0.15, unit) * 2 * scale
  let scale = 2
  while (draws < budget && scale > 0.06) {
    let improved = false
    for (const key of keys) {
      for (const direction of [1, -1]) {
        if (draws >= budget) break
        const next = { ...fit, [key]: fit[key] + direction * stepOf(key, scale) }
        if (next.width <= 0.5 || next.height <= 0.1 || next.radius < 0) continue
        if (next.innerRadius <= 0.02 || next.innerRadius >= 1) continue
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

/**
 * A polygon or star at its best count: each neighbouring count at six turns is drawn, and the best,
 * when better than the fit, is refined again with half the draws.
 */
function withBestCount(
  ck: CanvasKit,
  fitted: Fitted<RegularFit>,
  window: FitWindow,
  draws: number,
): Fitted<RegularFit> {
  let best = fitted
  for (const { count, rotation } of neighbourCounts(fitted.fit.kind, fitted.fit.count, fitted.fit.rotation)) {
    const fit = { ...fitted.fit, count, rotation }
    const iou = iouOf(ck, fit, window)
    if (iou > best.iou) best = { fit, iou }
  }
  return best === fitted ? fitted : refine(ck, best.fit, best.iou, window, Math.floor(draws / 2))
}

/** How plain a shape is to edit: by its kind, and a rounded one a hair less plain than a sharp one. */
function complexity(fit: RegularFit): number {
  return KIND_COMPLEXITY[fit.kind] + (fit.radius > 0 ? 0.1 : 0)
}

/** The window's own box as a rectangle. */
function windowBox(window: FitWindow): ShapeFit {
  return {
    kind: 'rect',
    cx: window.offsetX + window.pieceWidth / 2,
    cy: window.offsetY + window.pieceHeight / 2,
    width: window.pieceWidth,
    height: window.pieceHeight,
    rotation: 0,
    radius: 0,
    count: 0,
    innerRadius: 0.5,
    stroke: 0,
    strokeOnly: false,
  }
}

/** A star's shape in the schema's words when the fit is one, else a polygon's. */
function shapeOf(fit: ShapeFit): Shape {
  const cornerRadius = Math.max(0, fit.radius)
  return fit.kind === 'star'
    ? { kind: 'star', points: fit.count, innerRadius: Math.max(0, Math.min(1, fit.innerRadius)), cornerRadius }
    : { kind: 'polygon', sides: fit.count, cornerRadius }
}

/** The centre and size of where the coverage reaches, measured from (cx, cy), with sub-pixel edges. */
function reachOf(window: FitWindow, cx: number, cy: number) {
  const { width, height, mask } = window
  let x0 = Infinity
  let x1 = -Infinity
  let y0 = Infinity
  let y1 = -Infinity
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const v = mask[y * width + x] ?? 0
      // A blurred edge's faint tail is not the edge.
      if (v < REACH_FROM) continue
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      // A partly covered pixel reaches (v − 0.5) past its centre.
      const past = v - 0.5
      x0 = Math.min(x0, dx - past)
      x1 = Math.max(x1, dx + past)
      y0 = Math.min(y0, dy - past)
      y1 = Math.max(y1, dy + past)
    }
  return { cx: cx + (x0 + x1) / 2, cy: cy + (y0 + y1) / 2, width: x1 - x0, height: y1 - y0 }
}

/** The soft IoU of two coverages. */
function softIoU(a: Float32Array, b: Float32Array): number {
  let overlap = 0
  let union = 0
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    overlap += x < y ? x : y
    union += x > y ? x : y
  }
  return union > 0 ? overlap / union : 1
}
