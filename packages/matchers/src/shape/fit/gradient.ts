// Gradients: a part's fill as a linear or radial gradient, kept where drawing it so lowers the part's
// mean ΔE00 by 0.75 or more. Linear: least squares of each channel on x and y gives the direction,
// snapped to a multiple of 45° within 4°. Radial: the centre is searched on a grid. Either way the
// colours along it are binned and fitted with two stops, or three where a middle stop earns its
// place, in sRGB, where the renderer blends them.

import type { LinearPaint, RadialPaint } from '@dazbee/schema'

import { ciede2000, srgbToLab } from '../../looks-same/colour.ts'
import { hexColour, type SrgbFloat } from '../parts/colour.ts'

/** A gradient fitted to pixels, in piece pixels: radial ones centred on `from`, reaching to `to`. */
export interface GradientFit {
  type: 'linear' | 'radial'
  from: [number, number]
  to: [number, number]
  stops: { offset: number; rgb: SrgbFloat }[]
  /** The pixels' mean ΔE00 to the gradient. */
  error: number
}

/** An inner pixel of a part: its centre in the fitting picture and its colour. */
export interface InnerPixel {
  x: number
  y: number
  rgb: SrgbFloat
}

/** Stops fitted to colours against a coordinate, on [t0, t1], with the pixels' mean ΔE00 to them. */
interface Stops {
  t0: number
  t1: number
  stops: { offset: number; rgb: SrgbFloat }[]
  error: number
}

/** Fewer inner pixels than this hold no gradient. */
const FEWEST_PIXELS = 30
/** A radial gradient must be this much closer, in ΔE00, than a linear one to be picked. */
const RADIAL_BY = 0.4
/** A third stop must lower the error by this much. */
const THIRD_STOP_BY = 0.6
/** Bins the colours along a gradient are averaged in. */
const BINS = 24
/** Where a middle stop is tried. */
const MIDDLES = [0.25, 0.33, 0.4, 0.5, 0.6, 0.67, 0.75] as const
/** A linear gradient's angle within this many degrees of a multiple of 45° is snapped to it. */
const SNAP_DEGREES = 4

/** The better of a linear and a radial gradient for these pixels, in piece pixels; `scale` fitting pixels to a piece pixel. */
export function fitGradient(pixels: readonly InnerPixel[], scale: number): GradientFit | null {
  if (pixels.length < FEWEST_PIXELS) return null
  const linear = fitLinear(pixels)
  const radial = fitRadial(pixels)
  const best = [linear, radial].filter((g): g is GradientFit => g !== null).sort((a, b) => a.error - b.error)[0]
  if (!best) return null
  // A linear gradient is the simpler pick, so a radial one must be clearly closer.
  const pick = linear && radial && radial.error > linear.error - RADIAL_BY ? linear : best
  return { ...pick, from: [pick.from[0] / scale, pick.from[1] / scale], to: [pick.to[0] / scale, pick.to[1] / scale] }
}

/** The linear gradient along the direction that explains most of the change, over the three channels. */
function fitLinear(pixels: readonly InnerPixel[]): GradientFit | null {
  let mx = 0
  let my = 0
  for (const p of pixels) {
    mx += p.x
    my += p.y
  }
  mx /= pixels.length
  my /= pixels.length
  let sxx = 0
  let syy = 0
  let sxy = 0
  const sxc = [0, 0, 0]
  const syc = [0, 0, 0]
  for (const p of pixels) {
    const dx = p.x - mx
    const dy = p.y - my
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
    for (let c = 0; c < 3; c++) {
      sxc[c] = (sxc[c] ?? 0) + dx * (p.rgb[c] ?? 0)
      syc[c] = (syc[c] ?? 0) + dy * (p.rgb[c] ?? 0)
    }
  }
  const det = sxx * syy - sxy * sxy
  if (Math.abs(det) < 1e-9) return null
  let gxx = 0
  let gyy = 0
  let gxy = 0
  for (let c = 0; c < 3; c++) {
    const bx = ((sxc[c] ?? 0) * syy - (syc[c] ?? 0) * sxy) / det
    const by = ((syc[c] ?? 0) * sxx - (sxc[c] ?? 0) * sxy) / det
    gxx += bx * bx
    gyy += by * by
    gxy += bx * by
  }
  const theta = 0.5 * Math.atan2(2 * gxy, gxx - gyy)
  let direction: [number, number] = [Math.cos(theta), Math.sin(theta)]
  const degrees = (theta * 180) / Math.PI
  const snapped = Math.round(degrees / 45) * 45
  if (Math.abs(degrees - snapped) < SNAP_DEGREES) {
    direction = [Math.cos((snapped * Math.PI) / 180), Math.sin((snapped * Math.PI) / 180)]
  }
  const along = pixels.map((p) => (p.x - mx) * direction[0] + (p.y - my) * direction[1])
  const fit = stopsAlong(pixels, along)
  if (!fit) return null
  return {
    type: 'linear',
    from: [mx + direction[0] * fit.t0, my + direction[1] * fit.t0],
    to: [mx + direction[0] * fit.t1, my + direction[1] * fit.t1],
    stops: fit.stops,
    error: fit.error,
  }
}

/** The radial gradient whose centre, searched on a coarse grid then a fine one, fits the colours by distance best. */
function fitRadial(all: readonly InnerPixel[]): GradientFit | null {
  const every = Math.max(1, Math.floor(all.length / 2500))
  const pixels = all.filter((_, i) => i % every === 0)
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of pixels) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  const w = x1 - x0
  const h = y1 - y0
  const found: { best?: { cx: number; cy: number; fit: Stops } } = {}
  const tryAt = (cx: number, cy: number) => {
    const fit = stopsAlong(
      pixels,
      pixels.map((p) => Math.hypot(p.x - cx, p.y - cy)),
      true,
    )
    if (fit && (!found.best || fit.error < found.best.fit.error)) found.best = { cx, cy, fit }
  }
  for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) tryAt(x0 + (w * i) / 6, y0 + (h * j) / 6)
  const coarse = found.best
  if (!coarse) return null
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) tryAt(coarse.cx + (w * i) / 24, coarse.cy + (h * j) / 24)
  const { cx, cy, fit } = found.best ?? coarse
  return {
    type: 'radial',
    from: [cx, cy],
    to: [cx + fit.t1, cy],
    stops: fit.stops.map((stop) => ({
      ...stop,
      offset: fit.t1 > 0 ? (fit.t0 + stop.offset * (fit.t1 - fit.t0)) / fit.t1 : stop.offset,
    })),
    error: fit.error,
  }
}

/**
 * Colours against a coordinate t: 24 bins, then two stops at the ends, or three with the middle
 * stop where it helps most. `fromZero` starts a radial gradient's coordinate at its centre.
 */
function stopsAlong(pixels: readonly InnerPixel[], t: readonly number[], fromZero = false): Stops | null {
  let t0 = Infinity
  let t1 = -Infinity
  for (const v of t) {
    t0 = Math.min(t0, v)
    t1 = Math.max(t1, v)
  }
  if (fromZero) t0 = Math.min(t0, 0) === t0 && t0 < 0 ? 0 : t0
  if (t1 - t0 < 1e-6) return null
  const sums = Array.from({ length: BINS }, () => [0, 0, 0, 0])
  for (let i = 0; i < pixels.length; i++) {
    const bin = Math.min(BINS - 1, Math.max(0, Math.floor((((t[i] ?? 0) - t0) / (t1 - t0)) * BINS)))
    const sum = sums[bin] ?? [0, 0, 0, 0]
    const rgb = pixels[i]?.rgb ?? [0, 0, 0]
    sum[0] = (sum[0] ?? 0) + rgb[0]
    sum[1] = (sum[1] ?? 0) + rgb[1]
    sum[2] = (sum[2] ?? 0) + rgb[2]
    sum[3] = (sum[3] ?? 0) + 1
  }
  const bins: { o: number; n: number; rgb: SrgbFloat }[] = []
  sums.forEach(([r = 0, g = 0, b = 0, n = 0], i) => {
    if (n) bins.push({ o: (i + 0.5) / BINS, n, rgb: [r / n, g / n, b / n] })
  })
  if (bins.length < 3) return null
  // A least-squares line through the bins between two offsets, each channel, its ends as stops.
  const line = (lo: number, hi: number) => {
    const picked = bins.filter((bin) => bin.o >= lo - 1e-9 && bin.o <= hi + 1e-9)
    let so = 0
    let sn = 0
    for (const bin of picked) {
      so += bin.o * bin.n
      sn += bin.n
    }
    const mo = so / (sn || 1)
    let soo = 0
    const sc = [0, 0, 0]
    const mc = [0, 0, 0]
    for (const bin of picked) for (let c = 0; c < 3; c++) mc[c] = (mc[c] ?? 0) + ((bin.rgb[c] ?? 0) * bin.n) / (sn || 1)
    for (const bin of picked) {
      soo += (bin.o - mo) ** 2 * bin.n
      for (let c = 0; c < 3; c++) sc[c] = (sc[c] ?? 0) + (bin.o - mo) * ((bin.rgb[c] ?? 0) - (mc[c] ?? 0)) * bin.n
    }
    const slope = sc.map((v) => (soo > 0 ? v / soo : 0))
    const at = (o: number) => mc.map((m, c) => clamp(m + (slope[c] ?? 0) * (o - mo))) as SrgbFloat
    return { a: at(lo), b: at(hi) }
  }
  const errorOf = (stops: { offset: number; rgb: SrgbFloat }[]) => {
    let total = 0
    let n = 0
    for (const bin of bins) {
      let k = 0
      while (k < stops.length - 2 && bin.o > (stops[k + 1]?.offset ?? 1)) k++
      const s0 = stops[k] ?? { offset: 0, rgb: bin.rgb }
      const s1 = stops[k + 1] ?? s0
      const u = Math.max(0, Math.min(1, (bin.o - s0.offset) / (s1.offset - s0.offset || 1)))
      const rgb = s0.rgb.map((v, i) => v + ((s1.rgb[i] ?? 0) - v) * u) as SrgbFloat
      total += ciede2000(srgbToLab(...rgb), srgbToLab(...bin.rgb)) * bin.n
      n += bin.n
    }
    return total / (n || 1)
  }
  const two = line(0, 1)
  let stops = [
    { offset: 0, rgb: two.a },
    { offset: 1, rgb: two.b },
  ]
  let error = errorOf(stops)
  for (const middle of MIDDLES) {
    const left = line(0, middle)
    const right = line(middle, 1)
    const three = [
      { offset: 0, rgb: left.a },
      { offset: middle, rgb: left.b.map((v, i) => (v + (right.a[i] ?? 0)) / 2) as SrgbFloat },
      { offset: 1, rgb: right.b },
    ]
    const e3 = errorOf(three)
    if (e3 < error - THIRD_STOP_BY) {
      stops = three
      error = e3
    }
  }
  return { t0, t1, stops, error }
}

/** A channel clamped to 0–255. */
function clamp(v: number): number {
  return Math.max(0, Math.min(255, v))
}

/** A gradient as a paint in the unit box of a graphic's box: a linear one running along the pixels' direction whatever the box's aspect. */
export function gradientPaint(
  gradient: GradientFit,
  box: { x: number; y: number; width: number; height: number },
): LinearPaint | RadialPaint {
  const stops = gradient.stops.map((stop) => ({
    offset: Math.round(stop.offset * 1000) / 1000,
    color: hexColour(...stop.rgb),
  }))
  if (gradient.type === 'linear') {
    const dx = gradient.to[0] - gradient.from[0]
    const dy = gradient.to[1] - gradient.from[1]
    const length2 = dx * dx + dy * dy
    const gx = (box.width * dx) / length2
    const gy = (box.height * dy) / length2
    const g2 = gx * gx + gy * gy
    const from = { x: (gradient.from[0] - box.x) / box.width, y: (gradient.from[1] - box.y) / box.height }
    return { type: 'linear', from: rounded(from), to: rounded({ x: from.x + gx / g2, y: from.y + gy / g2 }), stops }
  }
  const radius =
    Math.hypot(gradient.to[0] - gradient.from[0], gradient.to[1] - gradient.from[1]) / Math.min(box.width, box.height)
  return {
    type: 'radial',
    center: rounded({ x: (gradient.from[0] - box.x) / box.width, y: (gradient.from[1] - box.y) / box.height }),
    radius: Math.max(0.001, radius),
    stops,
  }
}

/** A point rounded to four decimals. */
function rounded(p: { x: number; y: number }): { x: number; y: number } {
  return { x: Math.round(p.x * 10000) / 10000, y: Math.round(p.y * 10000) / 10000 }
}
