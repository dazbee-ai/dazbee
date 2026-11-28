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

/** The most points of an outline a fit reads. */
/** A fit whose mean squared distance to the outline is under this, in pixels squared, lies on it. */
const ON_OUTLINE = 0.05
const MOST_POINTS = 240
/** The most points a fit is moved over. */
const FIT_POINTS = 80
/** A point farther than this from the edge counts as this far, so one stray run doesn't pull the fit. */
const CAP = 6
/** A turn under this many degrees is level: a designer sets 0°, not 0.8°. */
const LEVEL = 1.2
/** An outline repeats round its centre when its reach changes by this share of its mean at one count, and this share of all its change is at that count and its multiples. */
const REPEATS_BY = 0.012
const REPEATED_SHARE = 0.85
/** Radii within this share of each other (and half a pixel) are one radius. */
const ONE_RADIUS = 0.12

/** The rectangle and the ellipse nearest an outline (x, y pairs), each with how close the outline keeps to it. */
export function fitPrimitives(points: Float32Array, free?: Uint8Array): Primitive[] {
  const picked = pick(points, MOST_POINTS, free)
  if (picked.length < 16) return []
  // The shapes are moved over fewer points than they are then read against.
  const few = pick(points, FIT_POINTS, free)
  return [fitRect(points, few, picked), fitEllipse(few, picked)].filter((fit): fit is Primitive => fit !== null)
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

/**
 * Whether an outline repeats itself round its centre, as a regular polygon's or a star's does: how far it reaches
 * from the mean of its points at each angle changes almost only at one count of turns and that count's multiples.
 */
export function repeatsRound(points: Float32Array): boolean {
  const n = points.length / 2
  let cx = 0
  let cy = 0
  for (let k = 0; k < points.length; k += 2) {
    cx += points[k]!
    cy += points[k + 1]!
  }
  cx /= n
  cy /= n
  const bins = 256
  const reach = new Float32Array(bins)
  for (let k = 0; k < points.length; k += 2) {
    const dx = points[k]! - cx
    const dy = points[k + 1]! - cy
    const bin = Math.floor(((Math.atan2(dy, dx) + Math.PI) / (2 * Math.PI)) * bins) % bins
    reach[bin] = Math.max(reach[bin]!, Math.hypot(dx, dy))
  }
  // An angle the outline has no point at reaches as far as the one before it.
  for (let pass = 0; pass < 2; pass++)
    for (let i = 0; i < bins; i++) if (reach[i] === 0) reach[i] = reach[(i + bins - 1) % bins]!
  let mean = 0
  for (let i = 0; i < bins; i++) mean += reach[i]!
  mean /= bins
  const power = new Float64Array(65)
  let total = 0
  for (let k = 1; k <= 64; k++) {
    let re = 0
    let im = 0
    for (let i = 0; i < bins; i++) {
      const a = (2 * Math.PI * k * i) / bins
      re += (reach[i]! - mean) * Math.cos(a)
      im += (reach[i]! - mean) * Math.sin(a)
    }
    power[k] = (re * re + im * im) / (bins * bins)
    // One and two turns are the outline lying off its centre or stretched, not its shape.
    if (k >= 3) total += power[k]!
  }
  let count = 3
  for (let k = 4; k <= 48; k++) if (power[k]! > power[count]!) count = k
  if (Math.sqrt(power[count]!) < REPEATS_BY * mean) return false
  let repeated = 0
  for (let k = count; k <= 64; k += count) repeated += power[k]!
  return repeated >= REPEATED_SHARE * total
}

/** The counted points of an outline, at most `most` of them evenly taken. */
function pick(points: Float32Array, most: number, free?: Uint8Array): Float32Array {
  const n = points.length / 2
  const step = Math.max(1, Math.floor(n / most))
  const out: number[] = []
  for (let k = 0; k < n; k += step) if (!free?.[k]) out.push(points[k * 2]!, points[k * 2 + 1]!)
  return Float32Array.from(out)
}

function rectDistance(u: number, v: number, hx: number, hy: number, corners: readonly number[]): number {
  const r = corners[u < 0 ? (v < 0 ? 0 : 3) : v < 0 ? 1 : 2]!
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

/** Parameters: cx, cy, hx, hy, turn in degrees, then a rectangle's four radii. */
type Params = Float64Array

function cost(kind: Primitive['kind'], q: Params, pts: Float32Array): number {
  const turn = (-q[4]! * Math.PI) / 180
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  const corners = [q[5]!, q[6]!, q[7]!, q[8]!]
  let total = 0
  for (let k = 0; k < pts.length; k += 2) {
    const dx = pts[k]! - q[0]!
    const dy = pts[k + 1]! - q[1]!
    const u = dx * cos - dy * sin
    const v = dx * sin + dy * cos
    const d = kind === 'rect' ? rectDistance(u, v, q[2]!, q[3]!, corners) : ellipseDistance(u, v, q[2]!, q[3]!)
    total += Math.min(d * d, CAP * CAP)
  }
  return total / (pts.length / 2)
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
          q[key] = before[key]! + direction * (key === 4 ? step * 0.5 : step)
          const least = Math.min(q[2]!, q[3]!)
          if (q[2]! < 0.25 || q[3]! < 0.25 || (key >= 5 && (q[key]! < 0 || q[key]! > least))) {
            q.set(before)
            continue
          }
          // A side that shrinks takes its corners' radii with it.
          for (let c = 5; c <= 8; c++) if (q[c]! > least) q[c] = least
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

function stats(kind: Primitive['kind'], q: Params, pts: Float32Array): { mean: number; p95: number; max: number } {
  const turn = (-q[4]! * Math.PI) / 180
  const cos = Math.cos(turn)
  const sin = Math.sin(turn)
  const corners = [q[5]!, q[6]!, q[7]!, q[8]!]
  const all = new Float32Array(pts.length / 2)
  let total = 0
  for (let k = 0; k < pts.length; k += 2) {
    const dx = pts[k]! - q[0]!
    const dy = pts[k + 1]! - q[1]!
    const u = dx * cos - dy * sin
    const v = dx * sin + dy * cos
    const d = Math.abs(
      kind === 'rect' ? rectDistance(u, v, q[2]!, q[3]!, corners) : ellipseDistance(u, v, q[2]!, q[3]!),
    )
    all[k / 2] = d
    total += d
  }
  all.sort()
  return {
    mean: total / all.length,
    p95: all[Math.min(all.length - 1, Math.floor(all.length * 0.95))]!,
    max: all[all.length - 1]!,
  }
}

function made(kind: Primitive['kind'], q: Params, pts: Float32Array): Primitive {
  return {
    kind,
    cx: q[0]!,
    cy: q[1]!,
    width: q[2]! * 2,
    height: q[3]! * 2,
    rotation: q[4]!,
    corners: kind === 'rect' ? [q[5]!, q[6]!, q[7]!, q[8]!] : [0, 0, 0, 0],
    ...stats(kind, q, pts),
  }
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
    const u = pts[k]! * cos - pts[k + 1]! * sin
    const v = pts[k]! * sin + pts[k + 1]! * cos
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

/** The direction most of an outline runs in, in degrees within 45 of level: its sides', when it has straight sides. */
function sideDirection(points: Float32Array): number {
  const n = points.length / 2
  const span = Math.max(2, Math.round(n / 60))
  const bins = new Float64Array(90)
  for (let k = 0; k < n; k++) {
    const m = (k + span) % n
    const dx = points[m * 2]! - points[k * 2]!
    const dy = points[m * 2 + 1]! - points[k * 2 + 1]!
    const length = Math.hypot(dx, dy)
    if (length < 1e-6) continue
    const degrees = ((((Math.atan2(dy, dx) * 180) / Math.PI) % 90) + 90) % 90
    bins[Math.floor(degrees) % 90]! += length
  }
  let peak = 0
  for (let b = 1; b < 90; b++) if (bins[b]! > bins[peak]!) peak = b
  // The weighted mean direction around the peak.
  let sum = 0
  let weight = 0
  for (let d = -3; d <= 3; d++) {
    const w = bins[(peak + d + 90) % 90]!
    sum += w * (peak + d + 0.5)
    weight += w
  }
  const degrees = weight > 0 ? sum / weight : 0
  return degrees > 45 ? degrees - 90 : degrees
}

function fitRect(points: Float32Array, pts: Float32Array, all: Float32Array): Primitive | null {
  const direction = sideDirection(points)
  const turned = Math.abs(direction) >= LEVEL
  const start = reach(pts, turned ? direction : 0)
  const q = Float64Array.from([start.cx, start.cy, start.hx, start.hy, turned ? direction : 0, 0, 0, 0, 0])
  if (q[2]! < 0.25 || q[3]! < 0.25) return null
  const keys = turned ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [0, 1, 2, 3, 5, 6, 7, 8]
  // Three starts, and the best of them: square corners, the roundest, and each corner as far round as the outline
  // keeps from the box's corner there (an arc of radius r passes r (√2 − 1) from it).
  const square = Float64Array.from(q)
  const round = Float64Array.from(q)
  round.fill(Math.min(q[2]!, q[3]!), 5, 9)
  const measured = Float64Array.from(q)
  const turn = (-q[4]! * Math.PI) / 180
  const nearest = [Infinity, Infinity, Infinity, Infinity]
  for (let k = 0; k < pts.length; k += 2) {
    const dx = pts[k]! - q[0]!
    const dy = pts[k + 1]! - q[1]!
    const u = dx * Math.cos(turn) - dy * Math.sin(turn)
    const v = dx * Math.sin(turn) + dy * Math.cos(turn)
    const corner = u < 0 ? (v < 0 ? 0 : 3) : v < 0 ? 1 : 2
    nearest[corner] = Math.min(nearest[corner]!, Math.hypot(Math.abs(u) - q[2]!, Math.abs(v) - q[3]!))
  }
  for (let c = 0; c < 4; c++)
    measured[5 + c] = Math.min(
      Math.min(q[2]!, q[3]!),
      Number.isFinite(nearest[c]!) ? nearest[c]! / (Math.SQRT2 - 1) : 0,
    )
  let best = square
  let bestCost = Infinity
  // The measured start comes first: where it lands on the outline, the other two are not tried.
  for (const start of [measured, square, round]) {
    const reached = descend('rect', start, pts, keys)
    if (reached < bestCost) {
      bestCost = reached
      best = start
    }
    if (bestCost <= ON_OUTLINE) break
  }
  if (Math.abs(best[4]!) < LEVEL && best[4] !== 0) {
    best[4] = 0
    descend('rect', best, pts, [0, 1, 2, 3, 5, 6, 7, 8])
  }
  // Radii that are about one radius become one; one about half the shorter side is a pill's; a hair of one is none.
  const least = Math.min(best[2]!, best[3]!)
  const radii = [best[5]!, best[6]!, best[7]!, best[8]!]
  const mean = (radii[0]! + radii[1]! + radii[2]! + radii[3]!) / 4
  const snapped = Float64Array.from(best)
  if (Math.max(...radii) - Math.min(...radii) <= Math.max(0.5, ONE_RADIUS * mean)) snapped.fill(mean, 5, 9)
  for (let c = 5; c <= 8; c++) {
    if (snapped[c]! >= least - Math.max(0.5, 0.06 * least)) snapped[c] = least
    else if (snapped[c]! < Math.max(0.5, 0.04 * least)) snapped[c] = 0
  }
  const plain = cost('rect', best, pts)
  return made('rect', cost('rect', snapped, pts) <= plain * 1.25 + 0.02 ? snapped : best, all)
}

function fitEllipse(pts: Float32Array, all: Float32Array): Primitive | null {
  const n = pts.length / 2
  let mx = 0
  let my = 0
  for (let k = 0; k < pts.length; k += 2) {
    mx += pts[k]!
    my += pts[k + 1]!
  }
  mx /= n
  my /= n
  let xx = 0
  let yy = 0
  let xy = 0
  for (let k = 0; k < pts.length; k += 2) {
    const dx = pts[k]! - mx
    const dy = pts[k + 1]! - my
    xx += dx * dx
    yy += dy * dy
    xy += dx * dy
  }
  const direction = (0.5 * Math.atan2(2 * xy, xx - yy) * 180) / Math.PI
  const round = Math.abs(xx - yy) + Math.abs(xy) * 2 < 0.06 * (xx + yy)
  const turned = !round && Math.abs(direction) >= LEVEL && Math.abs(Math.abs(direction) - 90) >= LEVEL
  const start = reach(pts, turned ? direction : 0)
  const q = Float64Array.from([start.cx, start.cy, start.hx, start.hy, turned ? direction : 0, 0, 0, 0, 0])
  if (q[2]! < 0.25 || q[3]! < 0.25) return null
  descend('ellipse', q, pts, turned ? [0, 1, 2, 3, 4] : [0, 1, 2, 3])
  const snapped = Float64Array.from(q)
  if (Math.abs(q[2]! - q[3]!) <= Math.max(0.5, 0.015 * Math.max(q[2]!, q[3]!))) {
    snapped[2] = snapped[3] = (q[2]! + q[3]!) / 2
    snapped[4] = 0
  }
  return made('ellipse', cost('ellipse', snapped, pts) <= cost('ellipse', q, pts) * 1.25 + 0.02 ? snapped : q, all)
}
