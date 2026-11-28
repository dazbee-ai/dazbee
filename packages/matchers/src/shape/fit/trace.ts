// Tracing: closed outlines as one path of cubic Béziers, holes included (evenodd). The outlines it
// is given are smoothed once; corners are where an outline turns sharply; between corners, cubic
// Béziers are fitted by least squares on chord-length parameters, re-parameterised by Newton steps,
// and split at the worst point until they keep within a tolerance.

/** A point: x, y. */
export type Point = [number, number]

/** A traced path: its data in its own box, and the box in the piece's pixels. */
export interface Traced {
  d: string
  box: { x: number; y: number; width: number; height: number }
}

/** A straight line or a cubic Bézier, by its points. */
type Curve = [Point, Point] | [Point, Point, Point, Point]
type Bezier = [Point, Point, Point, Point]

/** An outline turning by more than this, in radians, over a few points each side has a corner. */
const CORNER_TURN = (55 * Math.PI) / 180
/** A run straying from its chord by no more than this share of the tolerance is a line. */
const STRAIGHT_SHARE = 0.6
/** Newton steps tried before a curve is split, while its error is under this many tolerances. */
const NEWTON_STEPS = 4
const NEWTON_WITHIN = 6
/** How deep a run may be split. */
const DEEPEST = 10

/** Closed outlines, in piece pixels, as one evenodd path within `tolerance` of them once smoothed; null when there are none. */
export function tracedLoops(loops: readonly (readonly Point[])[], tolerance: number): Traced | null {
  if (loops.length === 0) return null
  const scaled = loops.map((loop) => smoothed(loop))
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const loop of scaled)
    for (const [x, y] of loop) {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  const text = (v: number) => (Math.round(v * 100) / 100).toString()
  const at = (p: Point) => `${text(p[0] - x0)} ${text(p[1] - y0)}`
  const parts: string[] = []
  for (const loop of scaled) {
    const curves = fitLoop(loop, tolerance)
    const first = curves[0]
    if (!first) continue
    parts.push(`M${at(first[0])}`)
    for (const curve of curves)
      parts.push(curve.length === 2 ? `L${at(curve[1])}` : `C${at(curve[1])} ${at(curve[2])} ${at(curve[3])}`)
    parts.push('Z')
  }
  return { d: parts.join(''), box: { x: x0, y: y0, width: Math.max(0.01, x1 - x0), height: Math.max(0.01, y1 - y0) } }
}

/** One pass of [1 2 1] smoothing, which steadies AI-wobbled edges without moving corners far. */
function smoothed(loop: readonly Point[]): Point[] {
  const n = loop.length
  return loop.map((p, i) => {
    const a = loop[(i + n - 1) % n] ?? p
    const b = loop[(i + 1) % n] ?? p
    return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4]
  })
}

/** An outline's curves: split at its corners and each run fitted, or four runs with smooth joins when it has none. */
function fitLoop(loop: readonly Point[], tolerance: number): Curve[] {
  const n = loop.length
  const corners = cornersOf(loop)
  const curves: Curve[] = []
  if (corners.length === 0) {
    const quarters = [0, n >> 2, n >> 1, (3 * n) >> 2]
    for (let k = 0; k < 4; k++) {
      const a = quarters[k] ?? 0
      const b = quarters[(k + 1) % 4] || n
      curves.push(...fitRun(runOf(loop, a, b), tangentAt(loop, a), negated(tangentAt(loop, b % n)), tolerance))
    }
    return curves
  }
  for (let k = 0; k < corners.length; k++) {
    const a = corners[k] ?? 0
    const b = corners[(k + 1) % corners.length] ?? 0
    const run = runOf(loop, a, b === a ? a + n : b)
    if (run.length < 2) continue
    const start = run[0] ?? [0, 0]
    const end = run[run.length - 1] ?? [0, 0]
    const t1 = unit(minus(run[Math.min(run.length - 1, 2)] ?? end, start))
    const t2 = unit(minus(run[Math.max(0, run.length - 3)] ?? start, end))
    curves.push(...fitRun(run, t1, t2, tolerance))
  }
  return curves
}

/** The points where an outline turns by more than 55° over a few points each side, the sharpest in each run. */
function cornersOf(loop: readonly Point[]): number[] {
  const n = loop.length
  const k = Math.max(2, Math.min(4, Math.floor(n / 12)))
  const turn = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const p = loop[i] ?? [0, 0]
    const a = unit(minus(p, loop[(i - k + n) % n] ?? p))
    const b = unit(minus(loop[(i + k) % n] ?? p, p))
    turn[i] = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])))
  }
  const corners: number[] = []
  for (let i = 0; i < n; i++) {
    const t = turn[i] ?? 0
    if (t < CORNER_TURN) continue
    let peak = true
    for (let d = 1; d <= k; d++) if ((turn[(i + d) % n] ?? 0) > t || (turn[(i - d + n) % n] ?? 0) >= t) peak = false
    if (peak) corners.push(i)
  }
  return corners
}

/** Least-squares cubic Béziers through a run between two end tangents, split until within the tolerance. */
function fitRun(points: readonly Point[], t1: Point, t2: Point, tolerance: number, depth = 0): Curve[] {
  const first = points[0] ?? [0, 0]
  const last = points[points.length - 1] ?? first
  if (points.length <= 2) return [[first, last]]
  const chord = minus(last, first)
  const length = Math.hypot(chord[0], chord[1])
  if (length > 0) {
    const normal: Point = [-chord[1] / length, chord[0] / length]
    let stray = 0
    for (const p of points) stray = Math.max(stray, Math.abs(dot(minus(p, first), normal)))
    if (stray <= tolerance * STRAIGHT_SHARE) return [[first, last]]
  }
  let u = chordParameters(points)
  let bezier = solve(points, u, t1, t2)
  let worst = worstError(points, bezier, u)
  if (worst.error <= tolerance) return [bezier]
  for (let step = 0; step < NEWTON_STEPS && worst.error < tolerance * NEWTON_WITHIN; step++) {
    const current = bezier
    u = u.map((t, i) => newtonStep(current, points[i] ?? first, t))
    bezier = solve(points, u, t1, t2)
    worst = worstError(points, bezier, u)
    if (worst.error <= tolerance) return [bezier]
  }
  if (depth > DEEPEST || points.length < 4) return [bezier]
  const split = Math.max(1, Math.min(points.length - 2, worst.at))
  const tangent = unit(minus(points[split - 1] ?? first, points[split + 1] ?? last))
  return [
    ...fitRun(points.slice(0, split + 1), t1, tangent, tolerance, depth + 1),
    ...fitRun(points.slice(split), negated(tangent), t2, tolerance, depth + 1),
  ]
}

/** The points from index a round to index b, both included. */
function runOf(loop: readonly Point[], a: number, b: number): Point[] {
  const n = loop.length
  const end = b > a ? b : b + n
  const run: Point[] = []
  for (let i = a; i <= end; i++) run.push(loop[i % n] ?? [0, 0])
  return run
}

/** The outline's unit tangent at a point, from the points two either side. */
function tangentAt(loop: readonly Point[], i: number): Point {
  const n = loop.length
  return unit(minus(loop[(i + 2) % n] ?? [0, 0], loop[(i - 2 + n) % n] ?? [0, 0]))
}

function negated(a: Point): Point {
  return [-a[0], -a[1]]
}

/** A vector of length 1 the same way, or itself when it has no length. */
function unit(a: Point): Point {
  const length = Math.hypot(a[0], a[1]) || 1
  return [a[0] / length, a[1] / length]
}

function minus(a: Point, b: Point): Point {
  return [a[0] - b[0], a[1] - b[1]]
}

function dot(a: Point, b: Point): number {
  return a[0] * b[0] + a[1] * b[1]
}

/** Each point's share of the way along the run, by chord length. */
function chordParameters(points: readonly Point[]): number[] {
  const u = [0]
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] ?? [0, 0]
    const b = points[i] ?? a
    u.push((u[i - 1] ?? 0) + Math.hypot(b[0] - a[0], b[1] - a[1]))
  }
  const total = u[u.length - 1] || 1
  return u.map((v) => v / total)
}

/** The Bézier through the run's ends whose inner control points lie along the end tangents at least-squares distances. */
function solve(points: readonly Point[], u: readonly number[], t1: Point, t2: Point): Bezier {
  const p0 = points[0] ?? [0, 0]
  const p3 = points[points.length - 1] ?? p0
  let c00 = 0
  let c01 = 0
  let c11 = 0
  let x0 = 0
  let x1 = 0
  for (let i = 0; i < points.length; i++) {
    const [b0, b1, b2, b3] = bernstein(u[i] ?? 0)
    const a1 = scaled(t1, b1)
    const a2 = scaled(t2, b2)
    c00 += dot(a1, a1)
    c01 += dot(a1, a2)
    c11 += dot(a2, a2)
    const rest = minus(points[i] ?? p0, plus(scaled(p0, b0 + b1), scaled(p3, b2 + b3)))
    x0 += dot(a1, rest)
    x1 += dot(a2, rest)
  }
  const det = c00 * c11 - c01 * c01
  const segment = Math.hypot(p3[0] - p0[0], p3[1] - p0[1])
  let alpha1 = det !== 0 ? (x0 * c11 - x1 * c01) / det : 0
  let alpha2 = det !== 0 ? (c00 * x1 - c01 * x0) / det : 0
  const epsilon = 1e-6 * segment
  if (alpha1 < epsilon || alpha2 < epsilon || alpha1 > segment * 2 || alpha2 > segment * 2) {
    alpha1 = segment / 3
    alpha2 = segment / 3
  }
  return [p0, plus(p0, scaled(t1, alpha1)), plus(p3, scaled(t2, alpha2)), p3]
}

/** The cubic Bernstein weights at t. */
function bernstein(t: number): [number, number, number, number] {
  const m = 1 - t
  return [m * m * m, 3 * m * m * t, 3 * m * t * t, t * t * t]
}

function scaled(a: Point, s: number): Point {
  return [a[0] * s, a[1] * s]
}

function plus(a: Point, b: Point): Point {
  return [a[0] + b[0], a[1] + b[1]]
}

/** The farthest inner point from the Bézier at its parameter, and which point it is. */
function worstError(points: readonly Point[], b: Bezier, u: readonly number[]) {
  let error = 0
  let at = points.length >> 1
  for (let i = 1; i < points.length - 1; i++) {
    const q = pointAt(b, u[i] ?? 0)
    const p = points[i] ?? q
    const d = Math.hypot(q[0] - p[0], q[1] - p[1])
    if (d > error) {
      error = d
      at = i
    }
  }
  return { error, at }
}

/** The Bézier's point at t. */
function pointAt(b: Bezier, t: number): Point {
  const [b0, b1, b2, b3] = bernstein(t)
  return [
    b[0][0] * b0 + b[1][0] * b1 + b[2][0] * b2 + b[3][0] * b3,
    b[0][1] * b0 + b[1][1] * b1 + b[2][1] * b2 + b[3][1] * b3,
  ]
}

/** One Newton step on t towards the Bézier's point nearest p. */
function newtonStep(b: Bezier, p: Point, t: number): number {
  const q = pointAt(b, t)
  const d1 = [scaled(minus(b[1], b[0]), 3), scaled(minus(b[2], b[1]), 3), scaled(minus(b[3], b[2]), 3)] as const
  const d2 = [scaled(minus(d1[1], d1[0]), 2), scaled(minus(d1[2], d1[1]), 2)] as const
  const m = 1 - t
  const q1 = plus(plus(scaled(d1[0], m * m), scaled(d1[1], 2 * m * t)), scaled(d1[2], t * t))
  const q2 = plus(scaled(d2[0], m), scaled(d2[1], t))
  const diff = minus(q, p)
  const numerator = dot(diff, q1)
  const denominator = dot(q1, q1) + dot(diff, q2)
  if (Math.abs(denominator) < 1e-12) return t
  return Math.max(0, Math.min(1, t - numerator / denominator))
}
