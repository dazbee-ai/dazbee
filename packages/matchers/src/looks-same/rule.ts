// The looks-the-same rule, fitted to the owner's blind votes: whether a matcher's rebuild may take
// its piece's place. The piece and its rebuild, drawn at the piece's size, are shrunk alike to at
// most 512 px a side, put over each background the piece is seen on, and blurred by a Gaussian of
// σ 2 px; SSIM, the share of ink missed and the share of far pixels are read from that, the worse
// over the backgrounds counting. Text and shapes each have their own bars, and text also has the
// colour guard.

import type { Pixels } from '@dazbee/renderer'
import type { LooksSameScores, PieceKind, Rgb } from '@dazbee/schema'

import { ciede2000, srgbToLab } from './colour.ts'
import { inkColourDistance } from './colour-guard.ts'

/** What a rebuild is judged with besides the two pictures: what the piece is seen on, and its ink when its alpha can't tell it. */
export interface JudgeOptions {
  /**
   * The colours the piece is seen on; the worse value of each number over them counts. Left out or
   * empty, the piece is seen over `LOOKS_SAME.seeThrough`.
   */
  backgrounds?: readonly Rgb[]
  /** The piece's ink, 0 to 1 a pixel, when its alpha covers everything, as a flat crop's does. */
  pieceInk?: Float32Array
}

/** Whether a rebuild looks the same as its piece, and the numbers that decided it. */
export interface Judged {
  same: boolean
  scores: LooksSameScores
}

/** The rule's settings and bars. */
export const LOOKS_SAME = {
  /** Both pictures are shrunk alike (a box filter) until neither side is over this. */
  maxSide: 512,
  /** σ in pixels of the Gaussian blur put on both pictures before they are compared. */
  blur: 2,
  /** What a see-through piece is seen over when no background is given: the judging page's checker, averaged. */
  seeThrough: [180, 180, 180] as Rgb,
  /** A pixel is far when the pictures' colours there are more than this ΔE00 apart. */
  farDeltaE: 10,
  /** Text looks the same when SSIM ≥ ssim, at most inkMissed of its ink is missed, and the colour guard holds. */
  text: { ssim: 0.46, inkMissed: 0.25, inkColour: 10 },
  /** Shapes look the same when at most this share of their foreground is far. */
  shape: { far: 0.015 },
} as const

const SSIM_C1 = (0.01 * 255) ** 2
const SSIM_C2 = (0.03 * 255) ** 2
/** The ΔE00 memo is emptied past this many colour pairs. */
const MEMO_LIMIT = 1_000_000

/**
 * Judges a rebuild of a piece of the given kind. Both pictures are the same size, 8-bit RGBA with
 * straight alpha. Text is judged by SSIM, ink missed and the colour guard; shapes by the far share.
 */
export function looksSame(kind: PieceKind, piece: Pixels, rebuild: Pixels, options: JudgeOptions = {}): Judged {
  const measured = measure(piece, rebuild, options)
  if (kind === 'shape') return { same: measured.far <= LOOKS_SAME.shape.far, scores: measured }
  const inkColour = inkColourDistance(piece, rebuild, options.pieceInk)
  const same =
    measured.ssim >= LOOKS_SAME.text.ssim &&
    measured.inkMissed <= LOOKS_SAME.text.inkMissed &&
    inkColour <= LOOKS_SAME.text.inkColour
  return { same, scores: { ...measured, inkColour } }
}

/** SSIM, ink missed and the far share, the worse over the backgrounds. */
function measure(piece: Pixels, rebuild: Pixels, options: JudgeOptions): Required<Omit<LooksSameScores, 'inkColour'>> {
  if (piece.width !== rebuild.width || piece.height !== rebuild.height) {
    throw new Error(`the rebuild is ${rebuild.width}×${rebuild.height}, the piece ${piece.width}×${piece.height}`)
  }
  const scale = Math.min(1, LOOKS_SAME.maxSide / Math.max(piece.width, piece.height))
  const width = Math.max(1, Math.round(piece.width * scale))
  const height = Math.max(1, Math.round(piece.height * scale))
  const n = width * height
  const a = shrink(piece, width, height)
  const b = shrink(rebuild, width, height)
  const ink = options.pieceInk ? shrinkMask(options.pieceInk, piece.width, piece.height, width, height) : null

  const pieceFg = new Uint8Array(n)
  const rebuildFg = new Uint8Array(n)
  let fgCount = 0
  for (let i = 0; i < n; i++) {
    pieceFg[i] = (ink ? (ink[i] ?? 0) > 0.5 : (a.pixels[i * 4 + 3] ?? 0) > 127) ? 1 : 0
    rebuildFg[i] = (b.pixels[i * 4 + 3] ?? 0) > 127 ? 1 : 0
    if (pieceFg[i] || rebuildFg[i]) fgCount++
  }
  const inkMissed = missedShare(pieceFg, rebuildFg, width, height)

  let ssim = Infinity
  let far = -Infinity
  const backgrounds = options.backgrounds?.length ? options.backgrounds : [LOOKS_SAME.seeThrough]
  for (const background of backgrounds) {
    const seenA = blurRgb(over(a, background), width, height, LOOKS_SAME.blur)
    const seenB = blurRgb(over(b, background), width, height, LOOKS_SAME.blur)
    ssim = Math.min(ssim, meanSsim(luma(seenA, n), luma(seenB, n), width, height))
    const memo = new Map<number, number>()
    let farCount = 0
    for (let i = 0; i < n; i++) {
      if ((pieceFg[i] || rebuildFg[i]) && pixelDeltaE(seenA, seenB, i, memo) > LOOKS_SAME.farDeltaE) farCount++
    }
    far = Math.max(far, fgCount ? farCount / fgCount : 0)
  }
  return { ssim, inkMissed, far }
}

/** A picture shrunk with a box filter in premultiplied colour, its alpha kept; itself at its own size. */
function shrink(picture: Pixels, width: number, height: number): Pixels {
  if (width === picture.width && height === picture.height) return picture
  const src = picture.pixels
  const out = new Uint8Array(width * height * 4)
  const sx = picture.width / width
  const sy = picture.height / height
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const x0 = x * sx
      const x1 = (x + 1) * sx
      const y0 = y * sy
      const y1 = (y + 1) * sy
      let red = 0
      let green = 0
      let blue = 0
      let alpha = 0
      let weight = 0
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++)
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const f = (Math.min(x1, xx + 1) - Math.max(x0, xx)) * (Math.min(y1, yy + 1) - Math.max(y0, yy))
          const i = (yy * picture.width + xx) * 4
          const a = (src[i + 3] ?? 0) / 255
          red += (src[i] ?? 0) * a * f
          green += (src[i + 1] ?? 0) * a * f
          blue += (src[i + 2] ?? 0) * a * f
          alpha += a * f
          weight += f
        }
      const o = (y * width + x) * 4
      out[o] = alpha > 0 ? Math.round(red / alpha) : 0
      out[o + 1] = alpha > 0 ? Math.round(green / alpha) : 0
      out[o + 2] = alpha > 0 ? Math.round(blue / alpha) : 0
      out[o + 3] = Math.round((alpha / weight) * 255)
    }
  return { width, height, pixels: out }
}

/** A 0–1 mask shrunk with a box filter; itself at its own size. */
function shrinkMask(mask: Float32Array, fromWidth: number, fromHeight: number, width: number, height: number) {
  if (width === fromWidth && height === fromHeight) return mask
  const out = new Float32Array(width * height)
  const sx = fromWidth / width
  const sy = fromHeight / height
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let sum = 0
      let weight = 0
      for (let yy = Math.floor(y * sy); yy < Math.ceil((y + 1) * sy); yy++)
        for (let xx = Math.floor(x * sx); xx < Math.ceil((x + 1) * sx); xx++) {
          const f =
            (Math.min((x + 1) * sx, xx + 1) - Math.max(x * sx, xx)) *
            (Math.min((y + 1) * sy, yy + 1) - Math.max(y * sy, yy))
          sum += (mask[yy * fromWidth + xx] ?? 0) * f
          weight += f
        }
      out[y * width + x] = sum / weight
    }
  return out
}

/** The share of the piece's ink with no rebuilt ink within 1 px. */
function missedShare(pieceFg: Uint8Array, rebuildFg: Uint8Array, width: number, height: number): number {
  const near = dilate(rebuildFg, width, height)
  let ink = 0
  let missed = 0
  for (let i = 0; i < width * height; i++)
    if (pieceFg[i]) {
      ink++
      if (!near[i]) missed++
    }
  return ink ? missed / ink : 0
}

/** A mask grown by 1 px each way (a 3×3 square). */
function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
  const across = new Uint8Array(width * height)
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let v = 0
      for (let t = Math.max(0, x - 1); t <= Math.min(width - 1, x + 1) && !v; t++) v = mask[y * width + t] ?? 0
      across[y * width + x] = v
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let v = 0
      for (let t = Math.max(0, y - 1); t <= Math.min(height - 1, y + 1) && !v; t++) v = across[t * width + x] ?? 0
      out[y * width + x] = v
    }
  return out
}

/** A picture's RGB, 0–255, over a flat background. */
function over(picture: Pixels, background: Rgb): Float32Array {
  const n = picture.width * picture.height
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const alpha = (picture.pixels[i * 4 + 3] ?? 0) / 255
    for (let c = 0; c < 3; c++)
      out[i * 3 + c] = (picture.pixels[i * 4 + c] ?? 0) * alpha + (background[c] ?? 0) * (1 - alpha)
  }
  return out
}

/** An RGB picture blurred by a Gaussian of σ (radius 3σ), its edges clamped. */
function blurRgb(rgb: Float32Array, width: number, height: number, sigma: number): Float32Array {
  const taps = normalisedGaussian(Math.ceil(3 * sigma), sigma)
  return blurAlong(blurAlong(rgb, width, height, 3, taps, 'x'), width, height, 3, taps, 'y')
}

/** The taps of a Gaussian of σ from -radius to radius, summing to 1. */
function normalisedGaussian(radius: number, sigma: number): Float64Array {
  const taps = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)))
  let sum = 0
  for (const tap of taps) sum += tap
  return Float64Array.from(taps, (tap) => tap / sum)
}

/**
 * One pass of a separable blur along x or y, each of a picture's channels on its own, its edges
 * clamped. Each output value sums its taps from the first to the last.
 */
function blurAlong(
  from: Float32Array,
  width: number,
  height: number,
  channels: number,
  taps: Float64Array,
  along: 'x' | 'y',
): Float32Array {
  const out = new Float32Array(from.length)
  const count = taps.length
  const radius = (count - 1) / 2
  const length = along === 'x' ? width : height
  // For each place along the axis, the place each tap reads, clamped to the picture.
  const reads = new Int32Array(length * count)
  for (let at = 0; at < length; at++)
    for (let t = 0; t < count; t++) reads[at * count + t] = Math.min(length - 1, Math.max(0, at + t - radius))
  // How far apart in `from` two neighbours along the axis are.
  const step = along === 'x' ? channels : width * channels
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const first = (along === 'x' ? x : y) * count
      const start = along === 'x' ? y * width * channels : x * channels
      const o = (y * width + x) * channels
      for (let c = 0; c < channels; c++) {
        const channelStart = start + c
        let v = 0
        for (let t = 0; t < count; t++) v += (taps[t] ?? 0) * (from[channelStart + (reads[first + t] ?? 0) * step] ?? 0)
        out[o + c] = v
      }
    }
  return out
}

/** Rec. 709 luminance of gamma-encoded RGB. */
function luma(rgb: Float32Array, n: number): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++)
    out[i] = 0.2126 * (rgb[i * 3] ?? 0) + 0.7152 * (rgb[i * 3 + 1] ?? 0) + 0.0722 * (rgb[i * 3 + 2] ?? 0)
  return out
}

/** The mean SSIM of two luminance pictures (Wang et al. 2004): the 11-tap window, K1 0.01, K2 0.03, range 255. */
function meanSsim(x: Float32Array, y: Float32Array, width: number, height: number): number {
  const n = width * height
  const taps = normalisedGaussian(5, 1.5)
  const meanX = ssimBlur(x, width, height, taps)
  const meanY = ssimBlur(y, width, height, taps)
  const product = new Float32Array(n)
  const moment = (of: (i: number) => number) => {
    for (let i = 0; i < n; i++) product[i] = of(i)
    return ssimBlur(product, width, height, taps)
  }
  const xx = moment((i) => (x[i] ?? 0) * (x[i] ?? 0))
  const yy = moment((i) => (y[i] ?? 0) * (y[i] ?? 0))
  const xy = moment((i) => (x[i] ?? 0) * (y[i] ?? 0))
  const map = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const mx = meanX[i] ?? 0
    const my = meanY[i] ?? 0
    map[i] =
      ((2 * mx * my + SSIM_C1) * (2 * ((xy[i] ?? 0) - mx * my) + SSIM_C2)) /
      ((mx * mx + my * my + SSIM_C1) * ((xx[i] ?? 0) - mx * mx + (yy[i] ?? 0) - my * my + SSIM_C2))
  }
  let sum = 0
  for (let i = 0; i < n; i++) sum += map[i] ?? 0
  return sum / n
}

/** One channel blurred by the SSIM window's 11 taps, its edges clamped. */
function ssimBlur(src: Float32Array, width: number, height: number, taps: Float64Array): Float32Array {
  return blurAlong(blurAlong(src, width, height, 1, taps, 'x'), width, height, 1, taps, 'y')
}

/** ΔE00 between pixel i of two RGB pictures, each colour rounded to 8 bits; remembered by colour pair. */
function pixelDeltaE(a: Float32Array, b: Float32Array, i: number, memo: Map<number, number>): number {
  const ka = packed(a, i)
  const kb = packed(b, i)
  if (ka === kb) return 0
  const key = ka * 16_777_216 + kb
  let d = memo.get(key)
  if (d === undefined) {
    if (memo.size > MEMO_LIMIT) memo.clear()
    d = ciede2000(srgbToLab(ka >> 16, (ka >> 8) & 255, ka & 255), srgbToLab(kb >> 16, (kb >> 8) & 255, kb & 255))
    memo.set(key, d)
  }
  return d
}

/** Pixel i of an RGB picture rounded to 8 bits a channel, as one number. */
function packed(rgb: Float32Array, i: number): number {
  return (Math.round(rgb[i * 3] ?? 0) << 16) | (Math.round(rgb[i * 3 + 1] ?? 0) << 8) | Math.round(rgb[i * 3 + 2] ?? 0)
}
