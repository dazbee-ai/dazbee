// The curve check: whether a text piece's letters run along a curve rather than a straight line, read
// from what the reading already has. The letters are the level ink's blobs (connected ink, specks
// left out), each by its centre. The centres of the blobs in the piece's topmost line band are
// fitted, by least squares, with a straight line, a circular arc and a sine, each trimmed of letters
// far off it (a descender, a capital); the check fires for an arc or a wave when that fits the
// centres much closer than the line does. A circle is read from every blob: their centres round one
// circle, all the way round but for a gap, with the middle of the circle clear of ink.

import { type Ink, median } from './ink.ts'

/** A point, across and down. */
export type Point = readonly [number, number]

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

/** A circle: its centre and its radius. */
export interface Circle {
  cx: number
  cy: number
  radius: number
}

/** Circles about one centre, a radius each, and the ring of each point they were fitted through. */
export interface Rings {
  cx: number
  cy: number
  radii: number[]
  rings: number[]
}

/** A sine across: `y = c + slope·x + p·sin(kx) + q·cos(kx)`, `k = 2π / wavelength`. */
export interface Sine {
  c: number
  slope: number
  p: number
  q: number
  wavelength: number
}

/** A fit of points and how close it is. */
interface Fitted<M> {
  model: M
  /** The root mean square of the points' distances off it, over the points kept. */
  rms: number
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
/** A wave is tried at wavelengths from this many letter heights up to the span over `MIN_PERIODS`. */
const SHORTEST_WAVE = 4
const MIN_PERIODS = 0.75
/** How many wavelengths are tried, spaced evenly in their logarithm. */
const WAVE_STEPS = 24
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
/** Rings are found and fitted again this many times. */
const RING_ROUNDS = 3
/** A fit is trimmed this many times of the points more than `TRIM_AT` times their median distance off it. */
const TRIM_ROUNDS = 3
const TRIM_AT = 2.5
/** The least median distance, in pixels, a trim is measured against. */
const TRIM_FLOOR = 0.7

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
 * The circle through points by least squares (Kåsa's: `x² + y² + Dx + Ey + F = 0`, linear in D, E
 * and F); null when they lie on a line.
 */
export function fitCircle(points: readonly Point[]): Circle | null {
  // Fitted about the points' mean, which keeps the sums small.
  const mx = points.reduce((sum, [x]) => sum + x, 0) / Math.max(1, points.length)
  const my = points.reduce((sum, [, y]) => sum + y, 0) / Math.max(1, points.length)
  const solved = leastSquares(
    points,
    ([x, y]) => [x - mx, y - my, 1],
    ([x, y]) => -((x - mx) ** 2 + (y - my) ** 2),
  )
  if (!solved) return null
  const [d = 0, e = 0, f = 0] = solved
  const cx = -d / 2
  const cy = -e / 2
  const squared = cx * cx + cy * cy - f
  return squared > 0 && Number.isFinite(squared) ? { cx: cx + mx, cy: cy + my, radius: Math.sqrt(squared) } : null
}

/**
 * Circles about one centre through points standing in `count` rings, as a text's lines stand on an
 * arc or a circle, by least squares (Kåsa's, with an F for each ring), each point's ring given by
 * `rings` or found from its distance from the centre, the rings parted at the widest gaps; null when
 * they can't be fitted.
 */
export function fitRings(points: readonly Point[], count: number, rings?: readonly number[]): Rings | null {
  const first = fitCircle(points)
  if (!first) return null
  let found: Rings = { cx: first.cx, cy: first.cy, radii: [first.radius], rings: points.map(() => 0) }
  for (let round = 0; round < (rings ? 1 : RING_ROUNDS); round++) {
    const of = rings ?? ringsOf(points, found, count)
    const used = Math.max(...of) + 1
    const solved = leastSquares(
      points.map((point, i) => ({ point, ring: of[i] ?? 0 })),
      ({ point: [x, y], ring }) => [
        x - first.cx,
        y - first.cy,
        ...Array.from({ length: used }, (_, k) => (k === ring ? 1 : 0)),
      ],
      ({ point: [x, y] }) => -((x - first.cx) ** 2 + (y - first.cy) ** 2),
    )
    if (!solved) return rings ? null : found
    const [d = 0, e = 0, ...f] = solved
    const cx = -d / 2
    const cy = -e / 2
    const radii = f.map((fk) => Math.sqrt(Math.max(0, cx * cx + cy * cy - fk)))
    found = { cx: cx + first.cx, cy: cy + first.cy, radii, rings: [...of] }
  }
  return found
}

/** The sine at `wavelength` through points by least squares, with a straight slope; null when it can't be solved. */
export function fitSine(points: readonly Point[], wavelength: number): Sine | null {
  const k = (2 * Math.PI) / wavelength
  const solved = leastSquares(
    points,
    ([x]) => [1, x, Math.sin(k * x), Math.cos(k * x)],
    ([, y]) => y,
  )
  if (!solved) return null
  const [c = 0, slope = 0, p = 0, q = 0] = solved
  return { c, slope, p, q, wavelength }
}

/** How far a point is off a sine, down. */
export function sineDistance(sine: Sine, [x, y]: Point): number {
  const k = (2 * Math.PI) / sine.wavelength
  return y - (sine.c + sine.slope * x + sine.p * Math.sin(k * x) + sine.q * Math.cos(k * x))
}

/** How far a point is off a circle, outwards. */
export function circleDistance(circle: Circle, [x, y]: Point): number {
  return Math.hypot(x - circle.cx, y - circle.cy) - circle.radius
}

/**
 * The sine that fits points closest, its wavelength tried from `SHORTEST_WAVE` letter heights to the
 * points' span over `MIN_PERIODS`; null when the span is too short for a wave.
 */
export function bestSine(points: readonly Point[], letterHeight: number): Fitted<Sine> | null {
  const xs = points.map(([x]) => x)
  const span = Math.max(...xs) - Math.min(...xs)
  const shortest = SHORTEST_WAVE * letterHeight
  const longest = span / MIN_PERIODS
  if (!(longest > shortest)) return null
  let best: Fitted<Sine> | null = null
  for (let i = 0; i < WAVE_STEPS; i++) {
    const wavelength = shortest * (longest / shortest) ** (i / (WAVE_STEPS - 1))
    const fit = trimmedFit(points, (kept) => fitSine(kept, wavelength), sineDistance)
    if (fit && (!best || fit.rms < best.rms)) best = fit
  }
  return best
}

/**
 * A model fitted to points, then fitted again to the points within `TRIM_AT` times their median
 * distance off it, `TRIM_ROUNDS` times; null when it can't be fitted.
 */
export function trimmedFit<M>(
  points: readonly Point[],
  fit: (points: readonly Point[]) => M | null,
  distance: (model: M, point: Point) => number,
): Fitted<M> | null {
  let model = fit(points)
  let kept = points
  for (let round = 0; round < TRIM_ROUNDS && model; round++) {
    const off = points.map((p) => Math.abs(distance(model as M, p)))
    const limit = TRIM_AT * Math.max(TRIM_FLOOR, median(off))
    const within = points.filter((_, i) => (off[i] ?? 0) <= limit)
    if (within.length < MIN_LETTERS || within.length === kept.length) break
    kept = within
    model = fit(kept)
  }
  if (!model) return null
  const squares = kept.map((p) => distance(model as M, p) ** 2)
  return { model, rms: Math.sqrt(squares.reduce((a, b) => a + b, 0) / squares.length) }
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

/** How many times a sine turns between up and down from the first point across to the last. */
function turns(sine: Sine, points: readonly Point[]): number {
  const xs = points.map(([x]) => x)
  const from = Math.min(...xs)
  const to = Math.max(...xs)
  const k = (2 * Math.PI) / sine.wavelength
  const slope = (x: number) => sine.slope + k * (sine.p * Math.cos(k * x) - sine.q * Math.sin(k * x))
  let count = 0
  let last = Math.sign(slope(from))
  for (let i = 1; i <= TURN_STEPS; i++) {
    const now = Math.sign(slope(from + ((to - from) * i) / TURN_STEPS))
    if (now !== 0 && last !== 0 && now !== last) count++
    if (now !== 0) last = now
  }
  return count
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

/**
 * Which of `count` rings about a centre each point stands in, nearest first: the points' distances
 * from it parted at their widest gaps.
 */
function ringsOf(points: readonly Point[], centre: { cx: number; cy: number }, count: number): number[] {
  const radii = points.map(([x, y]) => Math.hypot(x - centre.cx, y - centre.cy))
  const sorted = [...radii].sort((a, b) => a - b)
  const cuts = sorted
    .slice(1)
    .map((r, i) => ({ at: (r + (sorted[i] ?? r)) / 2, gap: r - (sorted[i] ?? r) }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, Math.max(0, count - 1))
    .map((cut) => cut.at)
  return radii.map((r) => cuts.filter((at) => at < r).length)
}

/** The straight line `y = c + slope·x` through points by least squares; null when they stand in one column. */
function fitLine(points: readonly Point[]): { c: number; slope: number } | null {
  const solved = leastSquares(
    points,
    ([x]) => [1, x],
    ([, y]) => y,
  )
  return solved ? { c: solved[0] ?? 0, slope: solved[1] ?? 0 } : null
}

/** How far a point is off a line, down. */
function lineDistance(line: { c: number; slope: number }, [x, y]: Point): number {
  return y - (line.c + line.slope * x)
}

/**
 * The weights of `basis` whose sum is closest to `target` over the items, by least squares (the
 * normal equations, solved by elimination with pivoting); null when they don't fix the weights.
 */
function leastSquares<T>(
  items: readonly T[],
  basis: (item: T) => number[],
  target: (item: T) => number,
): number[] | null {
  const first = items[0]
  if (!first) return null
  const n = basis(first).length
  const rows = Array.from({ length: n }, () => new Array<number>(n + 1).fill(0))
  for (const item of items) {
    const f = basis(item)
    const t = target(item)
    for (let i = 0; i < n; i++) {
      const row = rows[i] as number[]
      for (let j = 0; j < n; j++) row[j] = (row[j] ?? 0) + (f[i] ?? 0) * (f[j] ?? 0)
      row[n] = (row[n] ?? 0) + (f[i] ?? 0) * t
    }
  }
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) if (Math.abs(rows[r]?.[col] ?? 0) > Math.abs(rows[pivot]?.[col] ?? 0)) pivot = r
    const top = rows[pivot] as number[]
    const scale = Math.max(1, ...top.slice(0, n).map(Math.abs))
    if (Math.abs(top[col] ?? 0) < 1e-12 * scale) return null
    rows[pivot] = rows[col] as number[]
    rows[col] = top
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const row = rows[r] as number[]
      const factor = (row[col] ?? 0) / (top[col] ?? 1)
      for (let k = col; k <= n; k++) row[k] = (row[k] ?? 0) - factor * (top[k] ?? 0)
    }
  }
  return rows.map((row, i) => (row[n] ?? 0) / (row[i] ?? 1))
}
