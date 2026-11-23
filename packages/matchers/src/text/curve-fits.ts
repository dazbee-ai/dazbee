// Fitting a text's letters by least squares, in closed form: a straight line, a circle, circles about
// one centre (a ring a line), a sine, and curves of one shape a line apart (a line, or a wave, a line),
// each trimmed of the points far off it, for the curve check and the curve fit.

import { median } from './ink.ts'

/** A point, across and down. */
export type Point = readonly [number, number]

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

/**
 * Curves of one shape a line apart: line k is `offsets[k]` plus the shape's terms times `weights`, top
 * line first, and the line of each point they were fitted through.
 */
export interface Bands {
  weights: number[]
  offsets: number[]
  lines: number[]
}

/** A fit of points and how close it is. */
export interface PointFit<M> {
  model: M
  /** The root mean square of the points' distances off it, over the points kept. */
  rms: number
}

/** A trim keeps at least this many points. */
const LEAST_KEPT = 4

/** Rings are found and fitted again this many times. */
const RING_ROUNDS = 3

/** A fit is trimmed this many times of the points more than `TRIM_AT` times their median distance off it. */
const TRIM_ROUNDS = 3

const TRIM_AT = 2.5

/** The least median distance, in pixels, a trim is measured against. */
const TRIM_FLOOR = 0.7

/** A wave is tried at wavelengths from this many letter heights up to the span over `MIN_PERIODS`. */
const SHORTEST_WAVE = 4

const MIN_PERIODS = 0.75

/** How many wavelengths are tried, spaced evenly in their logarithm. */
const WAVE_STEPS = 24

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
 * arc or a circle, by least squares (Kåsa's, with an F for each ring). Each point's ring starts as
 * `start` gives, or parted at the widest gaps in the points' distances from the circle through all
 * of them, then each point goes to its nearest ring and they are fitted again, `RING_ROUNDS` times;
 * with `fixed`, the rings are fitted once as `start` gives them. The rings come nearest the centre
 * first. Null when they can't be fitted.
 */
export function fitRings(
  points: readonly Point[],
  count: number,
  { start, fixed = false }: { start?: readonly number[]; fixed?: boolean } = {},
): Rings | null {
  const first = fitCircle(points)
  if (!first) return null
  const distance = ([x, y]: Point, centre: { cx: number; cy: number }) => Math.hypot(x - centre.cx, y - centre.cy)
  let of =
    start ??
    partedAtGaps(
      points.map((p) => distance(p, first)),
      count,
    )
  let found: Rings | null = null
  for (let round = 0; round < (fixed ? 1 : RING_ROUNDS); round++) {
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
    if (!solved) break
    const [d = 0, e = 0, ...f] = solved
    const cx = -d / 2
    const cy = -e / 2
    const radii = f.map((fk) => Math.sqrt(Math.max(0, cx * cx + cy * cy - fk)))
    found = { cx: cx + first.cx, cy: cy + first.cy, radii, rings: [...of] }
    const centre = found
    of = points.map((p) => nearest(radii, distance(p, centre)))
  }
  return found && byRadius(found)
}

/**
 * The rings about one centre that fit points standing in `count` lines closest: started from the
 * widest gaps in their distances from one circle, and from the straight lines a line apart that fit
 * them, the closer by the trimmed root mean square of the points' distances off their rings.
 */
export function lineRings(points: readonly Point[], count: number): { rings: Rings; rms: number } | null {
  const straight = fitBands(points, count, (x) => [x])
  const tried = [fitRings(points, count), straight ? fitRings(points, count, { start: straight.lines }) : null]
  let best: { rings: Rings; rms: number } | null = null
  for (const rings of tried) {
    if (!rings) continue
    const rms = trimmedRms(points.map((p, i) => ringDistance(rings, p, rings.rings[i] ?? 0)))
    if (!best || rms < best.rms) best = { rings, rms }
  }
  return best
}

/** How far a point is off its ring, outwards. */
export function ringDistance(rings: Rings, [x, y]: Point, ring: number): number {
  return Math.hypot(x - rings.cx, y - rings.cy) - (rings.radii[ring] ?? rings.radii[0] ?? 0)
}

/**
 * Curves of one shape a line apart through points standing in `count` lines, as a text's lines
 * follow one straight line or one wave moved down: `y = offsets[k] + Σ weights·shape(x)` for line k,
 * by least squares with an offset a line, each point's line given by `lines` or found from its
 * distance below one curve through all of them, the lines parted at the widest gaps; null when they
 * can't be fitted.
 */
export function fitBands(
  points: readonly Point[],
  count: number,
  shape: (x: number) => number[],
  lines?: readonly number[],
): Bands | null {
  const one = leastSquares(
    points,
    ([x]) => [1, ...shape(x)],
    ([, y]) => y,
  )
  if (!one) return null
  let found: Bands = { weights: one.slice(1), offsets: [one[0] ?? 0], lines: points.map(() => 0) }
  if (count <= 1 && !lines) return found
  for (let round = 0; round < (lines ? 1 : RING_ROUNDS); round++) {
    const along = (x: number) => shape(x).reduce((sum, v, i) => sum + v * (found.weights[i] ?? 0), 0)
    const of =
      lines ??
      partedAtGaps(
        points.map(([x, y]) => y - along(x)),
        count,
      )
    const used = Math.max(...of) + 1
    const solved = leastSquares(
      points.map((point, i) => ({ point, line: of[i] ?? 0 })),
      ({ point: [x], line }) => [...shape(x), ...Array.from({ length: used }, (_, k) => (k === line ? 1 : 0))],
      ({ point: [, y] }) => y,
    )
    if (!solved) return lines ? null : found
    const n = shape(0).length
    found = { weights: solved.slice(0, n), offsets: solved.slice(n), lines: [...of] }
  }
  return found
}

/** How far a point is below its own line of bands. */
export function bandDistance(bands: Bands, shape: (x: number) => number[], [x, y]: Point, line: number): number {
  const along = shape(x).reduce((sum, v, i) => sum + v * (bands.weights[i] ?? 0), 0)
  return y - along - (bands.offsets[line] ?? 0)
}

/**
 * The root mean square of distances, those more than `TRIM_AT` times their median (and
 * `TRIM_FLOOR`) left out, as a trimmed fit leaves out a descender.
 */
export function trimmedRms(distances: readonly number[]): number {
  const off = distances.map(Math.abs)
  const limit = TRIM_AT * Math.max(TRIM_FLOOR, median(off))
  const kept = off.filter((d) => d <= limit)
  return kept.length > 0 ? Math.sqrt(kept.reduce((sum, d) => sum + d * d, 0) / kept.length) : Infinity
}

/**
 * One wave moved down a line at a time through points standing in `count` lines: tried at each of
 * `waveLengths`, the closest by the trimmed root mean square of the points' distances below their
 * own line's curve, given as its top line's sine, each line's offset, top first, and each point's
 * line; with `lines` and `wavelength`, fitted once with those. Null when it can't be fitted.
 */
export function waveBands(
  points: readonly Point[],
  count: number,
  letterHeight: number,
  given?: { lines: readonly number[]; wavelength: number },
): { sine: Sine; offsets: number[]; lines: number[]; rms: number } | null {
  let best: { sine: Sine; offsets: number[]; lines: number[]; rms: number } | null = null
  for (const wavelength of given ? [given.wavelength] : waveLengths(points, letterHeight)) {
    const k = (2 * Math.PI) / wavelength
    const shape = (x: number) => [x, Math.sin(k * x), Math.cos(k * x)]
    const bands = fitBands(points, count, shape, given?.lines)
    if (!bands) continue
    const rms = trimmedRms(points.map((p, i) => bandDistance(bands, shape, p, bands.lines[i] ?? 0)))
    const [slope = 0, p = 0, q = 0] = bands.weights
    if (!best || rms < best.rms)
      best = {
        sine: { c: bands.offsets[0] ?? 0, slope, p, q, wavelength },
        offsets: bands.offsets,
        lines: bands.lines,
        rms,
      }
  }
  return best
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

/** A sine's height at `x`. */
export function sineAt(sine: Sine, x: number): number {
  const k = (2 * Math.PI) / sine.wavelength
  return sine.c + sine.slope * x + sine.p * Math.sin(k * x) + sine.q * Math.cos(k * x)
}

/** A sine's slope at `x`. */
export function sineSlope(sine: Sine, x: number): number {
  const k = (2 * Math.PI) / sine.wavelength
  return sine.slope + k * (sine.p * Math.cos(k * x) - sine.q * Math.sin(k * x))
}

/** How far a point is off a sine, down. */
export function sineDistance(sine: Sine, [x, y]: Point): number {
  return y - sineAt(sine, x)
}

/** How far a point is off a circle, outwards. */
export function circleDistance(circle: Circle, [x, y]: Point): number {
  return Math.hypot(x - circle.cx, y - circle.cy) - circle.radius
}

/**
 * The sine that fits points closest, its wavelength tried from `SHORTEST_WAVE` letter heights to the
 * points' span over `MIN_PERIODS`; null when the span is too short for a wave.
 */
export function bestSine(points: readonly Point[], letterHeight: number): PointFit<Sine> | null {
  let best: PointFit<Sine> | null = null
  for (const wavelength of waveLengths(points, letterHeight)) {
    const fit = trimmedFit(points, (kept) => fitSine(kept, wavelength), sineDistance)
    if (fit && (!best || fit.rms < best.rms)) best = fit
  }
  return best
}

/**
 * The wavelengths a wave through points is tried at: `WAVE_STEPS` from `SHORTEST_WAVE` letter heights
 * to the points' span over `MIN_PERIODS`, spaced evenly in their logarithm; none when the span is too
 * short for a wave.
 */
export function waveLengths(points: readonly Point[], letterHeight: number): number[] {
  const xs = points.map(([x]) => x)
  const span = Math.max(...xs) - Math.min(...xs)
  const shortest = SHORTEST_WAVE * letterHeight
  const longest = span / MIN_PERIODS
  if (!(longest > shortest)) return []
  return Array.from({ length: WAVE_STEPS }, (_, i) => shortest * (longest / shortest) ** (i / (WAVE_STEPS - 1)))
}

/**
 * A model fitted to points, then fitted again to the points within `TRIM_AT` times their median
 * distance off it, `TRIM_ROUNDS` times; null when it can't be fitted.
 */
export function trimmedFit<M>(
  points: readonly Point[],
  fit: (points: readonly Point[]) => M | null,
  distance: (model: M, point: Point) => number,
): PointFit<M> | null {
  let model = fit(points)
  let kept = points
  for (let round = 0; round < TRIM_ROUNDS && model; round++) {
    const off = points.map((p) => Math.abs(distance(model as M, p)))
    const limit = TRIM_AT * Math.max(TRIM_FLOOR, median(off))
    const within = points.filter((_, i) => (off[i] ?? 0) <= limit)
    if (within.length < LEAST_KEPT || within.length === kept.length) break
    kept = within
    model = fit(kept)
  }
  if (!model) return null
  const squares = kept.map((p) => distance(model as M, p) ** 2)
  return { model, rms: Math.sqrt(squares.reduce((a, b) => a + b, 0) / squares.length) }
}

/** The straight line `y = c + slope·x` through points by least squares; null when they stand in one column. */
export function fitLine(points: readonly Point[]): { c: number; slope: number } | null {
  const solved = leastSquares(
    points,
    ([x]) => [1, x],
    ([, y]) => y,
  )
  return solved ? { c: solved[0] ?? 0, slope: solved[1] ?? 0 } : null
}

/** How far a point is off a line, down. */
export function lineDistance(line: { c: number; slope: number }, [x, y]: Point): number {
  return y - (line.c + line.slope * x)
}

/**
 * How far round the circle's centre the points reach, as angles clockwise from up (`sin`, `−cos`),
 * measured from the direction of their mean so the reach never wraps.
 */
export function reachRound(circle: Circle, points: readonly Point[]): { from: number; to: number } {
  let sx = 0
  let sy = 0
  for (const [x, y] of points) {
    const d = Math.hypot(x - circle.cx, y - circle.cy) || 1
    sx += (x - circle.cx) / d
    sy += (y - circle.cy) / d
  }
  const mean = Math.atan2(sx, -sy)
  let from = Infinity
  let to = -Infinity
  for (const [x, y] of points) {
    const angle = Math.atan2(x - circle.cx, -(y - circle.cy))
    const off = Math.atan2(Math.sin(angle - mean), Math.cos(angle - mean))
    from = Math.min(from, off)
    to = Math.max(to, off)
  }
  return { from: mean + from, to: mean + to }
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

/**
 * Which of `count` groups each value falls in, lowest first: the values parted at their widest gaps.
 */
function partedAtGaps(values: readonly number[], count: number): number[] {
  const sorted = [...values].sort((a, b) => a - b)
  const cuts = sorted
    .slice(1)
    .map((v, i) => ({ at: (v + (sorted[i] ?? v)) / 2, gap: v - (sorted[i] ?? v) }))
    .sort((a, b) => b.gap - a.gap)
    .slice(0, Math.max(0, count - 1))
    .map((cut) => cut.at)
  return values.map((v) => cuts.filter((at) => at < v).length)
}

/** The index of the value nearest `to`, the first on a tie. */
function nearest(values: readonly number[], to: number): number {
  let best = 0
  for (let i = 1; i < values.length; i++)
    if (Math.abs((values[i] ?? 0) - to) < Math.abs((values[best] ?? 0) - to)) best = i
  return best
}

/** Rings numbered nearest the centre first. */
function byRadius(rings: Rings): Rings {
  const order = rings.radii.map((radius, ring) => ({ radius, ring })).sort((a, b) => a.radius - b.radius)
  const renumber = new Map(order.map(({ ring }, i) => [ring, i]))
  return {
    ...rings,
    radii: order.map(({ radius }) => radius),
    rings: rings.rings.map((ring) => renumber.get(ring) ?? ring),
  }
}
