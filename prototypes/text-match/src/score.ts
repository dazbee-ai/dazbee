// PROTOTYPE. The shared "looks the same" rule, also used by the shapes prototype: draw the result at
// the block's size on the block's estimated background, then compare it with the block put on that
// same background. SSIM on luminance (Wang et al. 2004: 11×11 Gaussian window, σ 1.5, K1 0.01,
// K2 0.03, after averaging down by max(1, round(min side / 256))) and mean ΔE (CIEDE2000, Sharma et
// al. 2005) over the foreground pixels: those either picture covers by more than half. A block looks
// the same when SSIM ≥ 0.90 and mean ΔE ≤ 5.
import type { Rgba } from './png.ts'

export const SAME_SSIM = 0.9
export const SAME_DELTA_E = 5

export interface Score {
  ssim: number
  deltaE: number
  same: boolean
}

/**
 * Both pictures over the background (RGB 0–255), compared. Same size. A flat block (no transparency)
 * gives its foreground as `blockInk` (0 to 1 a pixel), since its alpha covers everything.
 */
export function score(block: Rgba, drawn: Rgba, background: readonly number[], blockInk?: Float32Array): Score {
  const a = over(block, background)
  const b = over(drawn, background)
  const ssim = lumaSsim(a, b, block.width, block.height)
  let sum = 0
  let n = 0
  for (let i = 0; i < block.width * block.height; i++) {
    const fg = blockInk ? blockInk[i]! > 0.5 : block.data[i * 4 + 3]! > 127
    if (!fg && drawn.data[i * 4 + 3]! <= 127) continue
    sum += ciede2000(lab(a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!), lab(b[i * 3]!, b[i * 3 + 1]!, b[i * 3 + 2]!))
    n++
  }
  const deltaE = n > 0 ? sum / n : 0
  return { ssim, deltaE, same: ssim >= SAME_SSIM && deltaE <= SAME_DELTA_E }
}

/** RGB of a picture over a flat background. */
export function over(img: Rgba, bg: readonly number[]): Float32Array {
  const out = new Float32Array(img.width * img.height * 3)
  for (let i = 0; i < img.width * img.height; i++) {
    const al = img.data[i * 4 + 3]! / 255
    for (let c = 0; c < 3; c++) out[i * 3 + c] = img.data[i * 4 + c]! * al + bg[c]! * (1 - al)
  }
  return out
}

function lumaSsim(a: Float32Array, b: Float32Array, width: number, height: number): number {
  const f = Math.max(1, Math.round(Math.min(width, height) / 256))
  const w = Math.max(1, Math.floor(width / f))
  const h = Math.max(1, Math.floor(height / f))
  const ya = luma(a, width, height, f, w, h)
  const yb = luma(b, width, height, f, w, h)
  const blur = (v: Float32Array) => gauss(v, w, h)
  const mu1 = blur(ya)
  const mu2 = blur(yb)
  const s11 = blur(ya.map((v) => v * v))
  const s22 = blur(yb.map((v) => v * v))
  const s12 = blur(ya.map((v, i) => v * yb[i]!))
  const c1 = (0.01 * 255) ** 2
  const c2 = (0.03 * 255) ** 2
  let total = 0
  for (let i = 0; i < w * h; i++) {
    const m1 = mu1[i]!
    const m2 = mu2[i]!
    const v1 = s11[i]! - m1 * m1
    const v2 = s22[i]! - m2 * m2
    const cov = s12[i]! - m1 * m2
    total += ((2 * m1 * m2 + c1) * (2 * cov + c2)) / ((m1 * m1 + m2 * m2 + c1) * (v1 + v2 + c2))
  }
  return total / (w * h)
}

function luma(rgb: Float32Array, width: number, _height: number, f: number, w: number, h: number) {
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let j = 0; j < f; j++)
        for (let i = 0; i < f; i++) {
          const k = ((y * f + j) * width + x * f + i) * 3
          s += 0.2126 * rgb[k]! + 0.7152 * rgb[k + 1]! + 0.0722 * rgb[k + 2]!
        }
      out[y * w + x] = s / (f * f)
    }
  return out
}

const KERNEL = (() => {
  const k = Array.from({ length: 11 }, (_, i) => Math.exp(-((i - 5) ** 2) / (2 * 1.5 * 1.5)))
  const s = k.reduce((a, b) => a + b, 0)
  return k.map((v) => v / s)
})()

/** An 11-tap Gaussian blur, edges mirrored. */
function gauss(v: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const mirror = (i: number, n: number) => (i < 0 ? Math.min(n - 1, -i - 1) : i >= n ? Math.max(0, 2 * n - i - 1) : i)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let k = 0; k < 11; k++) s += KERNEL[k]! * v[y * w + mirror(x + k - 5, w)]!
      tmp[y * w + x] = s
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let k = 0; k < 11; k++) s += KERNEL[k]! * tmp[mirror(y + k - 5, h) * w + x]!
      out[y * w + x] = s
    }
  return out
}

/** sRGB 0–255 to CIE L*a*b* (D65). */
export function lab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

/** CIEDE2000 colour difference, as Sharma, Wu and Dalal (2005) give it. */
export function ciede2000(p: readonly number[], q: readonly number[]): number {
  const [L1, a1, b1] = p as [number, number, number]
  const [L2, a2, b2] = q as [number, number, number]
  const rad = Math.PI / 180
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cm = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)))
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const hue = (b: number, a: number) => {
    if (a === 0 && b === 0) return 0
    const h = Math.atan2(b, a) / rad
    return h < 0 ? h + 360 : h
  }
  const h1p = hue(b1, a1p)
  const h2p = hue(b2, a2p)
  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad)
  const Lmp = (L1 + L2) / 2
  const Cmp = (C1p + C2p) / 2
  let hmp = h1p + h2p
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hmp = (h1p + h2p) / 2
    else hmp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2
  }
  const T =
    1 -
    0.17 * Math.cos((hmp - 30) * rad) +
    0.24 * Math.cos(2 * hmp * rad) +
    0.32 * Math.cos((3 * hmp + 6) * rad) -
    0.2 * Math.cos((4 * hmp - 63) * rad)
  const dTheta = 30 * Math.exp(-(((hmp - 275) / 25) ** 2))
  const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7))
  const Sl = 1 + (0.015 * (Lmp - 50) ** 2) / Math.sqrt(20 + (Lmp - 50) ** 2)
  const Sc = 1 + 0.045 * Cmp
  const Sh = 1 + 0.015 * Cmp * T
  const Rt = -Math.sin(2 * dTheta * rad) * Rc
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))
}

/**
 * Not the shared rule: the same comparison after the drawn text is blurred as much as the block is
 * soft (the σ of 0, 0.6, 1, 1.5 or 2.2 px that scores best), so a crisp result for a soft generated
 * block is judged by its letters, not by its sharpness. Reported beside the shared rule.
 */
export function blurMatchedScore(block: Rgba, drawn: Rgba, background: readonly number[], blockInk?: Float32Array): Score & { sigma: number } {
  let best: (Score & { sigma: number }) | null = null
  for (const sigma of [0, 0.6, 1, 1.5, 2.2]) {
    const s = { ...score(block, sigma === 0 ? drawn : blurRgba(drawn, sigma), background, blockInk), sigma }
    if (!best || (s.same && !best.same) || (s.same === best.same && s.ssim - s.deltaE / 100 > best.ssim - best.deltaE / 100)) best = s
  }
  return best!
}

/** A Gaussian blur of an RGBA picture, done on premultiplied colour. */
export function blurRgba(img: Rgba, sigma: number): Rgba {
  const { width: w, height: h } = img
  const rad = Math.ceil(sigma * 3)
  const k = Array.from({ length: 2 * rad + 1 }, (_, i) => Math.exp(-((i - rad) ** 2) / (2 * sigma * sigma)))
  const sum = k.reduce((a, b) => a + b, 0)
  const kn = k.map((v) => v / sum)
  const p = new Float32Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const a = img.data[i * 4 + 3]! / 255
    for (let c = 0; c < 3; c++) p[i * 4 + c] = img.data[i * 4 + c]! * a
    p[i * 4 + 3] = img.data[i * 4 + 3]!
  }
  const pass = (src: Float32Array, dx: number, dy: number) => {
    const out = new Float32Array(src.length)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let c = 0; c < 4; c++) {
          let v = 0
          for (let t = -rad; t <= rad; t++) {
            const xx = Math.max(0, Math.min(w - 1, x + t * dx))
            const yy = Math.max(0, Math.min(h - 1, y + t * dy))
            v += kn[t + rad]! * src[(yy * w + xx) * 4 + c]!
          }
          out[(y * w + x) * 4 + c] = v
        }
    return out
  }
  const q = pass(pass(p, 1, 0), 0, 1)
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const a = q[i * 4 + 3]!
    for (let c = 0; c < 3; c++) data[i * 4 + c] = a > 0.5 ? Math.round(Math.min(255, (q[i * 4 + c]! * 255) / a)) : 0
    data[i * 4 + 3] = Math.round(a)
  }
  return { width: w, height: h, data }
}

/**
 * Not the shared rule: the share of the block's ink the drawing misses, and of the drawing's ink the
 * block lacks, each with a pixel of give (a pixel counts as covered when any pixel around it is), so a
 * lost or added stroke shows even where SSIM and the mean ΔE hide it.
 */
export function inkDifference(blockInk: Float32Array, drawn: Rgba): { missed: number; extra: number } {
  const { width: w, height: h } = drawn
  const near = (test: (i: number) => boolean, x: number, y: number) => {
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx
        const yy = y + dy
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && test(yy * w + xx)) return true
      }
    return false
  }
  let ink = 0
  let missed = 0
  let drawnInk = 0
  let extra = 0
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (blockInk[i]! > 0.5) {
        ink++
        if (!near((j) => drawn.data[j * 4 + 3]! > 64, x, y)) missed++
      }
      if (drawn.data[i * 4 + 3]! > 127) {
        drawnInk++
        if (!near((j) => blockInk[j]! > 0.25, x, y)) extra++
      }
    }
  return { missed: ink ? missed / ink : 0, extra: drawnInk ? extra / drawnInk : 0 }
}

/**
 * Not the shared rule: the shapes prototype's proposed variant. Both pictures over white and over
 * black, SSIM at full resolution and the mean ΔE over every pixel of the block, the worse of the two
 * backgrounds kept; the same thresholds. A flat block is compared on its own pixels only.
 */
export function whiteBlackScore(block: Rgba, drawn: Rgba, background: readonly number[], flat: boolean): Score {
  const backs = flat ? [background] : [[255, 255, 255], [0, 0, 0]]
  let worst: Score | null = null
  for (const bg of backs) {
    const a = over(block, bg)
    const b = over(drawn, bg)
    const n = block.width * block.height
    const ya = new Float32Array(n)
    const yb = new Float32Array(n)
    let sum = 0
    for (let i = 0; i < n; i++) {
      ya[i] = 0.2126 * a[i * 3]! + 0.7152 * a[i * 3 + 1]! + 0.0722 * a[i * 3 + 2]!
      yb[i] = 0.2126 * b[i * 3]! + 0.7152 * b[i * 3 + 1]! + 0.0722 * b[i * 3 + 2]!
      sum += ciede2000(lab(a[i * 3]!, a[i * 3 + 1]!, a[i * 3 + 2]!), lab(b[i * 3]!, b[i * 3 + 1]!, b[i * 3 + 2]!))
    }
    const ssim = ssimOf(ya, yb, block.width, block.height)
    const deltaE = sum / n
    if (!worst || ssim < worst.ssim || deltaE > worst.deltaE)
      worst = { ssim: Math.min(ssim, worst?.ssim ?? 1), deltaE: Math.max(deltaE, worst?.deltaE ?? 0), same: false }
  }
  return { ...worst!, same: worst!.ssim >= SAME_SSIM && worst!.deltaE <= SAME_DELTA_E }
}

function ssimOf(ya: Float32Array, yb: Float32Array, w: number, h: number): number {
  const mu1 = gauss(ya, w, h)
  const mu2 = gauss(yb, w, h)
  const s11 = gauss(ya.map((v) => v * v), w, h)
  const s22 = gauss(yb.map((v) => v * v), w, h)
  const s12 = gauss(ya.map((v, i) => v * yb[i]!), w, h)
  const c1 = (0.01 * 255) ** 2
  const c2 = (0.03 * 255) ** 2
  let total = 0
  for (let i = 0; i < w * h; i++) {
    const m1 = mu1[i]!
    const m2 = mu2[i]!
    total += ((2 * m1 * m2 + c1) * (2 * (s12[i]! - m1 * m2) + c2)) / ((m1 * m1 + m2 * m2 + c1) * (s11[i]! - m1 * m1 + s22[i]! - m2 * m2 + c2))
  }
  return total / (w * h)
}
