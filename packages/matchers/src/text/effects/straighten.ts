// Straightening a curved text piece: its pixels in the frame where its curve stands upright, resampled
// along the curve so the matcher reads straight letters. An arc or a circle is unrolled about its
// centre (a circle from the bottom, clockwise), a wave along its length; each line of the output is a
// curve parallel to the letters', and past the piece is the background, or clear for a cut-out.

import type { Pixels } from '@dazbee/renderer'

import type { CurveKind } from '../curve-check.ts'
import { type Circle, type Point, reachRound, type Sine, sineAt, sineSlope } from '../curve-fits.ts'
import { isCutOut } from '../ink.ts'
import type { PieceReading } from '../read-piece.ts'

/** A straightened picture's size, and the point in the upright frame each of its pixels comes from. */
interface Unrolled {
  width: number
  height: number
  at: (u: number, v: number) => Point
}

/** The pixels left round the ink when it is straightened. */
const STRAIGHT_MARGIN = 4

/** Ink over this counts when the ink's reach round its curve is measured. */
const REACH_INK = 0.5

/** The steps, in pixels, a wave is measured along. */
const WAVE_STEP = 0.5

/**
 * The pixels of an upright reading straightened along its curve of `kind`: an arc or a circle about
 * `circle`, at its radius, the letters standing outwards from its centre when `up`; a wave along
 * `sine`. Null when the reading has no ink or the curve it needs is missing.
 */
export function straightened(
  reading: PieceReading,
  kind: CurveKind,
  { circle, sine, up }: { circle?: Circle | undefined; sine?: Sine | undefined; up: boolean },
): Pixels | null {
  const { level } = reading
  const inked: Point[] = []
  for (let y = 0; y < level.height; y++)
    for (let x = 0; x < level.width; x++)
      if ((level.data[y * level.width + x] ?? 0) > REACH_INK) inked.push([x + 0.5, y + 0.5])
  const map = kind === 'wave' ? sine && waveMap(sine, inked) : circle && polarMap(kind, circle, up, inked)
  if (!map) return null
  const source = toPiece(reading)
  return resampled(reading, map.width, map.height, (u, v) => source(map.at(u, v)))
}

/**
 * An arc or a circle unrolled about its centre: across, the angle round it at the baseline's radius,
 * so lengths along it are the line's; down, the radius, outwards first when the letters stand
 * outwards (`up`), inwards first when they stand inwards.
 */
function polarMap(kind: CurveKind, circle: Circle, up: boolean, inked: readonly Point[]): Unrolled | null {
  if (inked.length === 0) return null
  let near = Infinity
  let far = 0
  for (const [x, y] of inked) {
    const r = Math.hypot(x - circle.cx, y - circle.cy)
    near = Math.min(near, r)
    far = Math.max(far, r)
  }
  near = Math.max(0, near - STRAIGHT_MARGIN)
  far += STRAIGHT_MARGIN
  const radius = Math.max(1, circle.radius)
  // Angles clockwise from up (an arc up, a circle) or anticlockwise from down (an arc down).
  const reach =
    kind === 'circle'
      ? { from: -Math.PI, to: Math.PI }
      : (() => {
          const round = reachRound(circle, inked)
          const pad = STRAIGHT_MARGIN / radius
          // Anticlockwise from down is a half turn less the angle clockwise from up.
          return up
            ? { from: round.from - pad, to: round.to + pad }
            : { from: Math.PI - round.to - pad, to: Math.PI - round.from + pad }
        })()
  const width = Math.max(1, Math.round((reach.to - reach.from) * radius))
  const height = Math.max(1, Math.round(far - near))
  return {
    width,
    height,
    at: (u, v) => {
      const angle = reach.from + (u + 0.5) / radius
      if (up) {
        const r = far - (v + 0.5)
        return [circle.cx + r * Math.sin(angle), circle.cy - r * Math.cos(angle)]
      }
      const r = near + (v + 0.5)
      return [circle.cx + r * Math.sin(angle), circle.cy + r * Math.cos(angle)]
    },
  }
}

/**
 * A wave unrolled along its length: across, the distance along the sine; down, the distance off it
 * along its normal, from the highest ink above it to the lowest below.
 */
function waveMap(sine: Sine, inked: readonly Point[]): Unrolled | null {
  if (inked.length === 0) return null
  const y = (x: number) => sineAt(sine, x)
  const slope = (x: number) => sineSlope(sine, x)
  let left = Infinity
  let right = -Infinity
  let above = 0
  let below = 0
  for (const [x, py] of inked) {
    left = Math.min(left, x)
    right = Math.max(right, x)
    const off = (py - y(x)) / Math.hypot(1, slope(x))
    above = Math.min(above, off)
    below = Math.max(below, off)
  }
  left -= STRAIGHT_MARGIN
  right += STRAIGHT_MARGIN
  above -= STRAIGHT_MARGIN
  below += STRAIGHT_MARGIN
  // The distance along the wave at each step across, to find where a distance along it is.
  const xs: number[] = [left]
  const along: number[] = [0]
  for (let x = left; x < right; x += WAVE_STEP) {
    const next = x + WAVE_STEP
    xs.push(next)
    along.push((along.at(-1) ?? 0) + Math.hypot(WAVE_STEP, y(next) - y(x)))
  }
  const length = along.at(-1) ?? 0
  let at = 0
  return {
    width: Math.max(1, Math.round(length)),
    height: Math.max(1, Math.round(below - above)),
    at: (u, v) => {
      const s = u + 0.5
      // The columns are asked for left to right, row by row, so the search walks on from the last.
      if ((along[at] ?? 0) > s) at = 0
      while (at < along.length - 2 && (along[at + 1] ?? 0) < s) at++
      const a = along[at] ?? 0
      const b = along[at + 1] ?? a
      const x = (xs[at] ?? left) + (b > a ? ((s - a) / (b - a)) * WAVE_STEP : 0)
      const d = slope(x)
      const n = Math.hypot(1, d)
      const off = above + v + 0.5
      return [x - (d / n) * off, y(x) + off / n]
    },
  }
}

/** Where a point of the upright frame is in the piece's pixels: turned back by the upright tilt about the centre. */
function toPiece(reading: PieceReading): (point: Point) => Point {
  const a = (reading.angle * Math.PI) / 180
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const cx = reading.level.width / 2
  const cy = reading.level.height / 2
  return ([x, y]) => [cos * (x - cx) - sin * (y - cy) + cx, sin * (x - cx) + cos * (y - cy) + cy]
}

/**
 * A `width` × `height` picture whose each pixel is the piece's colour, bilinear and weighted by alpha,
 * at the point `from` gives; past the piece, the background, or clear for a cut-out.
 */
function resampled(
  reading: PieceReading,
  width: number,
  height: number,
  from: (u: number, v: number) => Point,
): Pixels {
  const { pixels: piece } = reading
  const cutOut = isCutOut(piece)
  const [br, bg, bb] = reading.background
  const outside = cutOut ? [0, 0, 0, 0] : [br, bg, bb, 255]
  const texel = (x: number, y: number, c: number) =>
    x < 0 || y < 0 || x >= piece.width || y >= piece.height
      ? (outside[c] ?? 0)
      : (piece.pixels[(y * piece.width + x) * 4 + c] ?? 0)
  const out = new Uint8Array(width * height * 4)
  for (let v = 0; v < height; v++)
    for (let u = 0; u < width; u++) {
      const [px, py] = from(u, v)
      const fx = px - 0.5
      const fy = py - 0.5
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const ax = fx - x0
      const ay = fy - y0
      const taps: [number, number, number][] = [
        [x0, y0, (1 - ax) * (1 - ay)],
        [x0 + 1, y0, ax * (1 - ay)],
        [x0, y0 + 1, (1 - ax) * ay],
        [x0 + 1, y0 + 1, ax * ay],
      ]
      let alpha = 0
      const sums = [0, 0, 0]
      for (const [x, y, w] of taps) {
        const a = (texel(x, y, 3) / 255) * w
        alpha += a
        for (let c = 0; c < 3; c++) sums[c] = (sums[c] ?? 0) + texel(x, y, c) * a
      }
      const o = (v * width + u) * 4
      for (let c = 0; c < 3; c++) out[o + c] = alpha > 0 ? Math.round((sums[c] ?? 0) / alpha) : 0
      out[o + 3] = Math.round(alpha * 255)
    }
  return { width, height, pixels: out }
}
