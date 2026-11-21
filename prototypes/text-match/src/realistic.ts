// PROTOTYPE. Makes drawn text look like the text blocks the layering job cuts out of generated ads:
// set over a real ad background (or a made one), in a solid or gradient colour, and then either cut
// out the way a matting step cuts it (soft or eroded edges, a halo of the background, specks) or
// kept flat with the background (as an uploaded crop). Used by the training samples (make-samples.ts)
// and by our own realistic test set (make-realistic.ts), each with its own backgrounds.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { readPng, type Rgba } from './png.ts'
import { ciede2000, lab } from './score.ts'

const MING = process.env.MING_DIR ?? 'C:\\Users\\imkes\\Desktop\\ming-setup'

/**
 * The background layers of the test-ad development ads (never the held-out ones, never the text),
 * split in two: `train` for the training samples, `test` for our own test set.
 */
export function backdropFiles(which: 'train' | 'test', root = MING): string[] {
  const ads = readdirSync(join(root, 'test_ads')).sort()
  const dev = ads.filter((_, i) => i % 3 !== 2)
  const mine = dev.filter((_, i) => (which === 'train' ? i % 2 === 0 : i % 2 === 1))
  const files: string[] = []
  for (const ad of mine) {
    const meta = JSON.parse(readFileSync(join(root, 'test_ads', ad, 'blocks.json'), 'utf8')) as {
      backdrop_layer: number
    }
    for (const run of ['single_v4', 'fresh_v1']) {
      const f = join(
        root,
        'layering',
        'runs',
        'ming',
        run,
        ad,
        `layer_${String(meta.backdrop_layer).padStart(2, '0')}.png`,
      )
      if (existsSync(f)) {
        files.push(f)
        break
      }
    }
  }
  return files
}

export const loadBackdrops = (files: readonly string[]): Rgba[] => files.map((f) => readPng(f))

export type Random = () => number

/** A `w`×`h` piece of a backdrop (flipped half the time, its colours shifted a little), or a made background. */
export function background(r: Random, backdrops: readonly Rgba[], w: number, h: number): Rgba {
  const data = new Uint8Array(w * h * 4)
  if (backdrops.length === 0 || r() < 0.3) {
    // A made one: a colour with a gentle gradient and grain.
    const base = [r() * 255, r() * 255, r() * 255]
    const gx = (r() - 0.5) * 60
    const gy = (r() - 0.5) * 60
    const grain = r() * 10
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const t = (x / w - 0.5) * gx + (y / h - 0.5) * gy
        for (let c = 0; c < 3; c++) data[(y * w + x) * 4 + c] = clamp255(base[c]! + t + (r() - 0.5) * grain)
        data[(y * w + x) * 4 + 3] = 255
      }
    return { width: w, height: h, data }
  }
  const src = backdrops[Math.floor(r() * backdrops.length)]!
  // Smaller backdrops than the block are tiled by mirroring.
  const ox = Math.floor(r() * Math.max(1, src.width - w))
  const oy = Math.floor(r() * Math.max(1, src.height - h))
  const flip = r() < 0.5
  const shift = [(r() - 0.5) * 40, (r() - 0.5) * 40, (r() - 0.5) * 40]
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const sx = mirror(ox + (flip ? w - 1 - x : x), src.width)
      const sy = mirror(oy + y, src.height)
      const s = (sy * src.width + sx) * 4
      const d = (y * w + x) * 4
      for (let c = 0; c < 3; c++) data[d + c] = clamp255(src.data[s + c]! + shift[c]!)
      data[d + 3] = 255
    }
  return { width: w, height: h, data }
}

const mirror = (v: number, n: number) => {
  const p = 2 * n
  const m = ((v % p) + p) % p
  return m < n ? m : p - 1 - m
}

export const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)))

/** The mean colour of a picture. */
export function meanColour(img: Rgba): number[] {
  const s = [0, 0, 0]
  const n = img.width * img.height
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) s[c]! += img.data[i * 4 + c]!
  return s.map((v) => v / n)
}

/** A text colour that stands out from `behind` (ΔE 35 or more), or only a little (ΔE 12–25) when `low`. */
export function contrasting(r: Random, behind: readonly number[], low = false): number[] {
  const here = lab(behind[0]!, behind[1]!, behind[2]!)
  let c = [0, 0, 0]
  for (let t = 0; t < 60; t++) {
    c =
      r() < 0.35
        ? (r() < 0.5 ? [20, 20, 20] : [245, 245, 245]).map((v) => clamp255(v + (r() - 0.5) * 30))
        : [r() * 255, r() * 255, r() * 255].map(Math.round)
    const d = ciede2000(here, lab(c[0]!, c[1]!, c[2]!))
    if (low ? d >= 12 && d <= 25 : d >= 35) break
  }
  return c
}

/**
 * Text drawn on nothing (RGBA, unpremultiplied) set over a background. A gradient, when given,
 * recolours the text's own fill colour across the block from `fill` to `to` at `angle` degrees.
 */
export function composite(text: Rgba, behind: Rgba, gradient?: { fill: number[]; to: number[]; angle: number }): Rgba {
  const { width: w, height: h } = text
  const out = new Uint8Array(w * h * 4)
  const a = gradient ? (gradient.angle * Math.PI) / 180 : 0
  const ca = Math.cos(a)
  const sa = Math.sin(a)
  const span = Math.abs(ca) * w + Math.abs(sa) * h || 1
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const al = text.data[i + 3]! / 255
      let rgb = [text.data[i]!, text.data[i + 1]!, text.data[i + 2]!]
      if (gradient) {
        // Only the fill's own colour follows the gradient; an outline or shadow keeps its colour.
        const near =
          Math.abs(rgb[0]! - gradient.fill[0]!) +
          Math.abs(rgb[1]! - gradient.fill[1]!) +
          Math.abs(rgb[2]! - gradient.fill[2]!)
        if (near < 40) {
          const t = Math.max(0, Math.min(1, ((x - w / 2) * ca + (y - h / 2) * sa) / span + 0.5))
          rgb = gradient.fill.map((f, c) => f + (gradient.to[c]! - f) * t)
        }
      }
      for (let c = 0; c < 3; c++) out[i + c] = clamp255(rgb[c]! * al + behind.data[i + c]! * (1 - al))
      out[i + 3] = 255
    }
  return { width: w, height: h, data: out }
}

/** How a cut-out's edges are spoilt. */
export interface Matting {
  /** Blur of the alpha, pixels. */
  soften: number
  /** Edge moved out (positive) or in (negative), in fractions of the alpha's ramp. */
  shift: number
  /** A faint halo of the background round the letters: its strength 0–1 and its reach in pixels. */
  halo: number
  haloReach: number
  /** Specks of the background left in, per thousand pixels. */
  specks: number
  /** Noise on the alpha, 0–1. */
  noise: number
}

export function randomMatting(r: Random): Matting {
  return {
    soften: r() < 0.6 ? r() * 1.2 : 0,
    shift: r() < 0.6 ? (r() - 0.5) * 0.6 : 0,
    halo: r() < 0.3 ? 0.05 + r() * 0.3 : 0,
    haloReach: 1 + r() * 3,
    specks: r() < 0.1 ? r() * 0.6 : 0,
    noise: r() < 0.5 ? r() * 0.04 : 0,
  }
}

/**
 * The cut-out a matting step makes of text over a background: the composite's colours (so its edges
 * carry the background) with the text's alpha spoilt as `m` says.
 */
export function cutOut(r: Random, text: Rgba, comp: Rgba, m: Matting): Rgba {
  const { width: w, height: h } = text
  let alpha = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) alpha[i] = text.data[i * 4 + 3]! / 255
  const original = alpha
  if (m.soften > 0.05) alpha = blurPlane(alpha, w, h, m.soften)
  if (m.shift !== 0)
    for (let i = 0; i < alpha.length; i++) alpha[i] = Math.max(0, Math.min(1, (alpha[i]! - 0.5 + m.shift) * 1.6 + 0.5))
  if (m.halo > 0) {
    const reach = blurPlane(original, w, h, m.haloReach)
    for (let i = 0; i < alpha.length; i++) alpha[i] = Math.max(alpha[i]!, Math.min(1, reach[i]! * 3) * m.halo)
  }
  if (m.specks > 0) {
    const n = Math.round((w * h * m.specks) / 1000)
    for (let k = 0; k < n; k++) {
      const cx = Math.floor(r() * w)
      const cy = Math.floor(r() * h)
      const rad = 1 + r() * 2
      const v = 0.1 + r() * 0.3
      for (let y = Math.max(0, Math.floor(cy - rad)); y < Math.min(h, cy + rad); y++)
        for (let x = Math.max(0, Math.floor(cx - rad)); x < Math.min(w, cx + rad); x++)
          alpha[y * w + x] = Math.max(alpha[y * w + x]!, v)
    }
  }
  const out = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    let a = alpha[i]!
    if (m.noise > 0 && a > 0.02) a = Math.max(0, Math.min(1, a + (r() - 0.5) * 2 * m.noise))
    for (let c = 0; c < 3; c++) out[i * 4 + c] = comp.data[i * 4 + c]!
    out[i * 4 + 3] = Math.round(a * 255)
  }
  return { width: w, height: h, data: out }
}

/** A flat picture's grain and blockiness: noise, and colours rounded in 8×8 blocks a little, as a JPEG does. */
export function flatNoise(r: Random, img: Rgba, amount: number): Rgba {
  const out = new Uint8Array(img.data)
  const { width: w, height: h } = img
  const q = Math.round(amount * 2)
  for (let by = 0; by < h; by += 8)
    for (let bx = 0; bx < w; bx += 8) {
      const mean = [0, 0, 0]
      let n = 0
      for (let y = by; y < Math.min(h, by + 8); y++)
        for (let x = bx; x < Math.min(w, bx + 8); x++) {
          for (let c = 0; c < 3; c++) mean[c]! += img.data[(y * w + x) * 4 + c]!
          n++
        }
      for (let y = by; y < Math.min(h, by + 8); y++)
        for (let x = bx; x < Math.min(w, bx + 8); x++)
          for (let c = 0; c < 3; c++) {
            const i = (y * w + x) * 4 + c
            const v = img.data[i]!
            // Pulls each colour a little towards its block's mean, then rounds it.
            const pulled = v + (mean[c]! / n - v) * Math.min(0.5, amount / 40)
            out[i] = clamp255(q > 0 ? Math.round(pulled / q) * q : pulled + (r() - 0.5) * amount)
          }
    }
  return { width: w, height: h, data: out }
}

/** A separable Gaussian blur of one plane. */
export function blurPlane(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const rad = Math.max(1, Math.ceil(sigma * 2.5))
  const k = Array.from({ length: 2 * rad + 1 }, (_, i) => Math.exp(-((i - rad) ** 2) / (2 * sigma * sigma)))
  const s = k.reduce((a, b) => a + b, 0)
  const kn = k.map((v) => v / s)
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let t = -rad; t <= rad; t++) v += kn[t + rad]! * src[y * w + Math.max(0, Math.min(w - 1, x + t))]!
      tmp[y * w + x] = v
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let t = -rad; t <= rad; t++) v += kn[t + rad]! * tmp[Math.max(0, Math.min(h - 1, y + t)) * w + x]!
      out[y * w + x] = v
    }
  return out
}
