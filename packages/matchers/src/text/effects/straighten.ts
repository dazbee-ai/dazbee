// Straightening a curved text piece: its pixels in the frame where its curve stands upright, resampled
// along the curve so the matcher reads straight letters. An arc or a circle is unrolled about its
// centre (a circle from the bottom, clockwise), a wave along its length; each line of the output is a
// curve parallel to the letters', and past the piece is the background, or clear for a cut-out.

import type { Pixels } from '@dazbee/renderer'

import type { CurveKind } from '../curve-check.ts'
import { type Circle, type Point, reachRound, type Sine, sineAt, sineSlope } from '../curve-fits.ts'
import { isCutOut } from '../ink.ts'
import type { PieceReading } from '../read-piece.ts'

/** A letter a piece is straightened about: its centre, and the blob its pixels are marked with. */
export interface StraightenedLetter {
  x: number
  y: number
  blob: number
}

/** The curve a piece is straightened along, each line's own as `straightened` reads it. */
export interface StraightenedCurve {
  circle?: Circle | undefined
  radii?: readonly number[] | undefined
  sine?: Sine | undefined
  offsets?: readonly number[] | undefined
  up: boolean
  /** Each line's letters, top line first, each letter unrolled about its own centre. */
  letters?: readonly (readonly StraightenedLetter[])[] | undefined
  /** The letters' pixels in the upright reading's level ink, each marked with its letter's blob. */
  labels?: Int32Array | undefined
}

/**
 * A straightened picture's size, and the point in the upright frame each of its pixels comes from;
 * null for a pixel past the line it stands in.
 */
interface Unrolled {
  width: number
  height: number
  at: (u: number, v: number) => Point | null
}

/** The pixels left round the ink when it is straightened. */
const STRAIGHT_MARGIN = 4

/** Ink over this counts when the ink's reach round its curve is measured. */
const REACH_INK = 0.5

/** A line's rows reach this share of the way from its baseline to the next line's. */
const LINE_PARTING = 0.3

/** The steps, in pixels, a wave is measured along. */
const WAVE_STEP = 0.5

/**
 * The pixels of an upright reading straightened along its curve of `kind`, each line along its own:
 * an arc or a circle about `circle`'s centre, each line at its baseline's radius in `radii` (top line
 * first), the letters standing outwards from the centre when `up`; a wave along `sine`, the top
 * line's baseline, each further line on it moved down to its `offsets` (top line first). Null when
 * the reading has no ink or the curve it needs is missing.
 */
export function straightened(reading: PieceReading, kind: CurveKind, curve: StraightenedCurve): Pixels | null {
  const { level } = reading
  const inked: Point[] = []
  for (let y = 0; y < level.height; y++)
    for (let x = 0; x < level.width; x++)
      if ((level.data[y * level.width + x] ?? 0) > REACH_INK) inked.push([x + 0.5, y + 0.5])
  const { circle, radii, sine, offsets, up, letters = [], labels } = curve
  // A pixel unrolled about a letter shows that letter's ink, never a neighbour's, nor its edge: a
  // point next to a neighbour's pixels and none of the letter's own is the neighbour's.
  const ownInk = (point: Point, blob: number) => {
    if (!labels) return true
    const px = Math.floor(point[0])
    const py = Math.floor(point[1])
    let own = false
    let other = false
    for (let y = py - 1; y <= py + 1; y++)
      for (let x = px - 1; x <= px + 1; x++) {
        if (x < 0 || y < 0 || x >= level.width || y >= level.height) continue
        const at = labels[y * level.width + x] ?? -1
        if (at === blob) own = true
        else if (at !== -1) other = true
      }
    return own || !other
  }
  const map =
    kind === 'wave'
      ? sine && waveMap(sine, offsets ?? [sine.c], letters, ownInk, inked)
      : circle && polarMap(kind, circle, radii?.length ? radii : [circle.radius], up, letters, ownInk, inked)
  if (!map) return null
  const source = toPiece(reading)
  // A pixel past its line is read past the piece, as the background.
  return resampled(reading, map.width, map.height, (u, v) => {
    const point = map.at(u, v)
    return point ? source(point) : [-1, -1]
  })
}

/**
 * An arc or a circle unrolled about its centre: down, the radius, outwards first when the letters
 * stand outwards (`up`), inwards first when they stand inwards; across, the angle from the middle of
 * the ink's reach (the top, for a circle), at the radius of the baseline of the line the row stands
 * in, so each line keeps its own lengths. A line's rows reach `LINE_PARTING` of the way from its
 * baseline to the next line's. Each letter, by its centre in `letters`, is stood upright whole, as a
 * turned letter is drawn, rather than spread as it stands further from the centre.
 */
function polarMap(
  kind: CurveKind,
  circle: Circle,
  radii: readonly number[],
  up: boolean,
  letters: readonly (readonly StraightenedLetter[])[],
  ownInk: (point: Point, blob: number) => boolean,
  inked: readonly Point[],
): Unrolled | null {
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
  const widest = Math.max(1, ...radii)
  // Angles clockwise from up (an arc up, a circle) or anticlockwise from down (an arc down).
  const reach =
    kind === 'circle'
      ? { from: -Math.PI, to: Math.PI }
      : (() => {
          const round = reachRound(circle, inked)
          const pad = STRAIGHT_MARGIN / widest
          return up
            ? { from: round.from - pad, to: round.to + pad }
            : { from: Math.PI - round.to - pad, to: Math.PI - round.from + pad }
        })()
  const middle = (reach.from + reach.to) / 2
  const half = (reach.to - reach.from) / 2
  const width = Math.max(1, Math.round(2 * half * widest))
  // The line a row stands in: the line whose baseline's band holds the row's radius.
  const lineAt = (r: number): number => {
    for (let i = 0; i < radii.length - 1; i++) {
      const own = radii[i] ?? 0
      const next = radii[i + 1] ?? own
      const parting = own + LINE_PARTING * (next - own)
      if (up ? r > parting : r < parting) return i
    }
    return Math.max(0, radii.length - 1)
  }
  // Angles clockwise from up, or anticlockwise from down, and the directions out from the centre and along.
  const angleOf = ([x, y]: Point) => Math.atan2(x - circle.cx, up ? circle.cy - y : y - circle.cy)
  const out = (a: number): Point => (up ? [Math.sin(a), -Math.cos(a)] : [Math.sin(a), Math.cos(a)])
  const along = (a: number): Point => (up ? [Math.cos(a), Math.sin(a)] : [Math.cos(a), -Math.sin(a)])
  // Each line's letters, by where their centres unroll to across, and their angles from the middle.
  const placed = radii.map((radius, i) =>
    (letters[i] ?? [])
      .map((letter) => {
        const off = wrapped(angleOf([letter.x, letter.y]) - middle)
        return { across: width / 2 + Math.max(1, radius) * off, off, blob: letter.blob }
      })
      .sort((a, b) => a.across - b.across),
  )
  return {
    width,
    height: Math.max(1, Math.round(far - near)),
    at: (u, v) => {
      const r = up ? far - (v + 0.5) : near + (v + 0.5)
      const line = lineAt(r)
      const radius = Math.max(1, radii[line] ?? widest)
      const across = u + 0.5
      // A line on a smaller radius reaches no further round than the ink does.
      if (Math.abs((across - width / 2) / radius) > half) return null
      const about = (letter: { across: number; off: number } | undefined): Point => {
        const angle = middle + (letter ? letter.off : (across - width / 2) / radius)
        const shift = letter ? across - letter.across : 0
        const [ox, oy] = out(angle)
        const [ax, ay] = along(angle)
        return [circle.cx + r * ox + shift * ax, circle.cy + r * oy + shift * ay]
      }
      return aboutLetter(placed[line] ?? [], across, about, ownInk)
    },
  }
}

/**
 * A wave unrolled along its length: across, the distance along the sine; down, each line's rows the
 * distance off its own curve along the normal, the top line's from the highest ink above it, a line's
 * down to `LINE_PARTING` of the way to the next line's curve, the last line's to the lowest ink below
 * it. Each letter, by its centre in `letters`, is stood upright whole about the curve under it.
 */
function waveMap(
  sine: Sine,
  offsets: readonly number[],
  letters: readonly (readonly StraightenedLetter[])[],
  ownInk: (point: Point, blob: number) => boolean,
  inked: readonly Point[],
): Unrolled | null {
  if (inked.length === 0) return null
  const top = offsets[0] ?? sine.c
  const curveOf = (line: number) => (x: number) => sineAt(sine, x) + (offsets[line] ?? top) - top
  const slope = (x: number) => sineSlope(sine, x)
  const last = Math.max(0, offsets.length - 1)
  let left = Infinity
  let right = -Infinity
  let above = 0
  let below = 0
  for (const [x, py] of inked) {
    left = Math.min(left, x)
    right = Math.max(right, x)
    const n = Math.hypot(1, slope(x))
    above = Math.min(above, (py - curveOf(0)(x)) / n)
    below = Math.max(below, (py - curveOf(last)(x)) / n)
  }
  // Room past the ends for the last letters' turned corners.
  const room = Math.max(STRAIGHT_MARGIN, (below - above) / 2)
  left -= room
  right += room
  // Each line's rows, as offsets off its own curve: from where the line above's end to a share
  // `LINE_PARTING` of the gap down to the next line's curve.
  const bands = offsets.map((_, i) => {
    const gapAbove = i > 0 ? (offsets[i] ?? 0) - (offsets[i - 1] ?? 0) : 0
    const gapBelow = i < last ? (offsets[i + 1] ?? 0) - (offsets[i] ?? 0) : 0
    return {
      line: i,
      from: i === 0 ? above - STRAIGHT_MARGIN : (LINE_PARTING - 1) * gapAbove,
      to: i === last ? below + STRAIGHT_MARGIN : LINE_PARTING * gapBelow,
    }
  })
  const starts: number[] = []
  let height = 0
  for (const band of bands) {
    starts.push(height)
    height += Math.max(0, band.to - band.from)
  }
  // The distance along the wave at each step across, to find where a distance along it is.
  const y = curveOf(0)
  const xs: number[] = [left]
  const along: number[] = [0]
  for (let x = left; x < right; x += WAVE_STEP) {
    const next = x + WAVE_STEP
    xs.push(next)
    along.push((along.at(-1) ?? 0) + Math.hypot(WAVE_STEP, y(next) - y(x)))
  }
  const length = along.at(-1) ?? 0
  // The distance along the wave to a point across.
  const lengthTo = (x: number) => {
    const step = Math.min(xs.length - 2, Math.max(0, Math.floor((x - left) / WAVE_STEP)))
    const a = along[step] ?? 0
    return a + (((along[step + 1] ?? a) - a) * (x - (xs[step] ?? left))) / WAVE_STEP
  }
  let at = 0
  // The point across that stands a distance along the wave.
  const acrossAt = (s: number) => {
    // The columns are asked for left to right, row by row, so the search walks on from the last.
    if ((along[at] ?? 0) > s) at = 0
    while (at < along.length - 2 && (along[at + 1] ?? 0) < s) at++
    const a = along[at] ?? 0
    const b = along[at + 1] ?? a
    return (xs[at] ?? left) + (b > a ? ((s - a) / (b - a)) * WAVE_STEP : 0)
  }
  // Each line's letters, by how far along the wave their centres stand.
  const placed = offsets.map((_, i) =>
    (letters[i] ?? [])
      .map((letter) => ({ across: lengthTo(letter.x), x: letter.x, blob: letter.blob }))
      .sort((a, b) => a.across - b.across),
  )
  return {
    width: Math.max(1, Math.round(length)),
    height: Math.max(1, Math.round(height)),
    at: (u, v) => {
      const s = u + 0.5
      let i = bands.length - 1
      while (i > 0 && v + 0.5 < (starts[i] ?? 0)) i--
      const band = bands[i] ?? { line: 0, from: 0 }
      const off = band.from + (v + 0.5 - (starts[i] ?? 0))
      const about = (letter: { across: number; x: number } | undefined): Point => {
        const x = letter ? letter.x : acrossAt(s)
        const shift = letter ? s - letter.across : 0
        const d = slope(x)
        const n = Math.hypot(1, d)
        return [x + (shift - d * off) / n, curveOf(band.line)(x) + (d * shift + off) / n]
      }
      return aboutLetter(placed[band.line] ?? [], s, about, ownInk)
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

/** An angle in radians brought within a half turn either way of 0. */
function wrapped(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

/**
 * The point a pixel `across` comes from, unrolled about one of the two letters standing nearest it
 * across, of `letters` sorted by where they stand: the nearer when it lands on that letter's own ink
 * or no letter's, else the other when it does; null when both land on a neighbour's. With no letters,
 * unrolled about none.
 */
function aboutLetter<L extends { across: number; blob: number }>(
  letters: readonly L[],
  across: number,
  about: (letter: L | undefined) => Point,
  ownInk: (point: Point, blob: number) => boolean,
): Point | null {
  if (letters.length === 0) return about(undefined)
  let lo = 0
  let hi = letters.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if ((letters[mid]?.across ?? 0) < across) lo = mid + 1
    else hi = mid
  }
  const after = letters[lo]
  const before = letters[lo - 1]
  const nearer = !before || (after && after.across - across < across - before.across) ? after : before
  const other = nearer === after ? before : after
  for (const letter of [nearer, other]) {
    if (!letter) continue
    const point = about(letter)
    if (ownInk(point, letter.blob)) return point
  }
  return null
}
