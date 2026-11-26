// The connectors as one set of triangles, which the stage's surface draws in a single call: each
// curve cut into straight pieces short enough to look smooth, stroked as a strip whose edges fade out
// over a fringe as wide as one screen pixel, as anti-aliasing would smooth them, and each arrowhead
// as a triangle with the same fringe. Triangles keep long curves off the GPU's slow way of stroking
// anti-aliased paths, and the set is kept while the camera only pans.
import type { Point } from '@dazbee/schema'

import { arrowheadOf, type ConnectorCurve } from './connectors.ts'

/**
 * Triangles with an opacity at each corner, from 0 to 1: their corners' x and y, and three corners to
 * each triangle, by their place. One set holds at most MAX_CORNERS corners, as a draw call takes.
 */
export interface ConnectorMesh {
  positions: number[]
  alphas: number[]
  indices: number[]
}

/** The most corners one set of triangles holds: a draw call numbers them in 16 bits. */
export const MAX_CORNERS = 65_536

/** How far a straight piece may stray from the curve it stands for, in stage pixels. */
const TOLERANCE = 0.2
/** The most times a curve is halved: at most 2 ** MAX_DEPTH pieces each. */
const MAX_DEPTH = 6
/** The longest a corner of the strip reaches past the line at a turn, as a share of its half-width. */
const MITER_LIMIT = 2

/**
 * The triangles of curves stroked `width` wide, each line stopping at its arrowhead's base, and their
 * arrowheads, every edge fading out over `fringe` (one screen pixel, in stage pixels), in as many
 * sets as MAX_CORNERS needs.
 */
export function connectorMeshes(curves: readonly ConnectorCurve[], width: number, fringe: number): ConnectorMesh[] {
  const meshes: ConnectorMesh[] = []
  let mesh: ConnectorMesh = { positions: [], alphas: [], indices: [] }
  // Anti-aliasing covers half a pixel either side of an edge: the solid core stops half the fringe in.
  const core = Math.max(0, width / 2 - fringe / 2)
  const outer = width / 2 + fringe / 2
  // A line thinner than the fringe is drawn fainter, as anti-aliasing draws it.
  const strength = Math.min(1, width / fringe)
  for (const curve of curves) {
    const { head, line } = arrowheadOf(curve)
    const points = flatten(line)
    // The line's four corners at each point, and the head's nine.
    if (mesh.alphas.length + points.length * 4 + 9 > MAX_CORNERS) {
      meshes.push(mesh)
      mesh = { positions: [], alphas: [], indices: [] }
    }
    addStrip(mesh, points, core, outer, strength)
    addTriangle(mesh, [head.tip, head.left, head.right], fringe)
  }
  if (mesh.alphas.length > 0) meshes.push(mesh)
  return meshes
}

/** The points of straight pieces that stay within TOLERANCE of a curve, from its start to its end. */
export function flatten(curve: ConnectorCurve): Point[] {
  const points = [curve.from]
  split(curve, 0, points)
  return points
}

/**
 * Adds a stroked line through `points`: at each point four corners across it, the strip's two outer
 * edges at no opacity, `outer` out, and its solid core's at `strength`, `core` out, joined at turns
 * along the bisector of the two pieces.
 */
function addStrip(mesh: ConnectorMesh, points: readonly Point[], core: number, outer: number, strength: number) {
  const first = mesh.alphas.length
  const count = points.length
  if (count < 2) return
  for (let i = 0; i < count; i++) {
    const p = points[i] as Point
    const normal = normalAt(points, i)
    for (const [reach, alpha] of [
      [-outer, 0],
      [-core, strength],
      [core, strength],
      [outer, 0],
    ] as const) {
      mesh.positions.push(p.x + normal.x * reach, p.y + normal.y * reach)
      mesh.alphas.push(alpha)
    }
  }
  for (let i = 0; i < count - 1; i++) {
    const [here, next] = [first + i * 4, first + (i + 1) * 4]
    // The fringe on one side, the core, the fringe on the other: two triangles each.
    for (let band = 0; band < 3; band++) {
      const [a, b, c, d] = [here + band, here + band + 1, next + band, next + band + 1]
      mesh.indices.push(a, b, c, b, d, c)
    }
  }
}

/** The way across the line at point `i`: the pieces' normals joined, as long as a mitred corner needs, up to MITER_LIMIT. */
function normalAt(points: readonly Point[], i: number): Point {
  const before = pieceNormal(points[i - 1], points[i])
  const after = pieceNormal(points[i], points[i + 1])
  const [n1, n2] = [before ?? after, after ?? before]
  if (!n1 || !n2) return { x: 0, y: 0 }
  const sum = { x: n1.x + n2.x, y: n1.y + n2.y }
  const length = Math.hypot(sum.x, sum.y)
  if (length === 0) return n1
  const unit = { x: sum.x / length, y: sum.y / length }
  // A mitred corner reaches 1 / cos(half the turn) out.
  const stretch = Math.min(MITER_LIMIT, 1 / Math.max(1e-6, unit.x * n1.x + unit.y * n1.y))
  return { x: unit.x * stretch, y: unit.y * stretch }
}

/** The unit normal of the piece from `p` to `q`, to its left; undefined at an end or for a piece of no length. */
function pieceNormal(p: Point | undefined, q: Point | undefined): Point | undefined {
  if (!p || !q) return undefined
  const [dx, dy] = [q.x - p.x, q.y - p.y]
  const length = Math.hypot(dx, dy)
  return length === 0 ? undefined : { x: -dy / length, y: dx / length }
}

/** Adds a solid triangle, and a fringe `fringe` wide fading out from each of its edges. */
function addTriangle(mesh: ConnectorMesh, corners: readonly [Point, Point, Point], fringe: number) {
  const first = mesh.alphas.length
  for (const p of corners) {
    mesh.positions.push(p.x, p.y)
    mesh.alphas.push(1)
  }
  mesh.indices.push(first, first + 1, first + 2)
  const [cx, cy] = [(corners[0].x + corners[1].x + corners[2].x) / 3, (corners[0].y + corners[1].y + corners[2].y) / 3]
  for (let i = 0; i < 3; i++) {
    const [p, q] = [corners[i] as Point, corners[(i + 1) % 3] as Point]
    const normal = pieceNormal(p, q)
    if (!normal) continue
    // Outward: away from the triangle's middle.
    const side = (p.x - cx) * normal.x + (p.y - cy) * normal.y >= 0 ? 1 : -1
    const at = mesh.alphas.length
    mesh.positions.push(p.x + normal.x * side * fringe, p.y + normal.y * side * fringe)
    mesh.positions.push(q.x + normal.x * side * fringe, q.y + normal.y * side * fringe)
    mesh.alphas.push(0, 0)
    const [a, b] = [first + i, first + ((i + 1) % 3)]
    mesh.indices.push(a, b, at, b, at + 1, at)
  }
}

/** Adds a curve's pieces to `points` after its start: the curve itself once flat enough, else its two halves. */
function split(curve: ConnectorCurve, depth: number, points: Point[]) {
  if (depth >= MAX_DEPTH || flatEnough(curve)) {
    points.push(curve.to)
    return
  }
  const [first, second] = halves(curve)
  split(first, depth + 1, points)
  split(second, depth + 1, points)
}

/** Whether both control points lie within TOLERANCE of the line from the curve's start to its end. */
function flatEnough({ from, c1, c2, to }: ConnectorCurve) {
  const [dx, dy] = [to.x - from.x, to.y - from.y]
  const length = Math.hypot(dx, dy)
  if (length === 0) return Math.hypot(c1.x - from.x, c1.y - from.y) <= TOLERANCE
  const off = (p: Point) => Math.abs((p.x - from.x) * dy - (p.y - from.y) * dx) / length
  // A cubic strays at most three quarters of its control points' distance from the line.
  return (Math.max(off(c1), off(c2)) * 3) / 4 <= TOLERANCE
}

/** A curve cut in two at its middle. */
function halves({ from, c1, c2, to }: ConnectorCurve): [ConnectorCurve, ConnectorCurve] {
  const mid = (p: Point, q: Point) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })
  const [a, b, c] = [mid(from, c1), mid(c1, c2), mid(c2, to)]
  const [d, e] = [mid(a, b), mid(b, c)]
  const centre = mid(d, e)
  return [
    { from, c1: a, c2: d, to: centre },
    { from: centre, c1: e, c2: c, to },
  ]
}
