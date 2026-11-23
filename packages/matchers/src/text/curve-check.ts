// The curve check: whether a text piece's letters run along a curve rather than a straight line, read
// from what the reading already has. The letters are the level ink's blobs (connected ink, specks
// left out), each by its centre. The centres of the blobs in the piece's topmost line band are
// fitted, by least squares, with a straight line, a circular arc and a sine, each trimmed of letters
// far off it (a descender, a capital); the check fires for an arc or a wave when that fits the
// centres much closer than the line does. A circle is read from every blob: their centres round one
// circle, all the way round but for a gap, with the middle of the circle clear of ink.

import {
  bestSine,
  circleDistance,
  fitCircle,
  fitLine,
  lineDistance,
  type Point,
  type Sine,
  sineSlope,
  trimmedFit,
} from './curve-fits.ts'
import { type Ink, median } from './ink.ts'

/** The shape of curve a piece reads as. */
export type CurveKind = 'arc' | 'wave' | 'circle'

/**
 * A letter as the check reads it: a blob of connected ink, by its centre, its mass, its height and its
 * foot, the centre of its pixel furthest down by a measure of down it is read with.
 */
export interface LetterBlob {
  x: number
  y: number
  /** How many pixels it has. */
  mass: number
  /** Its box's height, in pixels. */
  height: number
  foot: Point
}

/** The curve check's reading of a piece. */
export interface CurveCheck {
  /** The shape the check fired for; null when the letters run straight. */
  fired: CurveKind | null
  /** The letters' blobs in the level ink. */
  blobs: LetterBlob[]
  /** The median height of the blobs, in pixels. */
  letterHeight: number
}

/** Ink over this is part of a blob. */
const BLOB_INK = 0.5

/**
 * A blob with less than this share of the mass of the blob `BIG_SHARE` of the way up by mass (a dot
 * among letters, a dot of a script that dots its letters), or fewer pixels than `MIN_BLOB`, is a speck.
 */
const SPECK_SHARE = 0.2

const BIG_SHARE = 0.75

const MIN_BLOB = 6

/** The fewest letters, in the words' first line and among the blobs in the top band, the check reads. */
const MIN_LETTERS = 4

/** The fewest blobs a circle is read from. */
const MIN_CIRCLE_LETTERS = 6

/**
 * An arc or wave fires when it fits the letters' centres closer than the straight line by at least
 * this many letter heights (and `MIN_GAIN_PIXELS`), and to at most `MAX_SHARE` of the line's distance.
 */
const MIN_GAIN = 0.1

const MIN_GAIN_PIXELS = 3

const MAX_SHARE = 0.6

/** A wave is read rather than an arc when it fits the letters to within this share of the arc's distance. */
const WAVE_CLOSER = 0.6

/** A wave turns at least this many times, up and down, along its letters. */
const WAVE_TURNS = 2

/** The steps a sine's turns are counted over along the letters. */
const TURN_STEPS = 64

/** A circle's letters reach round at least this many degrees. */
const CIRCLE_REACH = 300

/** A circle's middle, within this share of its radius, holds at most `CIRCLE_HOLE` of the ink. */
const CIRCLE_MIDDLE = 0.5

const CIRCLE_HOLE = 0.15

/** A circle's letters' centres are within this many letter heights of it, as a root mean square. */
const CIRCLE_RMS = 0.9

/**
 * Whether the level ink's letters run along an arc, a wave or a circle: the arc and the wave fitted
 * to the centres of the blobs in `top`, the topmost line band, and the circle to every blob's. Words
 * whose first line has fewer than `MIN_LETTERS` letters, `letters`, run straight.
 */
export function curveCheck(level: Ink, top: { y: number; h: number }, letters: number): CurveCheck {
  const blobs = letterBlobs(level)
  const letterHeight = Math.max(1, median(blobs.map((b) => b.height)))
  const straight: CurveCheck = { fired: null, blobs, letterHeight }
  if (letters < MIN_LETTERS) return straight
  if (isCircle(level, blobs, letterHeight)) return { ...straight, fired: 'circle' }
  const points = blobs.filter((b) => b.y >= top.y && b.y < top.y + top.h).map((b): Point => [b.x, b.y])
  if (points.length < MIN_LETTERS) return straight
  const line = trimmedFit(points, fitLine, lineDistance)
  if (!line) return straight
  const arc = trimmedFit(points, fitCircle, circleDistance)
  // A sine that doesn't turn both ways along the letters is an arc's bend, not a wave.
  const sine = bestSine(points, letterHeight)
  const wave = sine && turns(sine.model, points) >= WAVE_TURNS ? sine : null
  // An arc bends one way with fewer settings, so a wave is taken only when it fits much closer.
  const curve =
    wave && (!arc || wave.rms < WAVE_CLOSER * arc.rms)
      ? { kind: 'wave' as const, rms: wave.rms }
      : arc && { kind: 'arc' as const, rms: arc.rms }
  if (!curve) return straight
  const gain = line.rms - curve.rms
  const fires = gain >= Math.max(MIN_GAIN * letterHeight, MIN_GAIN_PIXELS) && curve.rms <= MAX_SHARE * line.rms
  return fires ? { ...straight, fired: curve.kind } : straight
}

/**
 * The letters of level ink: its blobs of 4-connected ink, specks left out, in the order they are found,
 * each foot the pixel `down` gives most of (straight down when left out).
 */
export function letterBlobs(ink: Ink, down: (x: number, y: number) => number = (_, y) => y): LetterBlob[] {
  const { width, height, data } = ink
  const seen = new Uint8Array(width * height)
  const found: LetterBlob[] = []
  const stack: number[] = []
  for (let start = 0; start < data.length; start++) {
    if (seen[start] || (data[start] ?? 0) <= BLOB_INK) continue
    seen[start] = 1
    stack.push(start)
    let mass = 0
    let sx = 0
    let sy = 0
    let top = height
    let bottom = -1
    let foot: Point = [0, 0]
    let footDown = -Infinity
    while (stack.length > 0) {
      const i = stack.pop() as number
      const x = i % width
      const y = (i - x) / width
      mass++
      sx += x
      sy += y
      top = Math.min(top, y)
      bottom = Math.max(bottom, y)
      const below = down(x + 0.5, y + 0.5)
      if (below > footDown) {
        footDown = below
        foot = [x + 0.5, y + 0.5]
      }
      const next = [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, y > 0 ? i - width : -1, i + width]
      for (const j of next)
        if (j >= 0 && j < data.length && !seen[j] && (data[j] ?? 0) > BLOB_INK) {
          seen[j] = 1
          stack.push(j)
        }
    }
    found.push({ x: sx / mass + 0.5, y: sy / mass + 0.5, mass, height: bottom - top + 1, foot })
  }
  const masses = found.map((b) => b.mass).sort((a, b) => a - b)
  const least = Math.max(MIN_BLOB, SPECK_SHARE * (masses[Math.floor(masses.length * BIG_SHARE)] ?? 0))
  return found.filter((b) => b.mass >= least)
}

/**
 * Whether the blobs stand round a circle: their centres within `CIRCLE_RMS` letter heights of one,
 * reaching round `CIRCLE_REACH` degrees, with its middle clear of ink.
 */
function isCircle(level: Ink, blobs: readonly LetterBlob[], letterHeight: number): boolean {
  if (blobs.length < MIN_CIRCLE_LETTERS) return false
  const fit = trimmedFit(
    blobs.map((b): Point => [b.x, b.y]),
    fitCircle,
    circleDistance,
  )
  if (!fit || fit.rms > CIRCLE_RMS * letterHeight) return false
  const { cx, cy, radius } = fit.model
  if (reach(blobs, cx, cy) < CIRCLE_REACH) return false
  let inside = 0
  let total = 0
  for (let y = 0; y < level.height; y++)
    for (let x = 0; x < level.width; x++) {
      const ink = level.data[y * level.width + x] ?? 0
      total += ink
      if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < CIRCLE_MIDDLE * radius) inside += ink
    }
  return total > 0 && inside / total <= CIRCLE_HOLE
}

/** How far round a centre the blobs reach, in degrees: the whole turn less its widest gap. */
function reach(blobs: readonly LetterBlob[], cx: number, cy: number): number {
  const angles = blobs.map((b) => Math.atan2(b.y - cy, b.x - cx)).sort((a, b) => a - b)
  let gap = 0
  for (let i = 0; i < angles.length; i++) {
    const next = i + 1 < angles.length ? (angles[i + 1] ?? 0) : (angles[0] ?? 0) + 2 * Math.PI
    gap = Math.max(gap, next - (angles[i] ?? 0))
  }
  return ((2 * Math.PI - gap) * 180) / Math.PI
}

/** How many times a sine turns between up and down from the first point across to the last. */
function turns(sine: Sine, points: readonly Point[]): number {
  const xs = points.map(([x]) => x)
  const from = Math.min(...xs)
  const to = Math.max(...xs)
  const slope = (x: number) => sineSlope(sine, x)
  let count = 0
  let last = Math.sign(slope(from))
  for (let i = 1; i <= TURN_STEPS; i++) {
    const now = Math.sign(slope(from + ((to - from) * i) / TURN_STEPS))
    if (now !== 0 && last !== 0 && now !== last) count++
    if (now !== 0) last = now
  }
  return count
}
