// PROTOTYPE. The photo guard: how much of the block its own shape answer leaves unexplained. A
// flat panel, a gradient or an icon is explained by its layers; a photo, even a small product on
// white, keeps shading, texture and many colours its layers don't. Six general measures of the
// block against its rebuild, combined by a logistic model trained on development data only
// (src/photo-guard.json, made by src/train-photo.ts).
import { readFileSync } from 'node:fs'

import { type Img, over, resize } from './pixels.ts'
import { blur1, pairDeltaE } from './score.ts'

export const FEATURES = [
  'lostShading',
  'lostDetail',
  'directionEntropy',
  'colours',
  'residualDE',
  'gradientShare',
] as const
export type Features = Record<(typeof FEATURES)[number], number>

export interface Guard {
  mean: number[]
  std: number[]
  weights: number[]
  bias: number
  /** A shapes answer with a photo score at or above this stays a picture. */
  threshold: number
}

let guard: Guard | null | undefined

/** The trained guard, or null before training. */
export function loadGuard(): Guard | null {
  if (guard === undefined) {
    try {
      guard = JSON.parse(readFileSync(new URL('./photo-guard.json', import.meta.url), 'utf8')) as Guard
    } catch {
      guard = null
    }
  }
  return guard
}

/** The photo score 0..1 of measured features under the trained guard. */
export function photoScore(f: Features, g: Guard): number {
  let z = g.bias
  FEATURES.forEach((k, i) => {
    z += g.weights[i]! * ((f[k] - g.mean[i]!) / (g.std[i]! || 1))
  })
  return 1 / (1 + Math.exp(-z))
}

/**
 * The block against its rebuild, both at no more than 384 px on the long side, over mid-grey,
 * over the block's covered pixels (alpha ≥ 0.5).
 */
export const PHOTO_SIDE = 384

export function photoFeatures(target: Img, made: Img): Features {
  const k = Math.min(1, PHOTO_SIDE / Math.max(target.w, target.h))
  // The renderer's size at scale k, so a rebuild drawn at k needs no resizing.
  const w = Math.max(2, Math.ceil(target.w * k - 1e-9))
  const h = Math.max(2, Math.ceil(target.h * k - 1e-9))
  const T = k < 1 ? resize(target, w, h) : target
  const M = made.w === w && made.h === h ? made : resize(made, w, h)
  const grey: [number, number, number] = [128, 128, 128]
  const t = blur1(over(T, grey), w, h)
  const m = blur1(over(M, grey), w, h)
  const n = w * h
  const lt = new Float32Array(n)
  const lm = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    lt[i] = 0.299 * t[i * 3]! + 0.587 * t[i * 3 + 1]! + 0.114 * t[i * 3 + 2]!
    lm[i] = 0.299 * m[i * 3]! + 0.587 * m[i * 3 + 1]! + 0.114 * m[i * 3 + 2]!
  }
  // Shading: the luminance difference after a wider blur (three passes, σ about 1.7).
  const wide = (l: Float32Array) => {
    const rgb = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = l[i]!
    const b = blur1(blur1(blur1(rgb, w, h), w, h), w, h)
    const out = new Float32Array(n)
    for (let i = 0; i < n; i++) out[i] = b[i * 3]!
    return out
  }
  const wt = wide(lt)
  const wm = wide(lm)
  const bins = new Float64Array(16)
  const colours = new Set<number>()
  let count = 0
  let shading = 0
  let detail = 0
  let residual = 0
  let strong = 0
  let gradPx = 0
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      if (T.d[i * 4 + 3]! < 0.5) continue
      count++
      shading += Math.abs(wt[i]! - wm[i]!)
      const gx = lt[i + 1]! - lt[i - 1]!
      const gy = lt[i + w]! - lt[i - w]!
      const g = Math.hypot(gx, gy)
      const gm = Math.hypot(lm[i + 1]! - lm[i - 1]!, lm[i + w]! - lm[i - w]!)
      detail += Math.max(0, g - gm)
      if (g > 4) {
        strong += g
        gradPx++
        const a = Math.atan2(gy, gx)
        bins[Math.min(15, Math.floor((((a + Math.PI) % Math.PI) / Math.PI) * 16))]! += g
      }
      residual += pairDeltaE(t[i * 3]!, t[i * 3 + 1]!, t[i * 3 + 2]!, m[i * 3]!, m[i * 3 + 1]!, m[i * 3 + 2]!)
      colours.add(((T.d[i * 4]! >> 4) << 8) | ((T.d[i * 4 + 1]! >> 4) << 4) | (T.d[i * 4 + 2]! >> 4))
    }
  let entropy = 0
  for (const b of bins) if (b > 0) entropy -= (b / strong) * Math.log2(b / strong)
  const c = count || 1
  return {
    lostShading: shading / c,
    lostDetail: detail / c,
    directionEntropy: strong > 0 ? entropy : 0,
    colours: Math.log(1 + colours.size),
    residualDE: residual / c,
    gradientShare: gradPx / c,
  }
}
