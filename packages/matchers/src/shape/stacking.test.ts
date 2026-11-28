import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { marchingSquares } from './outlines.ts'
import type { Patch } from './patches.ts'
import { stack, type Stacked } from './stacking.ts'
import { HEIGHT, stackedOf, WIDTH } from './test-matching.ts'
import { ellipse, rectangle, stroked } from './test-pieces.ts'

const ck = await loadCanvasKit()
const BLUE = '#2563EBFF'
const CORAL = '#F2765AFF'
const CREAM = '#FFF4D6FF'
const INK = '#111827FF'
const NAVY = '#15224AFF'
const VIOLET = '#7C3AEDFF'
const WHITE = '#FFFFFFFF'

/** The stacked patches of graphics drawn as a piece, 200 × 140 when no size is given. */
const stacked = (layers: ShapeLayer[], width = WIDTH, height = HEIGHT): Stacked[] =>
  stackedOf(drawGraphics(ck, layers, width, height)).stacked

/** The stacked patch of a colour, given as its red, green and blue. */
const ofColour = (patches: readonly Stacked[], red: number, green: number, blue: number): Stacked => {
  const found = patches.find((s) => s.patch.rgb.map(Math.round).join() === [red, green, blue].join())
  if (!found) throw new Error(`no patch of ${red}, ${green}, ${blue}`)
  return found
}

/** The primitive a stacked patch is; it throws for a patch that is none. */
const primitiveOf = (s: Stacked | undefined) => {
  if (!s?.primitive) throw new Error('no primitive')
  return s.primitive
}

/**
 * A 100 × 60 cut made by hand: a rectangle of 80 × 40 pixels, patch 1, whose outline runs round all of it, and a
 * square of `side` pixels inside it that is another patch's, numbered `crumb`, which is no graphic.
 */
const cutWithCrumb = (crumb: number, side: number): { patch: Patch; patchOf: Int32Array } => {
  const inBlock = (x: number, y: number) => x >= 10 && x < 90 && y >= 10 && y < 50
  const inCrumb = (x: number, y: number) => x >= 40 && x < 40 + side && y >= 25 && y < 25 + side
  const patchOf = Int32Array.from({ length: 100 * 60 }, (_, i) => {
    const x = i % 100
    const y = Math.floor(i / 100)
    return inCrumb(x, y) ? crumb : inBlock(x, y) ? 1 : -1
  })
  const loops = marchingSquares(
    Float32Array.from(patchOf, (id) => (id >= 0 ? 1 : 0)),
    100,
    60,
    0.5,
    0.5,
  )
  const area = 80 * 40 - side * side
  const patch: Patch = {
    id: 1,
    colour: 0,
    rgb: [16, 40, 72],
    alpha: 1,
    area,
    box: { x0: 10, y0: 10, x1: 89, y1: 49 },
    spread: 0,
    loops,
    outline: loops.reduce((sum, loop) => sum + Math.max(0, loop.area), 0),
    seed: [10, 10],
  }
  return { patch, patchOf }
}

const ground = rectangle({ x: 0, y: 0, width: WIDTH, height: HEIGHT }, CREAM)
const panelBox = { x: 20, y: 20, width: 160, height: 100 }
const panel = rectangle(panelBox, BLUE, 12)
const badgeBox = { x: 80, y: 50, width: 40, height: 40 }

describe('stack', () => {
  it('stacks the patches back to front, the one with the largest outline first', () => {
    const patches = stacked([ground, panel, rectangle(badgeBox, INK)])
    expect(patches.map((s) => s.patch.rgb.map(Math.round))).toEqual([
      [255, 244, 214],
      [37, 99, 235],
      [17, 24, 39],
    ])
    const sizes = patches.map((s) => s.patch.outline)
    expect([...sizes].sort((a, b) => b - a)).toEqual(sizes)
  })

  it('gives a patch in another’s hole that patch as its parent, and closes the hole it fills', () => {
    const patches = stacked([ground, panel, rectangle(badgeBox, INK)])
    const [back, middle, front] = patches
    expect(back?.parent).toBeNull()
    expect(middle?.parent).toBe(back?.patch)
    expect(front?.parent).toBe(middle?.patch)
    // The badge lies on the panel: the panel is whole under it.
    expect(front?.seenThrough).toBe(false)
    expect(middle?.holes).toEqual([])
    expect(middle?.closes).toBe(true)
  })

  it('takes a patch the colour of what lies under the patch around it as seen through a hole, which stays', () => {
    const patches = stacked([ground, panel, rectangle(badgeBox, CREAM)])
    expect(patches).toHaveLength(3)
    const [, middle, front] = patches
    expect(front?.parent).toBe(middle?.patch)
    expect(front?.seenThrough).toBe(true)
    expect(front?.primitive).toBeNull()
    expect(middle?.holes).toHaveLength(1)
    expect(middle?.closes).toBe(false)
  })

  it('finds a rectangle and an ellipse as primitives where they were drawn', () => {
    const discBox = { x: 130, y: 80, width: 50, height: 50 }
    const patches = stacked([rectangle({ x: 20, y: 20, width: 90, height: 60 }, BLUE), ellipse(discBox, CORAL)])
    const block = primitiveOf(ofColour(patches, 37, 99, 235))
    expect(block.stroke).toBe(0)
    expect(block.shape).toMatchObject({ kind: 'rect', corners: [0, 0, 0, 0], rotation: 0 })
    expect(Math.abs(block.shape.width - 90)).toBeLessThan(0.5)
    expect(Math.abs(block.shape.height - 60)).toBeLessThan(0.5)
    const disc = primitiveOf(ofColour(patches, 242, 118, 90))
    expect(disc.shape.kind).toBe('ellipse')
    expect(Math.abs(disc.shape.cx - 155)).toBeLessThan(0.5)
    expect(Math.abs(disc.shape.width - 50)).toBeLessThan(0.5)
  })

  it('finds a ring with one hole of its own shape as that shape with a stroke of the ring’s width', () => {
    const ring = primitiveOf(
      stacked([stroked({ kind: 'ellipse' }, { x: 50, y: 20, width: 100, height: 100 }, VIOLET, 8)])[0],
    )
    expect(ring.shape.kind).toBe('ellipse')
    expect(Math.abs(ring.shape.width - 100)).toBeLessThan(1)
    expect(Math.abs(ring.stroke - 8)).toBeLessThan(0.5)
    const outline = primitiveOf(stacked([stroked({ kind: 'rect', cornerRadius: 10 }, panelBox, VIOLET, 6)])[0])
    expect(outline.shape.kind).toBe('rect')
    expect(Math.abs(outline.shape.width - 160)).toBeLessThan(1)
    expect(Math.abs(outline.stroke - 6)).toBeLessThan(0.5)
  })

  it('takes a ring whose hole one shape of its kind fills as that shape’s border', () => {
    const card = { x: 30, y: 40, width: 240, height: 160 }
    const patches = stacked([stroked({ kind: 'rect', cornerRadius: 0 }, card, NAVY, 10, WHITE)], 300, 240)
    expect(patches).toHaveLength(2)
    const ring = ofColour(patches, 21, 34, 74)
    const fill = ofColour(patches, 255, 255, 255)
    expect(ring.border?.filler).toBe(fill)
    expect(Math.abs((ring.border?.width ?? NaN) - 10)).toBeLessThan(0.5)
    expect(fill.absorbed).toBe(true)
    expect(ring.absorbed).toBe(false)
    expect(Math.abs(primitiveOf(ring).shape.width - 240)).toBeLessThan(1)
  })

  it('finds a rectangle half under a smaller disc whole', () => {
    const patches = stacked([panel, ellipse({ x: 110, y: 50, width: 80, height: 80 }, CORAL)], 220, 150)
    expect(patches).toHaveLength(2)
    const under = primitiveOf(ofColour(patches, 37, 99, 235)).shape
    expect(under.kind).toBe('rect')
    expect(Math.abs(under.cx - 100)).toBeLessThan(1)
    expect(Math.abs(under.cy - 70)).toBeLessThan(1)
    expect(Math.abs(under.width - 160)).toBeLessThan(1)
    expect(Math.abs(under.height - 100)).toBeLessThan(1)
    expect(primitiveOf(ofColour(patches, 242, 118, 90)).shape.kind).toBe('ellipse')
  })

  it('finds patches of one colour that a patch on them cuts apart as one surface under it', () => {
    // A blue block with an ink bar across it from edge to edge: the block shows above the bar and below it.
    const block = { x: 20, y: 20, width: 160, height: 100 }
    const patches = stacked([rectangle(block, BLUE), rectangle({ x: 20, y: 60, width: 160, height: 20 }, INK)])
    const blues = patches.filter((s) => Math.round(s.patch.rgb[2]) === 235)
    expect(blues).toHaveLength(2)
    const [first, second] = blues
    expect(Math.abs(primitiveOf(first).shape.height - 100)).toBeLessThan(1)
    expect(first?.closes).toBe(true)
    expect(second?.absorbed).toBe(true)
  })

  it('finds no primitive in a rectangle with a bump on one side', () => {
    const block = rectangle({ x: 30, y: 40, width: 240, height: 160 }, NAVY)
    const [plain, ...others] = stacked([block], 300, 240)
    expect(others).toEqual([])
    expect(primitiveOf(plain).shape.kind).toBe('rect')
    // A bump of 30 × 6 px on its top edge.
    const [bumped, ...more] = stacked([block, rectangle({ x: 120, y: 34, width: 30, height: 6 }, NAVY)], 300, 240)
    expect(more).toEqual([])
    expect(bumped?.primitive).toBeNull()
  })

  it('finds a shape whole that holds a patch too small to be a graphic', () => {
    for (const crumb of [0, 2]) {
      const { patch, patchOf } = cutWithCrumb(crumb, 9)
      const [only, ...others] = stack([patch], patchOf, 100, 60)
      expect(others).toEqual([])
      const { shape } = primitiveOf(only)
      expect(shape.kind).toBe('rect')
      expect(Math.abs(shape.width - 80)).toBeLessThan(1)
      expect(Math.abs(shape.height - 40)).toBeLessThan(1)
    }
  })
})
