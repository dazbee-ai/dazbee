// Primitives: the rectangle (each corner with its own radius, so pills, tabs and quarter discs too) or ellipse an
// outline is, found from the outline's own points with no drawing. Each kind starts from the outline's direction,
// reach and spread, and is then moved, sized, turned and rounded while the outline's mean distance to its edge
// falls. An outline is a primitive when its points keep close to that edge all the way round. Points marked free
// (the outline there is another patch's edge over this one) aren't counted, so a shape partly under another is
// found whole.

/** A fitted primitive, in the outline's pixels and degrees clockwise. */
export interface Primitive {
  kind: 'rect' | 'ellipse'
  cx: number
  cy: number
  width: number
  height: number
  rotation: number
  /** A rectangle's corner radii from the top left clockwise; zeros for an ellipse. */
  corners: [number, number, number, number]
  /** The counted points' distance to its edge: the mean, the 95th percentile and the farthest, in pixels. */
  mean: number
  p95: number
  max: number
}

/** Parameters: cx, cy, hx, hy, turn in degrees, then a rectangle's four radii. */
type Params = Float64Array

/** A fit whose mean squared distance to the outline is under this, in pixels squared, lies on it. */
const ON_OUTLINE = 0.05
/** A start must come closer than another by more than this, in pixels squared, to be the closer one. */
const TIE = 1e-4
/** The most points of an outline a fit reads. */
const MOST_POINTS = 240
/** The most points a fit is moved over. */
const FIT_POINTS = 80
/** A point farther than this from the edge counts as this far, so one stray run doesn't pull the fit. */
const CAP = 6
/** A turn under this many degrees is level: a designer sets 0°, not 0.8°. */
const LEVEL = 1.2
/** Radii within this share of each other (and half a pixel) are one radius. */
const ONE_RADIUS = 0.12

/** The rectangle and the ellipse nearest an outline (x, y pairs), each with how close the outline keeps to it. */
export function fitPrimitives(points: Float32Array, free?: Uint8Array): Primitive[] {
  const picked = pick(points, MOST_POINTS, free)
  if (picked.length < 16) return []
  // The shapes are moved over fewer points than they are then read against.
  const few = pick(points, FIT_POINTS, free)
  return [fitRect(points, few, picked, free), fitEllipse(few, picked)].filter((fit): fit is Primitive => fit !== null)
}

/** The signed distance from a point to a primitive's edge, below 0 inside. */
export function distanceTo(p: Primitive, x: number, y: number): number {
  const turn = (-p.rotation * Math.PI) / 180
  const dx = x - p.cx
  const dy = y - p.cy
  const u = dx * Math.cos(turn) - dy * Math.sin(turn)
  const v = dx * Math.sin(turn) + dy * Math.cos(turn)
  return p.kind === 'rect'
    ? rectDistance(u, v, p.width / 2, p.height / 2, p.corners)
    : ellipseDistance(u, v, p.width / 2, p.height / 2)
}

/** The counted points of an outline, at most `most` of them evenly taken. */
function pick(points: Float32Array, most: number, free?: Uint8Array): Float32Array {
  const n = points.length / 2
  const step = Math.max(1, Math.floor(n / most))
  const out: number[] = []
  for (let k = 0; k < n; k += step) if (!free?.[k]) out.push(points[k * 2] ?? 0, points[k * 2 + 1] ?? 0)
  return Float32Array.from(out)
}

function fitRect(points: Float32Array, few: Float32Array, picked: Float32Array, free?: Uint8Array): Primitive | null {
  const direction = sideDirection(points)
  const turned = Math.abs(direction) >= LEVEL
  const start = reach(few, turned ? direction : 0)
  const q = Float64Array.from([start.cx, start.cy, start.hx, start.hy, turned ? direction : 0, 0, 0, 0, 0])
  if ((q[2] ?? 0) < 0.25 || (q[3] ?? 0) < 0.25) return null
  const keys = turned ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [0, 1, 2, 3, 5, 6, 7, 8]
  // Evenly picked points miss the corners, where a square corner and a round one differ: the outline's point
  // nearest each corner of the box is fitted and counted with them.
  const corners = cornerPoints(points, q, free)
  const pts = joined(few, corners)
  const all = joined(picked, corners)
  // Three starts, and the best of them: square corners, the roundest, and each corner as far round as the outline
  // keeps from the box's corner there (an arc of radius r passes r (√2 − 1) from it).
  const square = Float64Array.from(q)
  const round = Float64Array.from(q)
  round.fill(Math.min(q[2] ?? 0, q[3] ?? 0), 5, 9)
  const measured = Float64Array.from(q)
  const turn = (-(q[4] ?? 0) * Math.PI) / 180
  const nearest = [Infinity, Infinity, Infinity, Infinity]
  for (let k = 0; k < pts.length; k += 2) {
    const dx = (pts[k] ?? 0) - (q[0] ?? 0)
    const dy = (pts[k + 1] ?? 0) - (q[1] ?? 0)
    const u = dx * Math.cos(turn) - dy * Math.sin(turn)
    const v = dx * Math.sin(turn) + dy * Math.cos(turn)
    const corner = u < 0 ? (v < 0 ? 0 : 3) : v < 0 ? 1 : 2
    nearest[corner] = Math.min(nearest[corner] ?? 0, Math.hypot(Math.abs(u) - (q[2] ?? 0), Math.abs(v) - (q[3] ?? 0)))
  }
  for (let c = 0; c < 4; c++)
    measured[5 + c] = Math.min(
      Math.min(q[2] ?? 0, q[3] ?? 0),
      Number.isFinite(nearest[c] ?? 0) ? (nearest[c] ?? 0) / (Math.SQRT2 - 1) : 0,
    )
  // The square start is always tried, and wins a tie; the roundest is tried only where neither of the others lands
  // on the outline.
  let best = square
  let bestCost = descend('rect', square, pts, keys)
  for (const start of [measured, round]) {
    if (start === round && bestCost <= ON_OUTLINE) break
    if (start === measured && measured.every((v, i) => v === square[i])) continue
    const reached = descend('rect', start, pts, keys)
    if (reached < bestCost - TIE) {
      bestCost = reached
      best = start
    }
  }
  if (Math.abs(best[4] ?? 0) < LEVEL && best[4] !== 0) {
    best[4] = 0
    descend('rect', best, pts, [0, 1, 2, 3, 5, 6, 7, 8])
  }
  // Radii that are about one radius become one; one about half the shorter side is a pill's; a hair of one is none.
  const least = Math.min(best[2] ?? 0, best[3] ?? 0)
  const radii = [best[5] ?? 0, best[6] ?? 0, best[7] ?? 0, best[8] ?? 0]
  const mean = ((radii[0] ?? 0) + (radii[1] ?? 0) + (radii[2] ?? 0) + (radii[3] ?? 0)) / 4
  const one = Float64Array.from(best)
  if (Math.max(...radii) - Math.min(...radii) <= Math.max(0.5, ONE_RADIUS * mean)) one.fill(mean, 5, 9)
  const snapped = Float64Array.from(one)
  for (let c = 5; c <= 8; c++) {
    if ((snapped[c] ?? 0) >= least - Math.max(0.5, 0.06 * least)) snapped[c] = least
    else if ((snapped[c] ?? 0) < Math.max(0.5, 0.04 * least)) snapped[c] = 0
  }
  // Each is taken while the outline keeps about as close to it: all of it, else the one radius alone.
  const most = cost('rect', best, pts) * 1.25 + 0.02
  const kept = cost('rect', snapped, pts) <= most ? snapped : cost('rect', one, pts) <= most ? one : best
  return made('rect', kept, all)
}

function fitEllipse(pts: Float32Array, all: Float32Array): Primitive | null {
  const n = pts.length / 2
  let mx = 0
  let my = 0
  for (let k = 0; k < pts.length; k += 2) {
    mx += pts[k] ?? 0
    my += pts[k + 1] ?? 0
  }
  mx /= n
  my /= n
  let xx = 0
  let yy = 0
  let xy = 0
  for (let k = 0; k < pts.length; k += 2) {
    const dx = (pts[k] ?? 0) - mx
    const dy = (pts[k + 1] ?? 0) - my
    xx += dx * dx
    yy += dy * dy
    xy += dx * dy
  }
  const direction = (0.5 * Math.atan2(2 * xy, xx - yy) * 180) / Math.PI
  const round = Math.abs(xx - yy) + Math.abs(xy) * 2 < 0.06 * (xx + yy)
  const turned = !round && Math.abs(direction) >= LEVEL && Math.abs(Math.abs(direction) - 90) >= LEVEL
  const start = reach(pts, turned ? direction : 0)
  const q = Float64Array.from([start.cx, start.cy, start.hx, start.hy, turned ? direction : 0, 0, 0, 0, 0])
  if ((q[2] ?? 0) < 0.25 || (q[3] ?? 0) < 0.25) return null
  descend('ellipse', q, pts, turned ? [0, 1, 2, 3, 4] : [0, 1, 2, 3])
  const snapped = Float64Array.from(q)
  if (Math.abs((q[2] ?? 0) - (q[3] ?? 0)) <= Math.max(0.5, 0.015 * Math.max(q[2] ?? 0, q[3] ?? 0))) {
    snapped[2] = snapped[3] = ((q[2] ?? 0) + (q[3] ?? 0)) / 2
    snapped[4] = 0
  }
  return made('ellipse', cost('ellipse', snapped, pts) <= cost('ellipse', q, pts) * 1.25 + 0.02 ? snapped : q, all)
}

/** The outline's counted point nearest each corner of a box (parameters as a fit's), as x, y pairs. */
function cornerPoints(points: Float32Array, q: Params, free?: Uint8Array): Float32Array {
  const turn = (-(q[4] ?? 0) * Math.PI) / 180
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  const out = new Float32Array(8)
  for (let c = 0; c < 4; c++) {
    const u = (c === 0 || c === 3 ? -1 : 1) * (q[2] ?? 0)
    const v = (c < 2 ? -1 : 1) * (q[3] ?? 0)
    const x = (q[0] ?? 0) + u * cos + v * sin
    const y = (q[1] ?? 0) - u * sin + v * cos
    let nearest = Infinity
    for (let k = 0; k < points.length; k += 2) {
      if (free?.[k / 2]) continue
      const d = ((points[k] ?? 0) - x) ** 2 + ((points[k + 1] ?? 0) - y) ** 2
      if (d >= nearest) continue
      nearest = d
      out[c * 2] = points[k] ?? 0
      out[c * 2 + 1] = points[k + 1] ?? 0
    }
  }
  return out
}

/** Two lists of points as one. */
function joined(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

function rectDistance(u: number, v: number, hx: number, hy: number, corners: readonly number[]): number {
  const r = corners[u < 0 ? (v < 0 ? 0 : 3) : v < 0 ? 1 : 2] ?? 0
  const qx = Math.abs(u) - hx + r
  const qy = Math.abs(v) - hy + r
  return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r
}

/** A first-order distance to an ellipse's edge: exact on the edge, close near it. */
function ellipseDistance(u: number, v: number, a: number, b: number): number {
  const k = Math.hypot(u / a, v / b)
  if (k < 1e-6) return -Math.min(a, b)
  const slope = Math.hypot(u / (a * a), v / (b * b)) / k
  return (k - 1) / slope
}

/** The direction most of an outline runs in, in degrees within 45 of level: its sides', when it has straight sides. */
function sideDirection(points: Float32Array): number {
  const n = points.length / 2
  const span = Math.max(2, Math.round(n / 60))
  const bins = new Float64Array(90)
  for (let k = 0; k < n; k++) {
    const m = (k + span) % n
    const dx = (points[m * 2] ?? 0) - (points[k * 2] ?? 0)
    const dy = (points[m * 2 + 1] ?? 0) - (points[k * 2 + 1] ?? 0)
    const length = Math.hypot(dx, dy)
    if (length < 1e-6) continue
    const degrees = ((((Math.atan2(dy, dx) * 180) / Math.PI) % 90) + 90) % 90
    const bin = Math.floor(degrees) % 90
    bins[bin] = (bins[bin] ?? 0) + length
  }
  let peak = 0
  for (let b = 1; b < 90; b++) if ((bins[b] ?? 0) > (bins[peak] ?? 0)) peak = b
  // The weighted mean direction around the peak.
  let sum = 0
  let weight = 0
  for (let d = -3; d <= 3; d++) {
    const w = bins[(peak + d + 90) % 90] ?? 0
    sum += w * (peak + d + 0.5)
    weight += w
  }
  const degrees = weight > 0 ? sum / weight : 0
  return degrees > 45 ? degrees - 90 : degrees
}

/** The reach of points along and across a turn (degrees clockwise): the centre and half sizes of their box there. */
function reach(pts: Float32Array, degrees: number) {
  const turn = (-degrees * Math.PI) / 180
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  let u0 = Infinity
  let u1 = -Infinity
  let v0 = Infinity
  let v1 = -Infinity
  for (let k = 0; k < pts.length; k += 2) {
    const u = (pts[k] ?? 0) * cos - (pts[k + 1] ?? 0) * sin
    const v = (pts[k] ?? 0) * sin + (pts[k + 1] ?? 0) * cos
    if (u < u0) u0 = u
    if (u > u1) u1 = u
    if (v < v0) v0 = v
    if (v > v1) v1 = v
  }
  const uc = (u0 + u1) / 2
  const vc = (v0 + v1) / 2
  // Back from the turned axes to the picture's.
  return { cx: uc * cos + vc * sin, cy: -uc * sin + vc * cos, hx: (u1 - u0) / 2, hy: (v1 - v0) / 2 }
}

/** Moves each parameter by shrinking steps while the cost falls. */
function descend(kind: Primitive['kind'], q: Params, pts: Float32Array, keys: readonly number[]): number {
  let best = cost(kind, q, pts)
  for (let step = 2; step > 0.02; step /= 2) {
    for (let again = 0; again < 6; again++) {
      let improved = false
      for (const key of keys)
        for (const direction of [1, -1]) {
          const before = Float64Array.from(q)
          q[key] = (before[key] ?? 0) + direction * (key === 4 ? step * 0.5 : step)
          const least = Math.min(q[2] ?? 0, q[3] ?? 0)
          if ((q[2] ?? 0) < 0.25 || (q[3] ?? 0) < 0.25 || (key >= 5 && ((q[key] ?? 0) < 0 || (q[key] ?? 0) > least))) {
            q.set(before)
            continue
          }
          // A side that shrinks takes its corners' radii with it.
          for (let c = 5; c <= 8; c++) if ((q[c] ?? 0) > least) q[c] = least
          const tried = cost(kind, q, pts)
          if (tried < best - 1e-9) {
            best = tried
            improved = true
            break
          }
          q.set(before)
        }
      if (!improved) break
    }
  }
  return best
}

function cost(kind: Primitive['kind'], q: Params, pts: Float32Array): number {
  const turn = (-(q[4] ?? 0) * Math.PI) / 180
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  const corners = [q[5] ?? 0, q[6] ?? 0, q[7] ?? 0, q[8] ?? 0]
  let total = 0
  for (let k = 0; k < pts.length; k += 2) {
    const dx = (pts[k] ?? 0) - (q[0] ?? 0)
    const dy = (pts[k + 1] ?? 0) - (q[1] ?? 0)
    const u = dx * cos - dy * sin
    const v = dx * sin + dy * cos
    const d =
      kind === 'rect' ? rectDistance(u, v, q[2] ?? 0, q[3] ?? 0, corners) : ellipseDistance(u, v, q[2] ?? 0, q[3] ?? 0)
    total += Math.min(d * d, CAP * CAP)
  }
  return total / (pts.length / 2)
}

function made(kind: Primitive['kind'], q: Params, pts: Float32Array): Primitive {
  return {
    kind,
    cx: q[0] ?? 0,
    cy: q[1] ?? 0,
    width: (q[2] ?? 0) * 2,
    height: (q[3] ?? 0) * 2,
    rotation: q[4] ?? 0,
    corners: kind === 'rect' ? [q[5] ?? 0, q[6] ?? 0, q[7] ?? 0, q[8] ?? 0] : [0, 0, 0, 0],
    ...stats(kind, q, pts),
  }
}

function stats(kind: Primitive['kind'], q: Params, pts: Float32Array): { mean: number; p95: number; max: number } {
  const turn = (-(q[4] ?? 0) * Math.PI) / 180
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  const corners = [q[5] ?? 0, q[6] ?? 0, q[7] ?? 0, q[8] ?? 0]
  const all = new Float32Array(pts.length / 2)
  let total = 0
  for (let k = 0; k < pts.length; k += 2) {
    const dx = (pts[k] ?? 0) - (q[0] ?? 0)
    const dy = (pts[k + 1] ?? 0) - (q[1] ?? 0)
    const u = dx * cos - dy * sin
    const v = dx * sin + dy * cos
    const d = Math.abs(
      kind === 'rect' ? rectDistance(u, v, q[2] ?? 0, q[3] ?? 0, corners) : ellipseDistance(u, v, q[2] ?? 0, q[3] ?? 0),
    )
    all[k / 2] = d
    total += d
  }
  all.sort()
  return {
    mean: total / all.length,
    p95: all[Math.min(all.length - 1, Math.floor(all.length * 0.95))] ?? 0,
    max: all[all.length - 1] ?? 0,
  }
}
