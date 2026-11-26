import { describe, expect, it } from 'vitest'

import { connectorMeshes, flatten, MAX_CORNERS } from './connector-mesh.ts'
import { arrowheadOf, connectorCurve } from './connectors.ts'

/** A curve between two 100-square boxes side by side, 200 apart. */
const CURVE = connectorCurve({ x: 0, y: 0, width: 100, height: 100 }, { x: 300, y: 60, width: 100, height: 100 })
/** A straight curve along y = 50. */
const STRAIGHT = { from: { x: 0, y: 50 }, c1: { x: 30, y: 50 }, c2: { x: 70, y: 50 }, to: { x: 100, y: 50 } }

/** How far a point is from the curve, measured against its points 1,000 steps apart. */
function awayFromCurve(p: { x: number; y: number }) {
  const { from, c1, c2, to } = CURVE
  let nearest = Infinity
  for (let i = 0; i <= 1000; i++) {
    const t = i / 1000
    const u = 1 - t
    const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
    const q = { x: a * from.x + b * c1.x + c * c2.x + d * to.x, y: a * from.y + b * c1.y + c * c2.y + d * to.y }
    nearest = Math.min(nearest, Math.hypot(p.x - q.x, p.y - q.y))
  }
  return nearest
}

describe('connectorMeshes', () => {
  it('strokes a curve as a strip four corners across, solid in the middle and fading out at both edges, and adds its arrowhead', () => {
    const [mesh] = connectorMeshes([STRAIGHT], 2, 1)
    if (!mesh) throw new Error('no mesh')
    const points = flatten(arrowheadOf(STRAIGHT).line).length
    // Four corners at each point of the line, and the head's three with two more for each edge's fringe.
    expect(mesh.alphas).toHaveLength(points * 4 + 9)
    expect(mesh.alphas.slice(0, 4)).toEqual([0, 1, 1, 0])
    // Across y = 50: the fringe's outer edges at 1.5 out, the core's at 0.5 out.
    expect([1, 3, 5, 7].map((i) => mesh.positions[i])).toEqual([48.5, 49.5, 50.5, 51.5])
    // Three bands of two triangles between each pair of points, the head and its three fringes.
    expect(mesh.indices).toHaveLength((points - 1) * 18 + 3 + 18)
    expect(Math.max(...mesh.indices)).toBe(mesh.alphas.length - 1)
  })

  it('draws a line thinner than the fringe fainter, as anti-aliasing would', () => {
    const [mesh] = connectorMeshes([STRAIGHT], 0.5, 1)
    expect(mesh?.alphas.slice(0, 4)).toEqual([0, 0.5, 0.5, 0])
  })

  it('splits into sets of at most MAX_CORNERS corners', () => {
    const many = Array.from({ length: 2000 }, () => CURVE)
    const meshes = connectorMeshes(many, 1.25, 1)
    expect(meshes.length).toBeGreaterThan(1)
    for (const mesh of meshes) {
      expect(mesh.alphas.length).toBeLessThanOrEqual(MAX_CORNERS)
      expect(mesh.indices.reduce((most, i) => Math.max(most, i), 0)).toBeLessThan(mesh.alphas.length)
    }
  })
})

describe('flatten', () => {
  it('keeps every piece within a fifth of a pixel of the curve, from its start to its end', () => {
    const points = flatten(CURVE)
    expect(points[0]).toEqual(CURVE.from)
    expect(points.at(-1)).toEqual(CURVE.to)
    for (let i = 1; i < points.length; i++) {
      const [p, q] = [points[i - 1], points[i]]
      if (!p || !q) continue
      expect(awayFromCurve({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })).toBeLessThan(0.25)
    }
  })

  it('leaves a straight curve as one piece', () => {
    expect(flatten(STRAIGHT)).toEqual([STRAIGHT.from, STRAIGHT.to])
  })
})
