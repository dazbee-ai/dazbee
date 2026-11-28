import { describe, expect, it } from 'vitest'

import type { Pixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'

import { looksSame } from '../looks-same/rule.ts'
import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { graphicsOf, regularOf } from './graphics.ts'
import { toFloatPicture } from './parts/float-picture.ts'
import { gradientOf } from './patch-gradient.ts'
import type { Stacked } from './stacking.ts'
import { bandAndDisc, expectBox, expectColour, flatFill, HEIGHT, onlyOne, stackedOf, WIDTH } from './test-matching.ts'
import { ellipse, graphic, rectangle, stroked, SUNSET } from './test-pieces.ts'

const ck = await loadCanvasKit()
const BLUE = '#2563EBFF'
const CORAL = '#F2765AFF'
const RED = '#DC2626FF'
const INK = '#111827FF'
const NAVY = '#15224AFF'
const VIOLET = '#7C3AEDFF'
const WHITE = '#FFFFFFFF'

/** A piece's stacked patches as the matcher makes graphics of them: each with its gradient and the regular shape it is. */
const shaped = (piece: Pixels, hidden?: Uint8Array): Stacked[] => {
  const { split, stacked } = stackedOf(piece, hidden)
  const worked = toFloatPicture(piece)
  for (const s of stacked) s.gradient = gradientOf(s.patch, worked, split.patchOf, hidden)
  for (const s of stacked) s.regular = regularOf(ck, s, split.patchOf, split.width)
  return stacked
}

/**
 * The graphics made of graphics drawn as a piece, 200 × 140 when no size is given, with its shapes drawn as
 * shapes. Drawn, they look the same as the piece by the rule.
 */
const made = (layers: ShapeLayer[], width = WIDTH, height = HEIGHT): ShapeLayer[] => {
  const piece = drawGraphics(ck, layers, width, height)
  const graphics = graphicsOf(shaped(piece), true, 1)
  expect(graphics.pixels).toHaveLength(graphics.layers.length)
  expect(looksSame('shape', piece, drawGraphics(ck, graphics.layers, width, height)).same).toBe(true)
  return graphics.layers
}

/** The one graphic made of graphics drawn as a piece. */
const madeAsOne = (layers: ShapeLayer[], width = WIDTH, height = HEIGHT): ShapeLayer =>
  onlyOne(made(layers, width, height))

/** A regular polygon or star of one colour in a box. */
const regular = (shape: Parameters<typeof graphic>[0], box: Parameters<typeof graphic>[1]): ShapeLayer =>
  graphic(shape, box, { fill: { type: 'solid', color: '#0891B2FF' } })

/** The regular polygon or star that the one patch of a graphic drawn as a piece is, or null. */
const regularIn = (layer: ShapeLayer, width = WIDTH, height = HEIGHT) => {
  const { split, stacked } = stackedOf(drawGraphics(ck, [layer], width, height))
  return regularOf(ck, onlyOne(stacked), split.patchOf, split.width)
}

const panelBox = { x: 20, y: 20, width: 160, height: 100 }
const panel = rectangle(panelBox, BLUE, 12)
const squareBox = { x: 50, y: 20, width: 100, height: 100 }
const star = { kind: 'star', points: 5, innerRadius: 0.382, cornerRadius: 0 } as const
const starBox = { x: 30, y: 20, width: 200, height: 200 }
/** A white card with a navy border inside its edge. */
const card = stroked({ kind: 'rect', cornerRadius: 0 }, { x: 30, y: 40, width: 240, height: 160 }, NAVY, 10, WHITE)
/** A tick with a dot to each side of it, all of one colour: an icon of loose parts. */
const icon = [
  graphic(
    {
      kind: 'path',
      d: 'M10 55 L25 40 L42 57 L78 18 L92 32 L42 88 Z',
      fillRule: 'nonzero',
      drawnIn: { width: 100, height: 100 },
    },
    { x: 30, y: 10, width: 100, height: 100 },
    { fill: { type: 'solid', color: INK } },
  ),
  ellipse({ x: 10, y: 14, width: 14, height: 14 }, INK),
  ellipse({ x: 136, y: 90, width: 14, height: 14 }, INK),
]

describe('graphicsOf', () => {
  it('draws a rectangle as a rect graphic and a circle as an ellipse, at 40 px and at 300 px too', () => {
    const block = madeAsOne([rectangle(panelBox, BLUE)])
    expect(block.props.shape).toEqual({ kind: 'rect', cornerRadius: 0 })
    expectBox(block, panelBox)
    expect(block.props.rotation).toBe(0)
    expect(block.props.fills).toEqual([{ type: 'solid', color: BLUE }])
    expect(block.props.strokes).toEqual([])
    const disc = madeAsOne([ellipse(squareBox, RED)])
    expect(disc.props.shape).toEqual({ kind: 'ellipse' })
    expectBox(disc, squareBox)
    expect(flatFill(disc)).toEqual({ type: 'solid', color: RED })
    const small = madeAsOne([ellipse({ x: 4, y: 4, width: 32, height: 32 }, RED)], 40, 40)
    expect(small.props.shape).toEqual({ kind: 'ellipse' })
    expectBox(small, { x: 4, y: 4, width: 32, height: 32 })
    const large = madeAsOne([ellipse({ x: 20, y: 20, width: 260, height: 260 }, RED)], 300, 300)
    expect(large.props.shape).toEqual({ kind: 'ellipse' })
    expectBox(large, { x: 20, y: 20, width: 260, height: 260 })
  })

  it('draws a rounded rectangle with its radius, and each corner’s own', () => {
    const rounded = madeAsOne([panel])
    expectBox(rounded, panelBox)
    expect(rounded.props.shape.kind === 'rect' && Math.abs(rounded.props.shape.cornerRadius - 12)).toBeLessThan(1)
    const radii = [0, 30, 0, 14] as const
    const tab = madeAsOne([
      graphic({ kind: 'rect', cornerRadius: 0, corners: [...radii] }, panelBox, {
        fill: { type: 'solid', color: BLUE },
      }),
    ])
    expectBox(tab, panelBox)
    const corners = tab.props.shape.kind === 'rect' ? tab.props.shape.corners : undefined
    expect(corners).toHaveLength(4)
    // The round corners have their radii, and the square ones stay all but square.
    expect(Math.abs((corners?.[1] ?? NaN) - 30)).toBeLessThan(1)
    expect(Math.abs((corners?.[3] ?? NaN) - 14)).toBeLessThan(1)
    expect(corners?.[0]).toBeLessThan(3)
    expect(corners?.[2]).toBeLessThan(3)
  })

  it('draws a turned rectangle with its turn', () => {
    const box = { x: 40, y: 40, width: 120, height: 60, rotation: -30 }
    const layer = madeAsOne([rectangle(box, BLUE)])
    expect(layer.props.shape.kind).toBe('rect')
    expectBox(layer, box)
    expect(Math.abs(layer.props.rotation + 30)).toBeLessThan(0.5)
  })

  it('draws a long thin rectangle as a line with a stroke of its width', () => {
    const line = graphic(
      { kind: 'line', start: 'none', end: 'none' },
      { x: 20, y: 28, width: 200, height: 4 },
      { stroke: { paint: { type: 'solid', color: INK }, width: 4, align: 'center', cap: 'butt' } },
    )
    const layer = madeAsOne([line], 240, 60)
    expect(layer.props.shape).toMatchObject({ kind: 'line', start: 'none', end: 'none' })
    expectBox(layer, { x: 20, y: 28, width: 200, height: 4 })
    expect(layer.props.fills).toEqual([])
    expect(layer.props.strokes).toHaveLength(1)
    expect(layer.props.strokes[0]).toMatchObject({ paint: { type: 'solid', color: INK }, cap: 'butt' })
    expect(layer.props.strokes[0]?.width).toBeCloseTo(4, 0)
  })

  it('draws a ring and a rectangle’s outline as stroked shapes with no fill', () => {
    const ring = madeAsOne([stroked({ kind: 'ellipse' }, squareBox, VIOLET, 8)])
    expect(ring.props.shape).toEqual({ kind: 'ellipse' })
    expectBox(ring, squareBox)
    expect(ring.props.fills).toEqual([])
    expect(ring.props.strokes[0]).toMatchObject({ paint: { type: 'solid', color: VIOLET }, align: 'inside' })
    expect(Math.abs((ring.props.strokes[0]?.width ?? NaN) - 8)).toBeLessThan(0.5)
    const outline = madeAsOne([stroked({ kind: 'rect', cornerRadius: 10 }, panelBox, VIOLET, 6)])
    expect(outline.props.shape.kind).toBe('rect')
    expectBox(outline, panelBox)
    expect(outline.props.fills).toEqual([])
    expect(Math.abs((outline.props.strokes[0]?.width ?? NaN) - 6)).toBeLessThan(0.5)
  })

  it('draws a shape and its border as one graphic, and traced, the border and the fill inside it as two paths', () => {
    const stacked = shaped(drawGraphics(ck, [card], 300, 240))
    const bordered = onlyOne(graphicsOf(stacked, true, 1).layers)
    expect(bordered.props.shape.kind).toBe('rect')
    expectBox(bordered, { x: 30, y: 40, width: 240, height: 160 })
    expectColour(flatFill(bordered).color, WHITE)
    expect(bordered.props.strokes).toHaveLength(1)
    expect(bordered.props.strokes[0]).toMatchObject({ paint: { type: 'solid', color: NAVY }, align: 'inside' })
    expect(Math.abs((bordered.props.strokes[0]?.width ?? NaN) - 10)).toBeLessThan(0.5)
    const [ring, fill, ...others] = graphicsOf(stacked, false, 1).layers
    expect(others).toEqual([])
    if (!ring || !fill) throw new Error('fewer than two graphics')
    expect([ring.props.shape.kind, fill.props.shape.kind]).toEqual(['path', 'path'])
    expectColour(flatFill(ring).color, NAVY)
    expectBox(ring, { x: 30, y: 40, width: 240, height: 160 })
    expectColour(flatFill(fill).color, WHITE)
    expectBox(fill, { x: 40, y: 50, width: 220, height: 140 })
  })

  it('draws a patch fitted as a regular polygon or a star as that shape', () => {
    for (const sides of [3, 6]) {
      const layer = madeAsOne([regular({ kind: 'polygon', sides, cornerRadius: 0 }, squareBox)])
      expect(layer.props.shape).toMatchObject({ kind: 'polygon', sides })
      expectBox(layer, squareBox, 1.5)
      expect(Math.abs(layer.props.rotation)).toBeLessThan(1)
    }
    const layer = madeAsOne([regular(star, starBox)], 260, 240)
    expect(layer.props.shape).toMatchObject({ kind: 'star', points: 5 })
    expect(layer.props.shape.kind === 'star' && Math.abs(layer.props.shape.innerRadius - 0.382)).toBeLessThan(0.03)
    expectBox(layer, starBox, 3)
    expect(Math.abs(layer.props.rotation)).toBeLessThan(1)
  })

  it('fills a patch that shades as a linear gradient with a gradient along the way it runs', () => {
    const box = { x: 10, y: 10, width: 220, height: 100 }
    const layer = madeAsOne([graphic({ kind: 'rect', cornerRadius: 0 }, box, { fill: SUNSET })], 240, 120)
    expect(layer.props.shape.kind).toBe('rect')
    expectBox(layer, box)
    const [fill] = layer.props.fills
    if (fill?.type !== 'linear') throw new Error(`a ${fill?.type} fill`)
    // It runs from left to right, level.
    expect(fill.to.x - fill.from.x).toBeGreaterThan(0.8)
    expect(Math.abs(fill.to.y - fill.from.y)).toBeLessThan(0.05)
    expectColour(fill.stops[0]?.color, '#FDE68AFF')
    expectColour(fill.stops.at(-1)?.color, '#B91C1CFF')
  })

  it('draws two overlapping shapes as two graphics, back to front, the one behind whole', () => {
    const discBox = { x: 110, y: 50, width: 80, height: 80 }
    const [back, front, ...others] = made([panel, ellipse(discBox, CORAL)], 220, 150)
    expect(others).toEqual([])
    if (!back || !front) throw new Error('fewer than two graphics')
    expect(back.props.shape.kind).toBe('rect')
    expectBox(back, panelBox)
    expectColour(flatFill(back).color, BLUE)
    expect(front.props.shape).toEqual({ kind: 'ellipse' })
    expectBox(front, discBox)
    expectColour(flatFill(front).color, CORAL)
  })

  it('gives a see-through patch a fill with an opacity under 1', () => {
    const layer = madeAsOne([
      graphic({ kind: 'rect', cornerRadius: 12 }, panelBox, { fill: { type: 'solid', color: INK, opacity: 0.5 } }),
    ])
    expect(layer.props.shape.kind).toBe('rect')
    expectBox(layer, panelBox)
    const fill = flatFill(layer)
    expect(fill.color).toBe(INK)
    expect(fill.opacity).toBeCloseTo(0.5, 1)
  })

  it('draws loose patches of one colour, an icon’s parts, as one path', () => {
    const layer = madeAsOne(icon, 160, 120)
    expect(layer.props.shape.kind).toBe('path')
    // It reaches from the first dot to the second.
    expectBox(layer, { x: 10, y: 14, width: 140, height: 90 })
    expect(flatFill(layer)).toEqual({ type: 'solid', color: INK })
  })

  it('traces every patch as a path when the shapes are not drawn as shapes', () => {
    const discBox = { x: 110, y: 50, width: 80, height: 80 }
    const piece = drawGraphics(ck, [panel, ellipse(discBox, CORAL)], 220, 150)
    const { layers, pixels } = graphicsOf(shaped(piece), false, 1)
    expect(layers.map((layer) => layer.props.shape.kind)).toEqual(['path', 'path'])
    expect(looksSame('shape', piece, drawGraphics(ck, layers, 220, 150)).same).toBe(true)
    // Each graphic comes with the pixels of the patch it draws: the disc's are its area.
    expect(pixels[1]).toBeCloseTo(Math.PI * 40 * 40, -2)
  })

  it('scales the graphics by `grow`, piece pixels to a worked one', () => {
    const ring = stroked({ kind: 'ellipse' }, { x: 200, y: 20, width: 100, height: 100 }, VIOLET, 8)
    const stacked = shaped(drawGraphics(ck, [panel, ring], 320, HEIGHT))
    for (const shapes of [true, false]) {
      const once = graphicsOf(stacked, shapes, 1).layers
      const twice = graphicsOf(stacked, shapes, 2).layers
      expect(once).toHaveLength(2)
      expect(twice).toHaveLength(2)
      once.forEach(({ props }, i) => {
        const grown = twice[i]
        if (!grown) throw new Error('a graphic is missing')
        expectBox(grown, { x: props.x * 2, y: props.y * 2, width: props.width * 2, height: props.height * 2 }, 0.01)
      })
    }
    // A shape's radius and its stroke's width grow with it.
    const [rounded, outline] = graphicsOf(stacked, true, 2).layers
    if (rounded?.props.shape.kind !== 'rect') throw new Error(`a ${rounded?.props.shape.kind}`)
    expect(Math.abs(rounded.props.shape.cornerRadius - 24)).toBeLessThan(2)
    expect(Math.abs((outline?.props.strokes[0]?.width ?? NaN) - 16)).toBeLessThan(1)
  })

  it('draws a patch other layers hide all of as the piece holds it, in the colour it was cut by', () => {
    const { piece, hidden } = bandAndDisc()
    const { layers } = graphicsOf(shaped(piece, hidden), true, 1)
    expect(layers.map((layer) => layer.props.shape.kind)).toEqual(['rect', 'rect', 'ellipse'])
    // The white beside the band, the band, and the disc under the hidden box, red as the band.
    const [white, band, disc] = layers
    if (!white || !band || !disc) throw new Error('fewer than three graphics')
    expectBox(white, { x: 100, y: 0, width: 200, height: 200 })
    expectBox(band, { x: 0, y: 0, width: 100, height: 200 })
    expectBox(disc, { x: 190, y: 70, width: 60, height: 60 })
    expectColour(flatFill(disc).color, '#DC2626FF')
  })
})

describe('regularOf', () => {
  it('fits a five-point star as a star of five points', () => {
    const fit = regularIn(regular(star, starBox), 260, 240)
    expect(fit).toMatchObject({ kind: 'star', count: 5 })
    expect(Math.abs((fit?.innerRadius ?? NaN) - 0.382)).toBeLessThan(0.03)
    expect(Math.abs((fit?.cx ?? NaN) - 130)).toBeLessThan(2)
  })

  it('fits a hexagon as a polygon of six sides and a triangle as one of three', () => {
    for (const sides of [6, 3]) {
      const fit = regularIn(regular({ kind: 'polygon', sides, cornerRadius: 0 }, squareBox))
      expect(fit).toMatchObject({ kind: 'polygon', count: sides })
      expect(Math.abs((fit?.width ?? NaN) - 100)).toBeLessThan(1.5)
    }
  })

  it('fits nothing to a circle or a rectangle, which are shapes of their own', () => {
    expect(regularIn(ellipse(squareBox, RED))).toBeNull()
    expect(regularIn(rectangle(panelBox, BLUE))).toBeNull()
  })

  it('fits nothing to a patch that does not repeat round its centre', () => {
    const [tick] = icon
    if (!tick) throw new Error('no tick')
    expect(regularIn(tick, 160, 120)).toBeNull()
  })
})
