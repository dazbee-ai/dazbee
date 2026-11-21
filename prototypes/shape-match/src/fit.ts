// PROTOTYPE. Fits one Dazbee shape to a region's coverage mask. Starts in closed form (moments for
// the centre and angle, the support for the size, the area for a rounded rectangle's radius, the
// angular profile's strongest frequency for a polygon's sides or a star's points), then refines the
// best candidates by render-and-compare: each step draws the shape with Dazbee's renderer and keeps
// it when the soft IoU with the mask rises.
import type { CanvasKit } from '@dazbee/canvaskit'

import { coverage, type OutLayer } from './draw.ts'

/** A coverage mask at the fitting scale: s fitting pixels to a block pixel. */
export interface Mask {
  w: number
  h: number
  m: Float32Array
  s: number
  /** The window's size and offset in block pixels: the mask is this part of the block. */
  bw: number
  bh: number
  ox: number
  oy: number
  /** Pixels that layers on top will cover: the shape may reach under them at no cost. */
  free?: Float32Array
}

/** The part of a full-picture mask around a box (fit pixels), padded, as a Mask. */
export function windowOf(
  full: Float32Array,
  fw: number,
  fh: number,
  s: number,
  box: { x0: number; y0: number; x1: number; y1: number },
  pad: number,
  freeFull?: Float32Array,
): Mask {
  const x0 = Math.max(0, box.x0 - pad)
  const y0 = Math.max(0, box.y0 - pad)
  const x1 = Math.min(fw - 1, box.x1 + pad)
  const y1 = Math.min(fh - 1, box.y1 + pad)
  const w = x1 - x0 + 1
  const h = y1 - y0 + 1
  const m = new Float32Array(w * h)
  for (let y = 0; y < h; y++) m.set(full.subarray((y + y0) * fw + x0, (y + y0) * fw + x0 + w), y * w)
  let free: Float32Array | undefined
  if (freeFull) {
    free = new Float32Array(w * h)
    for (let y = 0; y < h; y++) free.set(freeFull.subarray((y + y0) * fw + x0, (y + y0) * fw + x0 + w), y * w)
  }
  return { w, h, m, s, bw: w / s, bh: h / s, ox: x0 / s, oy: y0 / s, ...(free ? { free } : {}) }
}

/** The layer moved by (-ox, -oy): from block pixels into a window's. */
export function shifted(layer: OutLayer, ox: number, oy: number): OutLayer {
  const props = layer.props as { x: number; y: number }
  return { ...layer, props: { ...layer.props, x: props.x - ox, y: props.y - oy } }
}

export type Kind = 'rect' | 'ellipse' | 'polygon' | 'star' | 'line'

/** A shape's parameters, in block pixels and degrees. */
export interface Params {
  kind: Kind
  cx: number
  cy: number
  w: number
  h: number
  rot: number
  /** Corner radius: rect, polygon, star. */
  r: number
  /** Sides or points. */
  n: number
  /** A star's inner radius share. */
  inner: number
  /** Stroke width; for an outline, the shape is the outer edge and the stroke sits inside. */
  stroke: number
  /** An outline: stroke only, no fill. */
  outline: boolean
  /** A dashed outline's dash and gap lengths and where the pattern starts; 0 dash is solid. */
  dash?: number
  gap?: number
  dashOffset?: number
}

export interface Fit {
  params: Params
  iou: number
  renders: number
}

export interface FitOptions {
  /** Render-and-compare steps allowed for refining. 0 keeps the closed-form start. */
  refineSteps: number
  /** Kinds to try. */
  kinds: Kind[]
}

/** The layer a set of parameters draws, filled or stroked with `paint`. */
export function layerOf(p: Params, paint: Record<string, unknown>, name = 'Shape'): OutLayer {
  const box = {
    x: p.cx - p.w / 2,
    y: p.cy - p.h / 2,
    width: Math.max(0.01, p.w),
    height: Math.max(0.01, p.h),
    rotation: p.rot,
  }
  if (p.kind === 'line') {
    return {
      type: 'graphic',
      name,
      props: {
        ...box,
        y: p.cy - p.h / 2,
        shape: { kind: 'line' },
        fills: [],
        strokes: [{ paint, width: Math.max(0.1, p.h), align: 'center', cap: p.r > 0 ? 'round' : 'butt' }],
      },
    }
  }
  const shape =
    p.kind === 'rect'
      ? { kind: 'rect', cornerRadius: Math.max(0, p.r) }
      : p.kind === 'ellipse'
        ? { kind: 'ellipse' }
        : p.kind === 'polygon'
          ? { kind: 'polygon', sides: p.n, cornerRadius: Math.max(0, p.r) }
          : {
              kind: 'star',
              points: p.n,
              innerRadius: Math.max(0, Math.min(1, p.inner)),
              cornerRadius: Math.max(0, p.r),
            }
  return {
    type: 'graphic',
    name,
    props: {
      ...box,
      shape,
      fills: p.outline ? [] : [paint],
      strokes: p.outline
        ? [
            {
              paint,
              width: Math.max(0.1, p.stroke),
              align: 'inside',
              ...(p.dash && p.dash > 0
                ? { dashes: [Math.max(0.1, p.dash), Math.max(0, p.gap ?? 0)], dashOffset: p.dashOffset ?? 0 }
                : {}),
            },
          ]
        : [],
    },
  }
}

const WHITE = { type: 'solid', color: '#FFFFFFFF' }

export function softIoU(a: Float32Array, b: Float32Array, free?: Float32Array) {
  let mn = 0
  let mx = 0
  for (let i = 0; i < a.length; i++) {
    if (free && free[i]! >= 0.5) continue
    const x = a[i]!
    const y = b[i]!
    mn += x < y ? x : y
    mx += x > y ? x : y
  }
  return mx > 0 ? mn / mx : 1
}

/** The IoU of the shape drawn by Dazbee's renderer with the mask. */
export function iouOf(ck: CanvasKit, p: Params, mask: Mask) {
  return softIoU(
    coverage(ck, shifted(layerOf(p, WHITE), mask.ox, mask.oy), mask.bw, mask.bh, mask.s, mask.w, mask.h),
    mask.m,
    mask.free,
  )
}

/** The best shape for the mask among the kinds allowed. */
export function fitShape(ck: CanvasKit, mask: Mask, opt: FitOptions, outline?: { target: Mask; stroke: number }): Fit {
  const starts = startsOf(mask, opt.kinds, false, 0).map((p) =>
    outline ? { ...p, outline: true, stroke: outline.stroke } : p,
  )
  const target = outline?.target ?? mask
  let renders = 0
  const scored = starts.map((p) => {
    renders++
    return { params: p, iou: iouOf(ck, p, target) }
  })
  scored.sort((a, b) => b.iou - a.iou)
  // Refine the two best kinds, and keep the simplest that comes within a hair of the best.
  const top: Fit[] = []
  const seenKinds = new Set<string>()
  for (const s of scored) {
    const key = s.params.kind
    if (seenKinds.has(key)) continue
    seenKinds.add(key)
    top.push({ ...s, renders: 0 })
    if (top.length >= 3) break
  }
  // The leading kind gets the whole refining budget, the others a quarter.
  const refined = top.map((s, i) =>
    refine(ck, s.params, s.iou, target, i === 0 ? opt.refineSteps : Math.floor(opt.refineSteps / 4)),
  )
  for (const r of refined) renders += r.renders
  refined.sort((a, b) => b.iou - a.iou)
  const best = refined[0]!
  const simplest = refined
    .filter((r) => r.iou >= best.iou - 0.004)
    .sort((a, b) => complexity(a.params) - complexity(b.params))[0]!
  return { ...simplest, renders }
}

const complexity = (p: Params) => ({ rect: 0, ellipse: 0, line: 0, polygon: 1, star: 2 })[p.kind] + (p.r > 0 ? 0.1 : 0)

/** Closed-form starting points for each kind. */
function startsOf(mask: Mask, kinds: Kind[], outline: boolean, strokeHint: number): Params[] {
  const { w, h, m, s } = mask
  let A = 0,
    sx = 0,
    sy = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = m[y * w + x]!
      A += v
      sx += v * (x + 0.5)
      sy += v * (y + 0.5)
    }
  if (A <= 0) return []
  const cx = sx / A
  const cy = sy / A
  let mxx = 0,
    myy = 0,
    mxy = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = m[y * w + x]!
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      mxx += v * dx * dx
      myy += v * dy * dy
      mxy += v * dx * dy
    }
  mxx /= A
  myy /= A
  mxy /= A
  const theta = 0.5 * Math.atan2(2 * mxy, mxx - myy)
  const deg = (theta * 180) / Math.PI
  // Near-level shapes are levelled: a designer sets 0°, not 1.3°.
  const angles = new Set<number>([0])
  const nearest90 = Math.round(deg / 90) * 90
  if (Math.abs(deg - nearest90) > 2.5 && Math.abs(mxx - myy) > 0.05 * (mxx + myy)) angles.add(deg)
  const out: Params[] = []
  const areaBlock = A / (s * s)
  for (const rot of angles) {
    const ext = extent(mask, cx, cy, rot)
    const W = ext.w / s
    const H = ext.h / s
    const base = {
      cx: ext.cx / s + mask.ox,
      cy: ext.cy / s + mask.oy,
      w: W,
      h: H,
      rot,
      r: 0,
      n: 0,
      inner: 0.5,
      stroke: strokeHint,
      outline,
    }
    const filledArea = outline ? W * H : areaBlock
    if (kinds.includes('rect')) {
      const r = Math.sqrt(Math.max(0, (W * H - filledArea) / (4 - Math.PI)))
      out.push({ ...base, kind: 'rect', r: Math.min(r, Math.min(W, H) / 2) })
      out.push({ ...base, kind: 'rect', r: Math.min(W, H) / 2 })
      out.push({ ...base, kind: 'rect', r: 0 })
    }
    if (kinds.includes('ellipse')) out.push({ ...base, kind: 'ellipse' })
    if (kinds.includes('line') && Math.min(W, H) <= 10 && Math.max(W, H) >= 6 * Math.min(W, H)) {
      const along = W >= H
      out.push({
        ...base,
        kind: 'line',
        w: along ? W : H,
        h: along ? H : W,
        rot: along ? rot : rot + 90,
        r: 0,
      })
      out.push({ ...base, kind: 'line', w: along ? W : H, h: along ? H : W, rot: along ? rot : rot + 90, r: 1 })
    }
    if (rot === 0 && (kinds.includes('polygon') || kinds.includes('star'))) {
      const prof = angular(mask, ext.cx, ext.cy, ext.w / 2, ext.h / 2)
      if (prof) {
        // Dazbee's polygon and star put their first point at the top centre; rotation turns it.
        const turn = prof.phaseDeg
        if (kinds.includes('polygon') && prof.n <= 12) out.push({ ...base, kind: 'polygon', n: prof.n, rot: turn })
        if (kinds.includes('star') && prof.n >= 3)
          out.push({ ...base, kind: 'star', n: prof.n, inner: prof.inner, rot: turn })
      }
    }
  }
  return out
}

/** Centre and size along the axes turned by rot: the support (coverage ≥ 0.5) with sub-pixel edges. */
function extent(mask: Mask, cx: number, cy: number, rot: number) {
  const { w, h, m } = mask
  const c = Math.cos((rot * Math.PI) / 180)
  const sn = Math.sin((rot * Math.PI) / 180)
  let u0 = Infinity,
    u1 = -Infinity,
    v0 = Infinity,
    v1 = -Infinity
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = m[y * w + x]!
      // A blurred edge's faint tail is not the edge: the edge is where coverage crosses a half.
      if (v < 0.3) continue
      const dx = x + 0.5 - cx
      const dy = y + 0.5 - cy
      const u = dx * c + dy * sn
      const vv = -dx * sn + dy * c
      // A partly covered pixel reaches (v - 0.5) past its centre.
      const reach = v - 0.5
      u0 = Math.min(u0, u - reach)
      u1 = Math.max(u1, u + reach)
      v0 = Math.min(v0, vv - reach)
      v1 = Math.max(v1, vv + reach)
    }
  const uc = (u0 + u1) / 2
  const vc = (v0 + v1) / 2
  return { cx: cx + uc * c - vc * sn, cy: cy + uc * sn + vc * c, w: u1 - u0, h: v1 - v0 }
}

/**
 * The outline's radius by angle, the shape scaled to a circle, and the strongest angular frequency
 * from 3 to 48: the polygon's sides or the star's points, with the phase that puts a point on top
 * and the inner-to-outer radius ratio.
 */
function angular(mask: Mask, cx: number, cy: number, rx: number, ry: number) {
  const { w, h, m } = mask
  const BINS = 360
  const r = new Float32Array(BINS)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = m[y * w + x]!
      if (v < 0.5) continue
      const dx = (x + 0.5 - cx) / rx
      const dy = (y + 0.5 - cy) / ry
      const rr = Math.hypot(dx, dy)
      const b = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * BINS) % BINS
      if (rr > r[b]!) r[b] = rr
    }
  let filled = 0
  for (let i = 0; i < BINS; i++) if (r[i]! > 0) filled++
  if (filled < BINS * 0.8) return null
  for (let i = 0; i < BINS; i++) if (r[i] === 0) r[i] = r[(i + BINS - 1) % BINS]!
  let mean = 0
  for (let i = 0; i < BINS; i++) mean += r[i]!
  mean /= BINS
  let best = 0,
    bestAmp = 0,
    bestPhase = 0
  for (let k = 3; k <= 48; k++) {
    let re = 0,
      im = 0
    for (let i = 0; i < BINS; i++) {
      const a = (2 * Math.PI * k * i) / BINS
      re += (r[i]! - mean) * Math.cos(a)
      im += (r[i]! - mean) * Math.sin(a)
    }
    const amp = Math.hypot(re, im) / BINS
    if (amp > bestAmp) {
      bestAmp = amp
      best = k
      bestPhase = Math.atan2(im, re)
    }
  }
  if (bestAmp / mean < 0.012) return null
  // Peak angle in the bins' frame (angle -π at bin 0): a peak where k·angle = phase.
  const peakAngle = bestPhase / best - Math.PI + 0
  let peakDeg = (peakAngle * 180) / Math.PI
  // The shape's first point sits at -90° (top); turning by (peak + 90) mod (360/k).
  const period = 360 / best
  let turn = (((peakDeg + 90) % period) + period) % period
  if (turn > period / 2) turn -= period
  peakDeg = turn
  let mn = Infinity,
    mx = 0
  for (let i = 0; i < BINS; i++) {
    mn = Math.min(mn, r[i]!)
    mx = Math.max(mx, r[i]!)
  }
  return { n: best, phaseDeg: peakDeg, inner: Math.max(0.05, Math.min(0.98, mn / mx)) }
}

/** Coordinate search with shrinking steps; each step one render. */
export function refine(ck: CanvasKit, p0: Params, iou0: number, mask: Mask, budget: number): Fit {
  let p = { ...p0 }
  let iou = iou0
  let renders = 0
  if (budget <= 0) return { params: p, iou, renders }
  const keys: (keyof Params)[] = ['cx', 'cy', 'w', 'h']
  if (p.rot !== 0 && p.kind !== 'polygon' && p.kind !== 'star') keys.push('rot')
  if (p.kind === 'polygon' || p.kind === 'star') keys.push('rot')
  if (p.kind === 'rect' || p.kind === 'star' || p.kind === 'polygon') keys.push('r')
  if (p.kind === 'star') keys.push('inner')
  if (p.outline) keys.push('stroke')
  if (p.dash && p.dash > 0) keys.push('dash', 'gap', 'dashOffset')
  const unit = 1 / mask.s
  const stepOf = (k: keyof Params, scale: number) =>
    k === 'rot'
      ? 2 * scale
      : k === 'inner'
        ? 0.04 * scale
        : k === 'dashOffset'
          ? 2 * scale
          : Math.max(0.15, unit) * 2 * scale
  let scale = 2
  while (renders < budget && scale > 0.06) {
    let improved = false
    for (const k of keys) {
      for (const dir of [1, -1]) {
        if (renders >= budget) break
        const q = { ...p, [k]: (p[k] as number) + dir * stepOf(k, scale) }
        if (q.w <= 0.5 || q.h <= 0.1 || q.r < 0 || q.stroke < 0 || q.inner <= 0.02 || q.inner >= 1) continue
        if ((q.dash ?? 1) <= 0.2 || (q.gap ?? 1) <= 0.2) continue
        if (q.kind === 'rect' && q.r > Math.min(q.w, q.h) / 2) {
          // A pill keeps its round ends as it narrows: the radius follows the size.
          if (k === 'r') continue
          q.r = Math.min(q.w, q.h) / 2
        }
        renders++
        const v = iouOf(ck, q, mask)
        if (v > iou + 1e-5) {
          p = q
          iou = v
          improved = true
          break
        }
      }
    }
    if (!improved) scale /= 2
  }
  return { params: p, iou, renders }
}
