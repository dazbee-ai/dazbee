// The photo guard: how much of a piece its own graphics leave unexplained. A flat panel, a gradient
// or an icon is explained by its graphics; a photo, even a small product on white, keeps shading,
// texture and many colours they don't. Six measures of the piece against its rebuild, both at most
// 384 px on the long side over mid-grey, are combined by a logistic model fitted on development
// pieces only (the shape prototype's `photo-guard.json`); at or over its bar the piece stays a picture.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Pixels } from '@dazbee/renderer'
import type { MatchAnswer } from '@dazbee/schema'

import { pixelDeltaE } from '../looks-same/rule.ts'
import { pictureAnswer } from './answer.ts'
import { drawGraphics, type DrawnLayer } from './draw-layers.ts'
import { type FloatPicture, shrinkFloats, toFloatPicture } from './parts/float-picture.ts'

/** The six measures, in the model's order. */
export interface PhotoMeasures {
  /** Mean luminance the rebuild misses after a wide blur (σ about 1.7). */
  lostShading: number
  /** Mean edge strength the piece has beyond the rebuild's. */
  lostDetail: number
  /** Entropy, in bits, of the piece's strong edges' directions over 16 bins. */
  directionEntropy: number
  /** The log of one more than the piece's colours at 4 bits a channel. */
  colours: number
  /** Mean ΔE00 between the piece and its rebuild. */
  residualDeltaE: number
  /** The share of the piece's pixels on a strong edge. */
  strongEdgeShare: number
}

/** The guard's model: each measure standardised by its mean and spread, weighted, and passed through the logistic curve. */
export const PHOTO_GUARD = {
  /** Both pictures are measured at most this many pixels on the long side. */
  side: 384,
  mean: [
    2.847101715337341, 1.5705529907805285, 3.02821560556602, 3.0906346749749596, 1.5022265807200696, 0.2171658528259539,
  ],
  spread: [
    4.686722046057934, 2.698397625114451, 0.9190184102622756, 1.7494544727959989, 2.3513319052678616,
    0.27361541061054595,
  ],
  weights: [
    0.6750350945398151, 0.1268216711821513, 0.5950834445325304, 2.0258717062206104, -0.49772913084472625,
    -0.4620296556137263,
  ],
  bias: -1.1506993849442289,
  /** A piece whose graphics score this or more is a photo. */
  bar: 0.8392354750580299,
} as const

const MEASURES = [
  'lostShading',
  'lostDetail',
  'directionEntropy',
  'colours',
  'residualDeltaE',
  'strongEdgeShare',
] as const satisfies readonly (keyof PhotoMeasures)[]
/** The grey both pictures are seen over. */
const GREY = 128
/** A pixel counts when the piece's alpha there is at least this. */
const COUNTED_FROM = 0.5
/** An edge is strong when the luminance changes by more than this across its three pixels. */
const STRONG_EDGE = 4
const DIRECTION_BINS = 16
/** The Gaussian of σ 1 the pictures are blurred by, 7 taps. */
const BLUR_TAPS = [0.0044, 0.054, 0.242, 0.399, 0.242, 0.054, 0.0044]

/** The answer, or a picture with why `photo` when its graphics leave the piece's shading, texture and colours unexplained. */
export function guardedAnswer(ck: CanvasKit, piece: Pixels, answer: MatchAnswer): MatchAnswer {
  if (answer.kind !== 'layers') return answer
  return photoScore(ck, piece, answer.layers) >= PHOTO_GUARD.bar ? pictureAnswer('photo', answer.scores) : answer
}

/** How much a photo the piece is, 0 to 1, by what its graphics, drawn at most 384 px on the long side, leave unexplained. */
export function photoScore(ck: CanvasKit, piece: Pixels, layers: readonly DrawnLayer[]): number {
  const scale = Math.min(1, PHOTO_GUARD.side / Math.max(piece.width, piece.height))
  const rebuild = drawGraphics(ck, layers, piece.width, piece.height, scale)
  const measures = photoMeasures(toFloatPicture(piece), toFloatPicture(rebuild), scale)
  let z: number = PHOTO_GUARD.bias
  MEASURES.forEach((name, i) => {
    const spread = PHOTO_GUARD.spread[i] || 1
    z += (PHOTO_GUARD.weights[i] ?? 0) * ((measures[name] - (PHOTO_GUARD.mean[i] ?? 0)) / spread)
  })
  return 1 / (1 + Math.exp(-z))
}

/**
 * The six measures of a piece against its rebuild drawn `scale` times its size, both shrunk to the
 * piece's size at that scale, seen over mid-grey and blurred by σ 1, over the pixels the piece covers
 * at least half, the edge ones left out.
 */
function photoMeasures(piece: FloatPicture, rebuild: FloatPicture, scale: number): PhotoMeasures {
  const width = Math.max(2, Math.ceil(piece.width * scale - 1e-9))
  const height = Math.max(2, Math.ceil(piece.height * scale - 1e-9))
  const target = scale < 1 ? shrinkFloats(piece, width, height) : piece
  // A side under 3 pixels has no inner pixel, so nothing is counted and the rebuild isn't read.
  if (width < 3 || height < 3) return measuresOf({ count: 0 })
  const made = shrinkFloats(rebuild, width, height)
  const seenTarget = blur(overGrey(target), width, height)
  const seenMade = blur(overGrey(made), width, height)
  const n = width * height
  const lumaTarget = luminance(seenTarget, n)
  const lumaMade = luminance(seenMade, n)
  const wideTarget = wideBlur(lumaTarget, width, height)
  const wideMade = wideBlur(lumaMade, width, height)
  const bins = new Float64Array(DIRECTION_BINS)
  const colours = new Set<number>()
  const memo = new Map<number, number>()
  const sums = { count: 0, shading: 0, detail: 0, residual: 0, strong: 0, strongPixels: 0 }
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x
      if ((target.data[i * 4 + 3] ?? 0) < COUNTED_FROM) continue
      sums.count++
      sums.shading += Math.abs((wideTarget[i] ?? 0) - (wideMade[i] ?? 0))
      const gx = (lumaTarget[i + 1] ?? 0) - (lumaTarget[i - 1] ?? 0)
      const gy = (lumaTarget[i + width] ?? 0) - (lumaTarget[i - width] ?? 0)
      const edge = Math.hypot(gx, gy)
      const madeEdge = Math.hypot(
        (lumaMade[i + 1] ?? 0) - (lumaMade[i - 1] ?? 0),
        (lumaMade[i + width] ?? 0) - (lumaMade[i - width] ?? 0),
      )
      sums.detail += Math.max(0, edge - madeEdge)
      if (edge > STRONG_EDGE) {
        sums.strong += edge
        sums.strongPixels++
        const angle = Math.atan2(gy, gx)
        const bin = Math.min(DIRECTION_BINS - 1, Math.floor((((angle + Math.PI) % Math.PI) / Math.PI) * DIRECTION_BINS))
        bins[bin] = (bins[bin] ?? 0) + edge
      }
      sums.residual += pixelDeltaE(seenTarget, seenMade, i, memo)
      colours.add(
        (((target.data[i * 4] ?? 0) >> 4) << 8) |
          (((target.data[i * 4 + 1] ?? 0) >> 4) << 4) |
          ((target.data[i * 4 + 2] ?? 0) >> 4),
      )
    }
  let entropy = 0
  for (const b of bins) if (b > 0) entropy -= (b / sums.strong) * Math.log2(b / sums.strong)
  return measuresOf({ ...sums, entropy, colours: colours.size })
}

/** The measures from their sums over the counted pixels; nothing counted gives zeros. */
function measuresOf(sums: {
  count: number
  shading?: number
  detail?: number
  residual?: number
  strong?: number
  strongPixels?: number
  entropy?: number
  colours?: number
}): PhotoMeasures {
  const count = sums.count || 1
  return {
    lostShading: (sums.shading ?? 0) / count,
    lostDetail: (sums.detail ?? 0) / count,
    directionEntropy: (sums.strong ?? 0) > 0 ? (sums.entropy ?? 0) : 0,
    colours: Math.log(1 + (sums.colours ?? 0)),
    residualDeltaE: (sums.residual ?? 0) / count,
    strongEdgeShare: (sums.strongPixels ?? 0) / count,
  }
}

/** A picture over mid-grey: opaque RGB. */
function overGrey({ width, height, data }: FloatPicture): Float32Array {
  const rgb = new Float32Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    const alpha = data[i * 4 + 3] ?? 0
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = (data[i * 4 + c] ?? 0) * alpha + GREY * (1 - alpha)
  }
  return rgb
}

/** The luminance of each pixel of an RGB picture. */
function luminance(rgb: Float32Array, n: number): Float32Array {
  const luma = new Float32Array(n)
  for (let i = 0; i < n; i++)
    luma[i] = 0.299 * (rgb[i * 3] ?? 0) + 0.587 * (rgb[i * 3 + 1] ?? 0) + 0.114 * (rgb[i * 3 + 2] ?? 0)
  return luma
}

/** A luminance picture blurred three times by σ 1, about σ 1.7. */
function wideBlur(luma: Float32Array, width: number, height: number): Float32Array {
  const n = width * height
  const rgb = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = luma[i] ?? 0
  const blurred = blur(blur(blur(rgb, width, height), width, height), width, height)
  const wide = new Float32Array(n)
  for (let i = 0; i < n; i++) wide[i] = blurred[i * 3] ?? 0
  return wide
}

/** An RGB picture blurred by a Gaussian of σ 1, along x then y, its edges clamped. */
function blur(rgb: Float32Array, width: number, height: number): Float32Array {
  const along = new Float32Array(rgb.length)
  const out = new Float32Array(rgb.length)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 3; c++) {
        let v = 0
        for (let d = -3; d <= 3; d++)
          v += (BLUR_TAPS[d + 3] ?? 0) * (rgb[(y * width + Math.max(0, Math.min(width - 1, x + d))) * 3 + c] ?? 0)
        along[(y * width + x) * 3 + c] = v
      }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      for (let c = 0; c < 3; c++) {
        let v = 0
        for (let d = -3; d <= 3; d++)
          v += (BLUR_TAPS[d + 3] ?? 0) * (along[(Math.max(0, Math.min(height - 1, y + d)) * width + x) * 3 + c] ?? 0)
        out[(y * width + x) * 3 + c] = v
      }
  return out
}
