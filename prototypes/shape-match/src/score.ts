// PROTOTYPE. The shared "looks the same" rule: the rebuilt block, drawn by Dazbee's renderer at the
// block's size, against the block. SSIM (Wang et al. 2004) on luminance, and mean CIEDE2000 over the
// block's content. A block is see-through, so both are drawn over white and over black and the
// worse of the two counts. It looks the same when SSIM ≥ 0.90 and mean ΔE ≤ 5.
import { deltaE00, rgbToLab } from './colour.ts'
import { type Img, over } from './pixels.ts'

export interface Score {
  ssim: number
  /** Mean ΔE over every pixel of the block, as the shared rule says. */
  deltaE: number
  /** Mean ΔE over the pixels either picture covers: stricter on thin line art, where most are edges. */
  deltaEContent: number
  same: boolean
  /** Rule v2's numbers, when it decides. */
  v2?: ScoreV2
  /** Per-pixel ΔE over the worse background, for finer checks; 0 outside the content. */
  deMap?: Float32Array
}

export const SSIM_MIN = 0.9
export const DE_MAX = 5
/** Which ΔE the decision reads: over the whole block (the shared rule) or over its covered pixels. */
export const CONTENT_RULE = process.env.DE_RULE === 'content'

const BACKS: [number, number, number][] = [
  [255, 255, 255],
  [0, 0, 0],
]

export function score(target: Img, made: Img, keepMap = false): Score {
  let ssimWorst = 1
  let deWorst = 0
  let deAllWorst = 0
  let deMap: Float32Array | undefined
  for (const bg of BACKS) {
    const a = over(target, bg)
    const b = over(made, bg)
    const s = ssimLuma(a, b, target.w, target.h)
    const { mean, all, map } = meanDeltaE(a, b, target, made, keepMap)
    ssimWorst = Math.min(ssimWorst, s)
    deAllWorst = Math.max(deAllWorst, all)
    if (mean >= deWorst) {
      deWorst = mean
      deMap = map
    }
  }
  const v1Same = ssimWorst >= SSIM_MIN && (CONTENT_RULE ? deWorst : deAllWorst) <= DE_MAX
  // Under rule v2 the decision is v2's; both rules' numbers are kept.
  const v2 = RULE === 'v2' ? scoreV2(target, made) : undefined
  return {
    ssim: ssimWorst,
    deltaE: deAllWorst,
    deltaEContent: deWorst,
    same: v2 ? v2.same : v1Same,
    ...(v2 ? { v2 } : {}),
    deMap,
  }
}

/** ΔE00 of 8-bit colour pairs already met: flat and gradient blocks repeat a few pairs many times. */
const PAIRS = new Map<number, number>()

/** Empties the ΔE memo: done at each block's start, so it holds one block's colours at most. */
export const resetPairs = () => PAIRS.clear()

/** How many colour pairs the ΔE memo holds. */
export const pairCacheSize = () => PAIRS.size

/** ΔE00 of two colours rounded to 8 bits, as the PNGs hold them. */
export function pairDeltaE(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number) {
  const k1 = (Math.round(r1) << 16) | (Math.round(g1) << 8) | Math.round(b1)
  const k2 = (Math.round(r2) << 16) | (Math.round(g2) << 8) | Math.round(b2)
  if (k1 === k2) return 0
  const key = k1 * 16777216 + k2
  let d = PAIRS.get(key)
  if (d === undefined) {
    if (PAIRS.size > 1_000_000) PAIRS.clear()
    d = deltaE00(rgbToLab(k1 >> 16, (k1 >> 8) & 255, k1 & 255), rgbToLab(k2 >> 16, (k2 >> 8) & 255, k2 & 255))
    PAIRS.set(key, d)
  }
  return d
}

/** Mean ΔE00 over pixels that either picture covers (alpha above 2 %). */
function meanDeltaE(a: Float32Array, b: Float32Array, ia: Img, ib: Img, keepMap: boolean) {
  const n = ia.w * ia.h
  const map = keepMap ? new Float32Array(n) : undefined
  let sum = 0
  let count = 0
  for (let i = 0; i < n; i++) {
    if (ia.d[i * 4 + 3]! <= 0.02 && ib.d[i * 4 + 3]! <= 0.02) continue
    const d = pairDeltaE(a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!, b[i * 3]!, b[i * 3 + 1]!, b[i * 3 + 2]!)
    sum += d
    count++
    if (map) map[i] = d
  }
  return { mean: count ? sum / count : 0, all: sum / n, map }
}

/**
 * Mean SSIM of the luminance, 11×11 Gaussian window (σ 1.5), K1 0.01, K2 0.03, after the authors'
 * downsampling by round(min(w, h) / 256).
 */
export function ssimLuma(a: Float32Array, b: Float32Array, w0: number, h0: number): number {
  const f = Math.max(1, Math.round(Math.min(w0, h0) / 256))
  const w = Math.floor(w0 / f)
  const h = Math.floor(h0 / f)
  if (w < 1 || h < 1) return 1
  const x = new Float32Array(w * h)
  const y = new Float32Array(w * h)
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      let sa = 0
      let sb = 0
      for (let dy = 0; dy < f; dy++)
        for (let dx = 0; dx < f; dx++) {
          const p = ((j * f + dy) * w0 + i * f + dx) * 3
          sa += 0.299 * a[p]! + 0.587 * a[p + 1]! + 0.114 * a[p + 2]!
          sb += 0.299 * b[p]! + 0.587 * b[p + 1]! + 0.114 * b[p + 2]!
        }
      x[j * w + i] = sa / (f * f)
      y[j * w + i] = sb / (f * f)
    }
  const xx = new Float32Array(w * h)
  const yy = new Float32Array(w * h)
  const xy = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) {
    xx[i] = x[i]! * x[i]!
    yy[i] = y[i]! * y[i]!
    xy[i] = x[i]! * y[i]!
  }
  const mx = gauss(x, w, h)
  const my = gauss(y, w, h)
  const sxx = gauss(xx, w, h)
  const syy = gauss(yy, w, h)
  const sxy = gauss(xy, w, h)
  const C1 = (0.01 * 255) ** 2
  const C2 = (0.03 * 255) ** 2
  let sum = 0
  for (let i = 0; i < w * h; i++) {
    const ux = mx[i]!
    const uy = my[i]!
    const vx = sxx[i]! - ux * ux
    const vy = syy[i]! - uy * uy
    const cxy = sxy[i]! - ux * uy
    sum += ((2 * ux * uy + C1) * (2 * cxy + C2)) / ((ux * ux + uy * uy + C1) * (vx + vy + C2))
  }
  return sum / (w * h)
}

const KERNEL = (() => {
  const k = new Float32Array(11)
  let s = 0
  for (let i = 0; i < 11; i++) {
    k[i] = Math.exp(-((i - 5) ** 2) / (2 * 1.5 * 1.5))
    s += k[i]!
  }
  for (let i = 0; i < 11; i++) k[i] = k[i]! / s
  return k
})()

/** Separable Gaussian blur, edges clamped. */
function gauss(src: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      let s = 0
      for (let k = -5; k <= 5; k++) s += KERNEL[k + 5]! * src[j * w + Math.max(0, Math.min(w - 1, i + k))]!
      tmp[j * w + i] = s
    }
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      let s = 0
      for (let k = -5; k <= 5; k++) s += KERNEL[k + 5]! * tmp[Math.max(0, Math.min(h - 1, j + k)) * w + i]!
      out[j * w + i] = s
    }
  return out
}

export interface ScoreV2 {
  ssim: number
  deltaE: number
  /** Share of the block's pixels whose blurred ΔE00 is over LOST_DE: a part missing or misdrawn. */
  lost: number
  same: boolean
}

/** Rule v2's bars; LOST_MAX is set on the hand-judged blocks. */
export const V2 = {
  ssim: 0.9,
  deltaE: 5,
  lostDE: Number(process.env.LOST_DE ?? 20),
  lostMax: Number(process.env.LOST_MAX ?? 0.01),
}

/** Which rule decides: the shared rule (v1) or rule v2. */
export const RULE = process.env.RULE === 'v2' ? 'v2' : 'v1'

/**
 * Rule v2, proposed to both halves: as the shared rule, but both pictures are first blurred by a
 * 1-pixel Gaussian (grain and sub-pixel edge shifts fade, real differences stay), SSIM is taken at
 * the block's own size with no downsampling (a big block is judged at the size it is shown), and
 * no more than LOST_MAX of the block may differ by more than LOST_DE (a small part lost or misdrawn,
 * which a mean over the whole block hides).
 */
export function scoreV2(target: Img, made: Img): ScoreV2 {
  let ssim = 1
  let deltaE = 0
  let lost = 0
  const n = target.w * target.h
  for (const bg of BACKS) {
    const a = blur1(over(target, bg), target.w, target.h)
    const b = blur1(over(made, bg), target.w, target.h)
    ssim = Math.min(ssim, ssimFull(a, b, target.w, target.h))
    let sum = 0
    let far = 0
    for (let i = 0; i < n; i++) {
      const d = pairDeltaE(a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!, b[i * 3]!, b[i * 3 + 1]!, b[i * 3 + 2]!)
      sum += d
      if (d > V2.lostDE) far++
    }
    deltaE = Math.max(deltaE, sum / n)
    lost = Math.max(lost, far / n)
  }
  return { ssim, deltaE, lost, same: ssim >= V2.ssim && deltaE <= V2.deltaE && lost <= V2.lostMax }
}

/** Gaussian blur σ 1 of an RGB array, edges clamped. */
export function blur1(src: Float32Array, w: number, h: number): Float32Array {
  const k = [0.0044, 0.054, 0.242, 0.399, 0.242, 0.054, 0.0044]
  const tmp = new Float32Array(src.length)
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let v = 0
        for (let d = -3; d <= 3; d++) v += k[d + 3]! * src[(y * w + Math.max(0, Math.min(w - 1, x + d))) * 3 + c]!
        tmp[(y * w + x) * 3 + c] = v
      }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      for (let c = 0; c < 3; c++) {
        let v = 0
        for (let d = -3; d <= 3; d++) v += k[d + 3]! * tmp[(Math.max(0, Math.min(h - 1, y + d)) * w + x) * 3 + c]!
        out[(y * w + x) * 3 + c] = v
      }
  return out
}

/** Mean SSIM of the luminance at full size: 11×11 Gaussian window (σ 1.5), K1 0.01, K2 0.03. */
function ssimFull(a: Float32Array, b: Float32Array, w: number, h: number): number {
  const n = w * h
  const x = new Float32Array(n)
  const y = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    x[i] = 0.299 * a[i * 3]! + 0.587 * a[i * 3 + 1]! + 0.114 * a[i * 3 + 2]!
    y[i] = 0.299 * b[i * 3]! + 0.587 * b[i * 3 + 1]! + 0.114 * b[i * 3 + 2]!
  }
  const mx = gauss(x, w, h)
  const my = gauss(y, w, h)
  // One product map at a time, each blurred and folded in before the next is made.
  const prod = new Float32Array(n)
  const moment = (f: (i: number) => number) => {
    for (let i = 0; i < n; i++) prod[i] = f(i)
    return gauss(prod, w, h)
  }
  const sxx = moment((i) => x[i]! * x[i]!)
  const syy = moment((i) => y[i]! * y[i]!)
  const sxy = moment((i) => x[i]! * y[i]!)
  const C1 = (0.01 * 255) ** 2
  const C2 = (0.03 * 255) ** 2
  let sum = 0
  for (let i = 0; i < n; i++) {
    const ux = mx[i]!
    const uy = my[i]!
    sum +=
      ((2 * ux * uy + C1) * (2 * (sxy[i]! - ux * uy) + C2)) /
      ((ux * ux + uy * uy + C1) * (sxx[i]! - ux * ux + syy[i]! - uy * uy + C2))
  }
  return sum / n
}
