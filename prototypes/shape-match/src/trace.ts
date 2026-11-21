// PROTOTYPE. Traces a coverage mask into an SVG path of cubic Béziers, holes included (evenodd):
// marching squares at half coverage gives sub-pixel outlines; corners are where the outline turns
// sharply; between corners, cubic Béziers are fitted by least squares on chord-length parameters,
// re-parameterised by Newton steps, and split at the worst point until they keep within tolerance.
import type { Mask } from './fit.ts'

type P = [number, number]

export interface Traced {
  /** Path data in the layer's own box, block pixels. */
  d: string
  box: { x: number; y: number; width: number; height: number }
  loops: number
  segments: number
}

/** The mask's outlines as one evenodd path; tol in block pixels. */
export function tracePath(mask: Mask, tol: number): Traced | null {
  const loops = contours(mask.m, mask.w, mask.h, 0.5).filter((l) => l.length >= 6 && Math.abs(area(l)) >= 2)
  if (loops.length === 0) return null
  const s = mask.s
  const scaled = loops.map((l) => smooth(l.map(([x, y]) => [x / s, y / s] as P)))
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity
  for (const l of scaled)
    for (const [x, y] of l) {
      x0 = Math.min(x0, x)
      y0 = Math.min(y0, y)
      x1 = Math.max(x1, x)
      y1 = Math.max(y1, y)
    }
  const parts: string[] = []
  let segments = 0
  const f = (v: number) => (Math.round(v * 100) / 100).toString()
  for (const loop of scaled) {
    const curves = fitLoop(loop, tol)
    segments += curves.length
    const st = curves[0]![0]
    parts.push(`M${f(st[0] - x0)} ${f(st[1] - y0)}`)
    for (const c of curves) {
      if (c.length === 2) parts.push(`L${f(c[1][0] - x0)} ${f(c[1][1] - y0)}`)
      else
        parts.push(
          `C${f(c[1]![0] - x0)} ${f(c[1]![1] - y0)} ${f(c[2]![0] - x0)} ${f(c[2]![1] - y0)} ${f(c[3]![0] - x0)} ${f(c[3]![1] - y0)}`,
        )
    }
    parts.push('Z')
  }
  return {
    d: parts.join(''),
    box: { x: x0, y: y0, width: Math.max(0.01, x1 - x0), height: Math.max(0.01, y1 - y0) },
    loops: loops.length,
    segments,
  }
}

/** Closed outlines at level iso through pixel centres; the picture is padded with zero. */
export function contours(m: Float32Array, w: number, h: number, iso: number): P[][] {
  const W = w + 2
  const H = h + 2
  const v = (x: number, y: number) => (x <= 0 || y <= 0 || x > w || y > h ? 0 : m[(y - 1) * w + (x - 1)]!)
  // Edge ids: horizontal edge from (x,y) to (x+1,y) is 2*(y*W+x); vertical from (x,y) to (x,y+1) is +1.
  const pos = new Map<number, P>()
  const link = new Map<number, number[]>()
  const edgePoint = (id: number): P => {
    const got = pos.get(id)
    if (got) return got
    const cell = id >> 1
    const x = cell % W
    const y = (cell - x) / W
    const a = v(x, y)
    const b = id & 1 ? v(x, y + 1) : v(x + 1, y)
    const t = Math.abs(b - a) < 1e-9 ? 0.5 : (iso - a) / (b - a)
    // Pixel centres sit at (x - 1 + 0.5) in the picture.
    const p: P = id & 1 ? [x - 0.5, y - 0.5 + t] : [x - 0.5 + t, y - 0.5]
    pos.set(id, p)
    return p
  }
  const add = (a: number, b: number) => {
    edgePoint(a)
    edgePoint(b)
    ;(link.get(a) ?? link.set(a, []).get(a)!).push(b)
    ;(link.get(b) ?? link.set(b, []).get(b)!).push(a)
  }
  for (let y = 0; y < H - 1; y++)
    for (let x = 0; x < W - 1; x++) {
      const tl = v(x, y) >= iso ? 1 : 0
      const tr = v(x + 1, y) >= iso ? 2 : 0
      const br = v(x + 1, y + 1) >= iso ? 4 : 0
      const bl = v(x, y + 1) >= iso ? 8 : 0
      const c = tl | tr | br | bl
      if (c === 0 || c === 15) continue
      const T = 2 * (y * W + x)
      const B = 2 * ((y + 1) * W + x)
      const L = 2 * (y * W + x) + 1
      const R = 2 * (y * W + x + 1) + 1
      const centre = (v(x, y) + v(x + 1, y) + v(x + 1, y + 1) + v(x, y + 1)) / 4 >= iso
      switch (c) {
        case 1:
        case 14:
          add(L, T)
          break
        case 2:
        case 13:
          add(T, R)
          break
        case 3:
        case 12:
          add(L, R)
          break
        case 4:
        case 11:
          add(R, B)
          break
        case 6:
        case 9:
          add(T, B)
          break
        case 7:
        case 8:
          add(L, B)
          break
        case 5:
          if (centre) {
            add(T, R)
            add(L, B)
          } else {
            add(L, T)
            add(R, B)
          }
          break
        case 10:
          if (centre) {
            add(L, T)
            add(R, B)
          } else {
            add(T, R)
            add(L, B)
          }
          break
      }
    }
  const used = new Set<string>()
  const key = (a: number, b: number) => (a < b ? `${a},${b}` : `${b},${a}`)
  const loops: P[][] = []
  for (const start of link.keys()) {
    for (const next0 of link.get(start)!) {
      if (used.has(key(start, next0))) continue
      const loop: P[] = [pos.get(start)!]
      let prev = start
      let cur = next0
      used.add(key(start, next0))
      while (cur !== start) {
        loop.push(pos.get(cur)!)
        const nexts = link.get(cur)!
        const nx = nexts.find((n) => n !== prev && !used.has(key(cur, n))) ?? nexts.find((n) => !used.has(key(cur, n)))
        if (nx === undefined) break
        used.add(key(cur, nx))
        prev = cur
        cur = nx
      }
      loops.push(loop)
    }
  }
  return loops
}

function area(l: P[]) {
  let a = 0
  for (let i = 0; i < l.length; i++) {
    const [x1, y1] = l[i]!
    const [x2, y2] = l[(i + 1) % l.length]!
    a += x1 * y2 - x2 * y1
  }
  return a / 2
}

/** One pass of [1 2 1] smoothing, which steadies AI-wobbled edges without moving corners far. */
function smooth(l: P[]): P[] {
  const n = l.length
  return l.map((p, i) => {
    const a = l[(i + n - 1) % n]!
    const b = l[(i + 1) % n]!
    return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4]
  })
}

type Curve = [P, P] | [P, P, P, P]

/** Splits the loop at its corners and fits each run. */
function fitLoop(loop: P[], tol: number): Curve[] {
  const n = loop.length
  const corners = cornersOf(loop)
  if (corners.length === 0) {
    // A smooth closed outline: four runs, tangents continuous.
    const q = [0, n >> 2, n >> 1, (3 * n) >> 2]
    const out: Curve[] = []
    for (let k = 0; k < 4; k++) {
      const a = q[k]!
      const b = q[(k + 1) % 4]! || n
      const run = runOf(loop, a, b)
      out.push(...fitRun(run, tangentAt(loop, a), neg(tangentAt(loop, b % n)), tol))
    }
    return out
  }
  const out: Curve[] = []
  for (let k = 0; k < corners.length; k++) {
    const a = corners[k]!
    const b = corners[(k + 1) % corners.length]!
    const run = runOf(loop, a, b === a ? a + n : b)
    if (run.length < 2) continue
    const t1 = norm(sub(run[Math.min(run.length - 1, 2)]!, run[0]!))
    const t2 = norm(sub(run[Math.max(0, run.length - 3)]!, run[run.length - 1]!))
    out.push(...fitRun(run, t1, t2, tol))
  }
  return out
}

function runOf(loop: P[], a: number, b: number): P[] {
  const n = loop.length
  const end = b > a ? b : b + n
  const run: P[] = []
  for (let i = a; i <= end; i++) run.push(loop[i % n]!)
  return run
}

/** Points where the outline turns by more than 55° over three points each side, the sharpest in a run. */
function cornersOf(loop: P[]): number[] {
  const n = loop.length
  const k = Math.max(2, Math.min(4, Math.floor(n / 12)))
  const turn = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const a = norm(sub(loop[i]!, loop[(i - k + n) % n]!))
    const b = norm(sub(loop[(i + k) % n]!, loop[i]!))
    turn[i] = Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1])))
  }
  const out: number[] = []
  const LIMIT = (55 * Math.PI) / 180
  for (let i = 0; i < n; i++) {
    if (turn[i]! < LIMIT) continue
    let peak = true
    for (let d = 1; d <= k; d++) if (turn[(i + d) % n]! > turn[i]! || turn[(i - d + n) % n]! >= turn[i]!) peak = false
    if (peak) out.push(i)
  }
  return out
}

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1]]
const add2 = (a: P, b: P): P => [a[0] + b[0], a[1] + b[1]]
const mul = (a: P, s: number): P => [a[0] * s, a[1] * s]
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1]
const neg = (a: P): P => [-a[0], -a[1]]
const norm = (a: P): P => {
  const l = Math.hypot(a[0], a[1]) || 1
  return [a[0] / l, a[1] / l]
}
const tangentAt = (loop: P[], i: number): P => {
  const n = loop.length
  return norm(sub(loop[(i + 2) % n]!, loop[(i - 2 + n) % n]!))
}

/** Least-squares cubic Béziers through a run, split until within tol. */
function fitRun(pts: P[], t1: P, t2: P, tol: number, depth = 0): Curve[] {
  const first = pts[0]!
  const last = pts[pts.length - 1]!
  if (pts.length <= 2) return [[first, last]]
  // A straight run is a line.
  const chord = sub(last, first)
  const cl = Math.hypot(chord[0], chord[1])
  if (cl > 0) {
    const nrm: P = [-chord[1] / cl, chord[0] / cl]
    let maxOff = 0
    for (const p of pts) maxOff = Math.max(maxOff, Math.abs(dot(sub(p, first), nrm)))
    if (maxOff <= tol * 0.6) return [[first, last]]
  }
  let u = chordParams(pts)
  let bez = solve(pts, u, t1, t2)
  let { err, at } = maxError(pts, bez, u)
  if (err <= tol) return [bez]
  for (let it = 0; it < 4 && err < tol * 6; it++) {
    u = u.map((t, i) => newton(bez, pts[i]!, t))
    bez = solve(pts, u, t1, t2)
    ;({ err, at } = maxError(pts, bez, u))
    if (err <= tol) return [bez]
  }
  if (depth > 10 || pts.length < 4) return [bez]
  const split = Math.max(1, Math.min(pts.length - 2, at))
  const tc = norm(sub(pts[split - 1]!, pts[split + 1]!))
  return [
    ...fitRun(pts.slice(0, split + 1), t1, tc, tol, depth + 1),
    ...fitRun(pts.slice(split), neg(tc), t2, tol, depth + 1),
  ]
}

function chordParams(pts: P[]) {
  const u = [0]
  for (let i = 1; i < pts.length; i++)
    u.push(u[i - 1]! + Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]))
  const L = u[u.length - 1]! || 1
  return u.map((v) => v / L)
}

const bern = (t: number) => {
  const m = 1 - t
  return [m * m * m, 3 * m * m * t, 3 * m * t * t, t * t * t] as const
}

/** The two inner control points' distances along the end tangents, by least squares. */
function solve(pts: P[], u: number[], t1: P, t2: P): [P, P, P, P] {
  const p0 = pts[0]!
  const p3 = pts[pts.length - 1]!
  let c00 = 0,
    c01 = 0,
    c11 = 0,
    x0 = 0,
    x1 = 0
  for (let i = 0; i < pts.length; i++) {
    const [b0, b1, b2, b3] = bern(u[i]!)
    const a1 = mul(t1, b1)
    const a2 = mul(t2, b2)
    c00 += dot(a1, a1)
    c01 += dot(a1, a2)
    c11 += dot(a2, a2)
    const tmp = sub(pts[i]!, add2(mul(p0, b0 + b1), mul(p3, b2 + b3)))
    x0 += dot(a1, tmp)
    x1 += dot(a2, tmp)
  }
  const det = c00 * c11 - c01 * c01
  const seg = Math.hypot(p3[0] - p0[0], p3[1] - p0[1])
  let al1 = det !== 0 ? (x0 * c11 - x1 * c01) / det : 0
  let al2 = det !== 0 ? (c00 * x1 - c01 * x0) / det : 0
  const eps = 1e-6 * seg
  if (al1 < eps || al2 < eps || al1 > seg * 2 || al2 > seg * 2) {
    al1 = seg / 3
    al2 = seg / 3
  }
  return [p0, add2(p0, mul(t1, al1)), add2(p3, mul(t2, al2)), p3]
}

function at(b: [P, P, P, P], t: number): P {
  const [b0, b1, b2, b3] = bern(t)
  return [
    b[0][0] * b0 + b[1][0] * b1 + b[2][0] * b2 + b[3][0] * b3,
    b[0][1] * b0 + b[1][1] * b1 + b[2][1] * b2 + b[3][1] * b3,
  ]
}

function maxError(pts: P[], b: [P, P, P, P], u: number[]) {
  let err = 0
  let idx = pts.length >> 1
  for (let i = 1; i < pts.length - 1; i++) {
    const q = at(b, u[i]!)
    const d = Math.hypot(q[0] - pts[i]![0], q[1] - pts[i]![1])
    if (d > err) {
      err = d
      idx = i
    }
  }
  return { err, at: idx }
}

/** One Newton step on t towards the point nearest p. */
function newton(b: [P, P, P, P], p: P, t: number) {
  const q = at(b, t)
  const d1: P[] = [mul(sub(b[1], b[0]), 3), mul(sub(b[2], b[1]), 3), mul(sub(b[3], b[2]), 3)]
  const d2: P[] = [mul(sub(d1[1]!, d1[0]!), 2), mul(sub(d1[2]!, d1[1]!), 2)]
  const m = 1 - t
  const q1: P = add2(add2(mul(d1[0]!, m * m), mul(d1[1]!, 2 * m * t)), mul(d1[2]!, t * t))
  const q2: P = add2(mul(d2[0]!, m), mul(d2[1]!, t))
  const diff = sub(q, p)
  const num = dot(diff, q1)
  const den = dot(q1, q1) + dot(diff, q2)
  if (Math.abs(den) < 1e-12) return t
  return Math.max(0, Math.min(1, t - num / den))
}
