// Fitting several lines of letters at once, by least squares in closed form: circles about one centre, a
// ring a line, as a curved text's lines stand on an arc or a circle; and curves of one shape a line
// apart, as its lines follow one straight line or one wave moved down a line at a time.

import { fitCircle, leastSquares, partedAtGaps, type Point, type Sine, trimmedRms, waveLengths } from './curve-fits.ts'

/** Circles about one centre, a radius each, and the ring of each point they were fitted through. */
export interface Rings {
  cx: number
  cy: number
  radii: number[]
  rings: number[]
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

/** Rings are found and fitted again this many times. */
const RING_ROUNDS = 3

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

/** How far a point is off its ring, outwards. */
function ringDistance(rings: Rings, [x, y]: Point, ring: number): number {
  return Math.hypot(x - rings.cx, y - rings.cy) - (rings.radii[ring] ?? rings.radii[0] ?? 0)
}
