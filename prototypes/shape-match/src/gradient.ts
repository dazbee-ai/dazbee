// PROTOTYPE. Fits a linear or radial gradient to a region's colours. Linear: least squares of each
// channel on x and y gives the direction; the colours along it are binned and fitted with two or
// three stops. Radial: the centre is searched on a grid, the colours by distance fitted the same way.
// Colours are fitted in sRGB, where the renderer interpolates them.
import { deltaE00, rgbToLab } from './colour.ts'
import type { Img } from './pixels.ts'

export interface GradientFit {
  type: 'linear' | 'radial'
  /** Block pixels. */
  from: [number, number]
  to: [number, number]
  /** Radial: centre is `from`, radius is |to - from|. */
  stops: { offset: number; rgb: [number, number, number] }[]
  /** Mean ΔE of the region's pixels to the gradient. */
  error: number
}

interface Px {
  x: number
  y: number
  c: [number, number, number]
}

/** Inner pixels of a mask (coverage ≥ 0.95), at most ~6000, with their colours. */
export function innerPixels(img: Img, mask: Float32Array): Px[] {
  const out: Px[] = []
  let count = 0
  for (let i = 0; i < mask.length; i++) if (mask[i]! >= 0.95) count++
  const step = Math.max(1, Math.floor(count / 6000))
  let k = 0
  for (let i = 0; i < mask.length; i++) {
    if (mask[i]! < 0.95) continue
    if (k++ % step) continue
    const x = i % img.w
    out.push({ x: x + 0.5, y: (i - x) / img.w + 0.5, c: [img.d[i * 4]!, img.d[i * 4 + 1]!, img.d[i * 4 + 2]!] })
  }
  return out
}

/** Mean ΔE of pixels to one flat colour. */
export function flatError(px: Px[], rgb: [number, number, number]) {
  const lab = rgbToLab(...rgb)
  let s = 0
  for (const p of px) s += deltaE00(rgbToLab(...p.c), lab)
  return s / (px.length || 1)
}

/** The better of a linear and a radial gradient for these pixels; scale turns pixels to block pixels. */
export function fitGradient(px: Px[], scale: number): GradientFit | null {
  if (px.length < 30) return null
  const lin = fitLinear(px)
  const rad = fitRadial(px)
  const best = [lin, rad].filter((g): g is GradientFit => g !== null).sort((a, b) => a.error - b.error)[0]
  if (!best) return null
  // Radial only when clearly better: a linear gradient is the simpler pick.
  const pick = lin && rad && rad.error > lin.error - 0.4 ? lin : best
  return {
    ...pick,
    from: [pick.from[0] / scale, pick.from[1] / scale],
    to: [pick.to[0] / scale, pick.to[1] / scale],
  }
}

function fitLinear(px: Px[]): GradientFit | null {
  // Least squares c = a + bx·x + by·y for each channel.
  let mx = 0,
    my = 0
  for (const p of px) {
    mx += p.x
    my += p.y
  }
  mx /= px.length
  my /= px.length
  let sxx = 0,
    syy = 0,
    sxy = 0
  const sxc = [0, 0, 0]
  const syc = [0, 0, 0]
  for (const p of px) {
    const dx = p.x - mx
    const dy = p.y - my
    sxx += dx * dx
    syy += dy * dy
    sxy += dx * dy
    for (let c = 0; c < 3; c++) {
      sxc[c]! += dx * p.c[c]!
      syc[c]! += dy * p.c[c]!
    }
  }
  const det = sxx * syy - sxy * sxy
  if (Math.abs(det) < 1e-9) return null
  // The direction that explains most of the change, over the three channels.
  let gxx = 0,
    gyy = 0,
    gxy = 0
  for (let c = 0; c < 3; c++) {
    const bx = (sxc[c]! * syy - syc[c]! * sxy) / det
    const by = (syc[c]! * sxx - sxc[c]! * sxy) / det
    gxx += bx * bx
    gyy += by * by
    gxy += bx * by
  }
  const th = 0.5 * Math.atan2(2 * gxy, gxx - gyy)
  let dir: [number, number] = [Math.cos(th), Math.sin(th)]
  // Snap to level or upright, or 45°, when within 4°: a designer's angle.
  const deg = (th * 180) / Math.PI
  const snapped = Math.round(deg / 45) * 45
  if (Math.abs(deg - snapped) < 4) dir = [Math.cos((snapped * Math.PI) / 180), Math.sin((snapped * Math.PI) / 180)]
  const t = px.map((p) => (p.x - mx) * dir[0] + (p.y - my) * dir[1])
  const fit = stopsAlong(px, t)
  if (!fit) return null
  return {
    type: 'linear',
    from: [mx + dir[0] * fit.t0, my + dir[1] * fit.t0],
    to: [mx + dir[0] * fit.t1, my + dir[1] * fit.t1],
    stops: fit.stops,
    error: fit.error,
  }
}

function fitRadial(all: Px[]): GradientFit | null {
  const every = Math.max(1, Math.floor(all.length / 2500))
  const px = all.filter((_, i) => i % every === 0)
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const p of px) {
    x0 = Math.min(x0, p.x)
    y0 = Math.min(y0, p.y)
    x1 = Math.max(x1, p.x)
    y1 = Math.max(y1, p.y)
  }
  const W = x1 - x0
  const H = y1 - y0
  let best: { cx: number; cy: number; fit: NonNullable<ReturnType<typeof stopsAlong>> } | null = null
  const tryAt = (cx: number, cy: number) => {
    const t = px.map((p) => Math.hypot(p.x - cx, p.y - cy))
    const fit = stopsAlong(px, t, true)
    if (fit && (!best || fit.error < best.fit.error)) best = { cx, cy, fit }
  }
  for (let i = -1; i <= 7; i++) for (let j = -1; j <= 7; j++) tryAt(x0 + (W * i) / 6, y0 + (H * j) / 6)
  const b0 = best as typeof best
  if (!b0) return null
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) tryAt(b0.cx + (W * i) / 24, b0.cy + (H * j) / 24)
  const b = best as unknown as { cx: number; cy: number; fit: NonNullable<ReturnType<typeof stopsAlong>> }
  return {
    type: 'radial',
    from: [b.cx, b.cy],
    to: [b.cx + b.fit.t1, b.cy],
    stops: b.fit.stops.map((s) => ({
      ...s,
      offset: b.fit.t1 > 0 ? (b.fit.t0 + s.offset * (b.fit.t1 - b.fit.t0)) / b.fit.t1 : s.offset,
    })),
    error: b.fit.error,
  }
}

/**
 * Colours against a coordinate t: 24 bins, then two stops at the ends, or three with the middle
 * stop where it helps most; returns the stops on [t0, t1] and the mean ΔE of the pixels.
 */
function stopsAlong(px: Px[], t: number[], fromZero = false) {
  let t0 = Infinity
  let t1 = -Infinity
  for (const v of t) {
    t0 = Math.min(t0, v)
    t1 = Math.max(t1, v)
  }
  if (fromZero) t0 = Math.min(t0, 0) === t0 && t0 < 0 ? 0 : t0
  if (t1 - t0 < 1e-6) return null
  const BINS = 24
  const sum = Array.from({ length: BINS }, () => [0, 0, 0, 0])
  for (let i = 0; i < px.length; i++) {
    const b = Math.min(BINS - 1, Math.max(0, Math.floor(((t[i]! - t0) / (t1 - t0)) * BINS)))
    const s = sum[b]!
    s[0]! += px[i]!.c[0]
    s[1]! += px[i]!.c[1]
    s[2]! += px[i]!.c[2]
    s[3]! += 1
  }
  const bins = sum.map((s, i) => ({
    o: (i + 0.5) / BINS,
    n: s[3]!,
    c: s[3]! ? ([s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!] as [number, number, number]) : null,
  }))
  const ok = bins.filter((b) => b.c)
  if (ok.length < 3) return null
  // Least-squares line through the bins for each channel, then its ends as stops.
  const line = (lo: number, hi: number) => {
    const sel = ok.filter((b) => b.o >= lo - 1e-9 && b.o <= hi + 1e-9)
    let so = 0,
      sn = 0
    for (const b of sel) {
      so += b.o * b.n
      sn += b.n
    }
    const mo = so / (sn || 1)
    let soo = 0
    const sc = [0, 0, 0]
    const mc = [0, 0, 0]
    for (const b of sel) for (let c = 0; c < 3; c++) mc[c]! += (b.c![c]! * b.n) / (sn || 1)
    for (const b of sel) {
      soo += (b.o - mo) ** 2 * b.n
      for (let c = 0; c < 3; c++) sc[c]! += (b.o - mo) * (b.c![c]! - mc[c]!) * b.n
    }
    const slope = sc.map((v) => (soo > 0 ? v / soo : 0))
    const val = (o: number) => mc.map((m, c) => clamp(m + slope[c]! * (o - mo))) as [number, number, number]
    return { a: val(lo), b: val(hi) }
  }
  const evalStops = (stops: { offset: number; rgb: [number, number, number] }[]) => {
    let e = 0
    let n = 0
    for (const b of ok) {
      let k = 0
      while (k < stops.length - 2 && b.o > stops[k + 1]!.offset) k++
      const s0 = stops[k]!
      const s1 = stops[k + 1]!
      const u = Math.max(0, Math.min(1, (b.o - s0.offset) / (s1.offset - s0.offset || 1)))
      const c = s0.rgb.map((v, i) => v + (s1.rgb[i]! - v) * u) as [number, number, number]
      e += deltaE00(rgbToLab(...c), rgbToLab(...b.c!)) * b.n
      n += b.n
    }
    return e / (n || 1)
  }
  const two = line(0, 1)
  let stops = [
    { offset: 0, rgb: two.a },
    { offset: 1, rgb: two.b },
  ]
  let error = evalStops(stops)
  for (const mid of [0.25, 0.33, 0.4, 0.5, 0.6, 0.67, 0.75]) {
    const l = line(0, mid)
    const r = line(mid, 1)
    const m = l.b.map((v, i) => (v + r.a[i]!) / 2) as [number, number, number]
    const s3 = [
      { offset: 0, rgb: l.a },
      { offset: mid, rgb: m },
      { offset: 1, rgb: r.b },
    ]
    const e3 = evalStops(s3)
    // A third stop must earn its place.
    if (e3 < error - 0.6) {
      stops = s3
      error = e3
    }
  }
  return { t0, t1, stops, error }
}

const clamp = (v: number) => Math.max(0, Math.min(255, v))
