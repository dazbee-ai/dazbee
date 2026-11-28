// A drop shadow or glow read from a piece with no drawing but one: where the graphics leave a soft fringe of the
// piece uncovered, the fringe is fitted as their own coverage moved, blurred and faded, the way the renderer draws
// a drop shadow (a Gaussian of σ half the blur), in the fringe's colour, and the shadow that leaves the least of
// the fringe is given.

import type { DropShadow } from '@dazbee/schema'

import { hexColour, type SrgbFloat } from './parts/colour.ts'
import type { FloatPicture } from './parts/float-picture.ts'

/** A shadow as it is fitted: its offset and blur σ in the fitted pictures' pixels, and its alpha. */
interface Fit {
  x: number
  y: number
  sigma: number
  alpha: number
}

export const SHADOW = {
  /** A pixel the graphics leave uncovered by more than this alpha is part of the fringe. */
  uncovered: 0.03,
  /** A fringe under this share of the piece's coverage is no shadow. */
  smallest: 0.015,
  /** A shadow is kept when it leaves at most this share of the fringe. */
  leaves: 0.6,
  /** A shadow lies at most this many of the fitted pictures' pixels from its graphics, across and down. */
  farthest: 16,
  /** The most shadows tried. */
  tries: 90,
} as const

/**
 * The drop shadow that the piece shows round its graphics, or null when it shows none: `piece` and `made`, the
 * graphics drawn, are the same size, `scale` of their pixels to a piece pixel.
 */
export function shadowOf(piece: FloatPicture, made: FloatPicture, scale: number): DropShadow | null {
  const { width, height } = piece
  const n = width * height
  const cover = new Float32Array(n)
  const fringe = new Float32Array(n)
  let total = 0
  let left = 0
  let weight = 0
  const rgb: SrgbFloat = [0, 0, 0]
  let fx = 0
  let fy = 0
  let cx = 0
  let cy = 0
  let covered = 0
  for (let i = 0; i < n; i++) {
    const alpha = piece.data[i * 4 + 3] ?? 0
    cover[i] = made.data[i * 4 + 3] ?? 0
    total += alpha
    covered += cover[i] ?? 0
    cx += (i % width) * (cover[i] ?? 0)
    cy += Math.floor(i / width) * (cover[i] ?? 0)
    const uncovered = alpha - (cover[i] ?? 0)
    if (uncovered <= SHADOW.uncovered) continue
    fringe[i] = uncovered
    left += uncovered
    weight += uncovered
    for (let c = 0; c < 3; c++) rgb[c] = (rgb[c] ?? 0) + (piece.data[i * 4 + c] ?? 0) * uncovered
    fx += (i % width) * uncovered
    fy += Math.floor(i / width) * uncovered
  }
  if (weight === 0 || covered === 0 || left < total * SHADOW.smallest) return null
  for (let c = 0; c < 3; c++) rgb[c] = (rgb[c] ?? 0) / weight
  // What a shadow leaves of the fringe: the fringe less the shadow, where the graphics don't cover it.
  // Moving a blurred mask gives what blurring the moved mask does, so the coverage is blurred once for each σ, with
  // room around it for the blur that a move brings into the piece.
  const room = SHADOW.farthest + 1
  const wide = width + 2 * room
  const tall = height + 2 * room
  const padded = new Float32Array(wide * tall)
  for (let y = 0; y < height; y++) padded.set(cover.subarray(y * width, (y + 1) * width), (y + room) * wide + room)
  const along = new Float32Array(wide * tall)
  const moved = new Float32Array(n)
  const blurs = new Map<number, Float32Array>()
  const leaves = (t: Fit): number => {
    let blurred = blurs.get(t.sigma)
    if (!blurred) {
      blurred = new Float32Array(wide * tall)
      blur(padded, along, blurred, wide, tall, t.sigma)
      blurs.set(t.sigma, blurred)
    }
    shifted(blurred, wide, room, moved, width, height, t.x, t.y)
    let error = 0
    for (let i = 0; i < n; i++) error += Math.abs((fringe[i] ?? 0) - t.alpha * (moved[i] ?? 0) * (1 - (cover[i] ?? 0)))
    return error
  }
  // It starts half way from the graphics' centre to the fringe's.
  const within = (v: number) => Math.max(-SHADOW.farthest, Math.min(SHADOW.farthest, v))
  let best: Fit = {
    x: within((fx / weight - cx / covered) * 0.5),
    y: within((fy / weight - cy / covered) * 0.5),
    sigma: Math.max(1, Math.sqrt(covered) * 0.04),
    alpha: 0.35,
  }
  let bestLeft = leaves(best)
  let tries = 1
  const steps: Fit = { x: 2, y: 2, sigma: 1.5, alpha: 0.1 }
  for (let size = 1; size > 0.1 && tries < SHADOW.tries;) {
    let improved = false
    for (const key of ['x', 'y', 'sigma', 'alpha'] as const)
      for (const direction of [1, -1]) {
        const next = { ...best, [key]: best[key] + direction * steps[key] * size }
        if (next.sigma < 0.3 || next.alpha <= 0.02 || next.alpha > 1) continue
        if (Math.abs(next.x) > SHADOW.farthest || Math.abs(next.y) > SHADOW.farthest) continue
        tries++
        const tried = leaves(next)
        if (tried < bestLeft - 1e-6) {
          bestLeft = tried
          best = next
          improved = true
        }
      }
    if (!improved) size /= 2
  }
  if (bestLeft > SHADOW.leaves * left) return null
  const hundredths = (v: number) => Math.round(v * 100) / 100
  return {
    type: 'dropShadow',
    x: hundredths(best.x / scale),
    y: hundredths(best.y / scale),
    blur: hundredths((2 * best.sigma) / scale),
    spread: 0,
    color: hexColour(...rgb, Math.max(0, Math.min(1, best.alpha))),
  }
}

/**
 * A mask moved by (dx, dy) and read between pixels into `to`: `from` is `wide` across and holds `room` pixels more
 * than `to` on every side, and no move is longer than that.
 */
function shifted(
  from: Float32Array,
  wide: number,
  room: number,
  to: Float32Array,
  width: number,
  height: number,
  dx: number,
  dy: number,
) {
  const ix = Math.floor(dx)
  const iy = Math.floor(dy)
  const tx = dx - ix
  const ty = dy - iy
  for (let y = 0; y < height; y++) {
    const row = (y + room - iy) * wide + room - ix
    for (let x = 0; x < width; x++) {
      const at = row + x
      to[y * width + x] =
        (from[at] ?? 0) * (1 - tx) * (1 - ty) +
        (from[at - 1] ?? 0) * tx * (1 - ty) +
        (from[at - wide] ?? 0) * (1 - tx) * ty +
        (from[at - wide - 1] ?? 0) * tx * ty
    }
  }
}

/** A mask blurred by a Gaussian of σ, across then down; past its edge it is 0. */
function blur(from: Float32Array, along: Float32Array, to: Float32Array, width: number, height: number, sigma: number) {
  const radius = Math.max(1, Math.ceil(3 * sigma))
  const taps = new Float32Array(2 * radius + 1)
  let sum = 0
  for (let k = -radius; k <= radius; k++) sum += taps[k + radius] = Math.exp(-(k * k) / (2 * sigma * sigma))
  for (let k = 0; k < taps.length; k++) taps[k] = (taps[k] ?? 0) / sum
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let v = 0
      for (let k = Math.max(-radius, -x); k <= Math.min(radius, width - 1 - x); k++)
        v += (taps[k + radius] ?? 0) * (from[y * width + x + k] ?? 0)
      along[y * width + x] = v
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let v = 0
      for (let k = Math.max(-radius, -y); k <= Math.min(radius, height - 1 - y); k++)
        v += (taps[k + radius] ?? 0) * (along[(y + k) * width + x] ?? 0)
      to[y * width + x] = v
    }
}
