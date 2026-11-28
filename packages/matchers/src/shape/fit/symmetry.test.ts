import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { drawGraphics, type ShapeLayer } from '../draw-layers.ts'
import { marchingSquares } from '../outlines.ts'
import { ellipse, graphic, rectangle } from '../test-pieces.ts'
import { repeatsRound } from './symmetry.ts'

const ck = await loadCanvasKit()
const INK = '#111827FF'
const WIDTH = 200
const HEIGHT = 140

/** The outline of a graphic drawn alone on a 200 × 140 piece, in the piece's pixels. */
const outlineOf = (layer: ShapeLayer): Float32Array => {
  const drawn = drawGraphics(ck, [layer], WIDTH, HEIGHT)
  const cover = Float32Array.from({ length: WIDTH * HEIGHT }, (_, i) => (drawn.pixels[i * 4 + 3] ?? 0) / 255)
  const [outline, ...others] = marchingSquares(cover, WIDTH, HEIGHT, 0.5, 0.5)
  if (!outline || others.length) throw new Error('the graphic draws no single outline')
  return outline.points
}

const star = graphic(
  { kind: 'star', points: 5, innerRadius: 0.382, cornerRadius: 0 },
  { x: 50, y: 20, width: 100, height: 100 },
  { fill: { type: 'solid', color: INK } },
)
const hexagon = graphic(
  { kind: 'polygon', sides: 6, cornerRadius: 0 },
  { x: 50, y: 20, width: 100, height: 100 },
  { fill: { type: 'solid', color: INK } },
)
/** An L: a square with its top right quarter and more cut away. */
const corner = graphic(
  {
    kind: 'path',
    d: 'M0 0 L40 0 L40 60 L100 60 L100 100 L0 100 Z',
    fillRule: 'nonzero',
    drawnIn: { width: 100, height: 100 },
  },
  { x: 50, y: 20, width: 100, height: 100 },
  { fill: { type: 'solid', color: INK } },
)

describe('repeatsRound', () => {
  it('says a star’s and a regular polygon’s outlines repeat round their centre', () => {
    expect(repeatsRound(outlineOf(star))).toBe(true)
    expect(repeatsRound(outlineOf(hexagon))).toBe(true)
  })

  it('says a circle’s, a long rectangle’s and an L’s do not', () => {
    expect(repeatsRound(outlineOf(ellipse({ x: 50, y: 20, width: 100, height: 100 }, INK)))).toBe(false)
    expect(repeatsRound(outlineOf(rectangle({ x: 30, y: 30, width: 140, height: 80 }, INK)))).toBe(false)
    expect(repeatsRound(outlineOf(corner))).toBe(false)
  })
})
