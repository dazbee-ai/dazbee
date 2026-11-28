import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { marchingSquares } from './outlines.ts'
import { distanceTo, fitPrimitives, type Primitive } from './primitives.ts'
import { ellipse, graphic, rectangle } from './test-pieces.ts'

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

/** The rectangle and the ellipse fitted to a graphic's outline, the closer first; fitted twice, the same both times. */
const fitted = (layer: ShapeLayer): Primitive[] => {
  const points = outlineOf(layer)
  const fits = fitPrimitives(points)
  expect(fitPrimitives(points)).toEqual(fits)
  return fits.sort((a, b) => a.mean - b.mean)
}

/** The closer of the two primitives fitted to a graphic's outline. */
const closest = (layer: ShapeLayer): Primitive => {
  const [first] = fitted(layer)
  if (!first) throw new Error('no primitive was fitted')
  return first
}

/**
 * The outline of a level rectangle of whole pixels, `width` × `height` at (`x0`, `y0`): a point for each pixel of
 * its perimeter, clockwise from its top left corner. The two points beside each corner lie `swell` pixels outside
 * the rectangle, as a cut's outline does round a square corner.
 */
const perimeter = (x0: number, y0: number, width: number, height: number, swell = 0): Float32Array => {
  const out = (k: number, count: number) => (k === 0 || k === count - 1 ? swell : 0)
  const xy: number[] = []
  for (let x = 0; x < width; x++) xy.push(x0 + x + 0.5, y0 - out(x, width))
  for (let y = 0; y < height; y++) xy.push(x0 + width + out(y, height), y0 + y + 0.5)
  for (let x = width - 1; x >= 0; x--) xy.push(x0 + x + 0.5, y0 + height + out(x, width))
  for (let y = height - 1; y >= 0; y--) xy.push(x0 - out(y, height), y0 + y + 0.5)
  return Float32Array.from(xy)
}

/** Expects a primitive to have a box's centre and size within half a pixel, and its turn within half a degree. */
const expectPlaced = (
  fit: Primitive,
  box: { x: number; y: number; width: number; height: number; rotation?: number },
) => {
  expect(Math.abs(fit.cx - (box.x + box.width / 2))).toBeLessThan(0.5)
  expect(Math.abs(fit.cy - (box.y + box.height / 2))).toBeLessThan(0.5)
  expect(Math.abs(fit.width - box.width)).toBeLessThan(0.5)
  expect(Math.abs(fit.height - box.height)).toBeLessThan(0.5)
  expect(Math.abs(fit.rotation - (box.rotation ?? 0))).toBeLessThan(0.5)
}

/** Expects a primitive to be the box's shape: placed as it, with the outline it was fitted to within half a pixel of it all the way round. */
const expectBox = (fit: Primitive, box: Parameters<typeof expectPlaced>[1]) => {
  expectPlaced(fit, box)
  expect(fit.max).toBeLessThan(0.5)
}

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

describe('fitPrimitives', () => {
  it('gives a rectangle back as itself, with square corners', () => {
    const box = { x: 30, y: 30, width: 140, height: 80 }
    const fit = closest(rectangle(box, INK))
    expect(fit.kind).toBe('rect')
    expectBox(fit, box)
    expect(fit.corners).toEqual([0, 0, 0, 0])
  })

  it('gives a rectangle of any size square corners, also where its outline swells a little beside each corner', () => {
    const sizes = [
      [40, 218],
      [73, 406],
      [500, 300],
      [300, 47],
      [218, 40],
      [44, 218],
      [20, 100],
    ] as const
    for (const [width, height] of sizes)
      for (const swell of [0, 0.09]) {
        const rect = fitPrimitives(perimeter(30, 20, width, height, swell)).find((fit) => fit.kind === 'rect')
        if (!rect) throw new Error('no rectangle was fitted')
        expectPlaced(rect, { x: 30, y: 20, width, height })
        expect(rect.corners).toEqual([0, 0, 0, 0])
      }
  })

  it('gives a rectangle drawn between pixels back where it was drawn', () => {
    const box = { x: 30.4, y: 30.7, width: 140.3, height: 80.5 }
    const fit = closest(rectangle(box, INK))
    expect(fit.kind).toBe('rect')
    expectBox(fit, box)
  })

  it('gives each corner of a rounded rectangle its own radius', () => {
    const box = { x: 30, y: 30, width: 140, height: 80 }
    const radii = [0, 30, 0, 14] as const
    const fit = closest(
      graphic({ kind: 'rect', cornerRadius: 0, corners: [...radii] }, box, { fill: { type: 'solid', color: INK } }),
    )
    expect(fit.kind).toBe('rect')
    expectBox(fit, box)
    fit.corners.forEach((radius, i) => expect(Math.abs(radius - (radii[i] ?? 0))).toBeLessThan(0.5))
  })

  it('gives a rectangle with one radius that radius at every corner, and a pill its half height', () => {
    const box = { x: 30, y: 30, width: 140, height: 80 }
    const rounded = closest(rectangle(box, INK, 12))
    expectBox(rounded, box)
    expect(new Set(rounded.corners).size).toBe(1)
    expect(Math.abs(rounded.corners[0] - 12)).toBeLessThan(0.5)
    const pill = closest(rectangle(box, INK, 40))
    expect(pill.kind).toBe('rect')
    expectBox(pill, box)
    pill.corners.forEach((radius) => expect(Math.abs(radius - 40)).toBeLessThan(0.5))
  })

  it('gives a turned rectangle back with its turn', () => {
    for (const rotation of [20, -30]) {
      const box = { x: 40, y: 40, width: 120, height: 60, rotation }
      const fit = closest(rectangle(box, INK))
      expect(fit.kind).toBe('rect')
      expectBox(fit, box)
    }
  })

  it('gives a circle back as an ellipse as wide as it is tall, unturned', () => {
    const box = { x: 50, y: 20, width: 100, height: 100 }
    const fit = closest(ellipse(box, INK))
    expect(fit.kind).toBe('ellipse')
    expectBox(fit, box)
    expect(fit.width).toBe(fit.height)
  })

  it('gives an ellipse back as itself, level or turned', () => {
    for (const rotation of [0, 25]) {
      const box = { x: 30, y: 35, width: 140, height: 70, rotation }
      const fit = closest(ellipse(box, INK))
      expect(fit.kind).toBe('ellipse')
      expectBox(fit, box)
    }
  })

  it('finds an L close to neither a rectangle nor an ellipse', () => {
    const fits = fitted(corner)
    expect(fits.map((fit) => fit.kind).sort()).toEqual(['ellipse', 'rect'])
    // Its outline strays many pixels from both.
    for (const fit of fits) {
      expect(fit.mean).toBeGreaterThan(4)
      expect(fit.max).toBeGreaterThan(20)
    }
  })

  it('finds a shape whole from the part of its outline that counts', () => {
    // A rectangle with a bite out of its right side, whose points are marked free with a pixel around them: another
    // patch lies over it there.
    const box = { x: 30, y: 30, width: 140, height: 80 }
    const bitten = graphic(
      {
        kind: 'path',
        d: 'M0 0 L140 0 L140 20 L110 20 L110 60 L140 60 L140 80 L0 80 Z',
        fillRule: 'nonzero',
        drawnIn: { width: 140, height: 80 },
      },
      box,
      { fill: { type: 'solid', color: INK } },
    )
    const points = outlineOf(bitten)
    const free = Uint8Array.from({ length: points.length / 2 }, (_, k) => {
      const x = points[k * 2] ?? 0
      const y = points[k * 2 + 1] ?? 0
      return x > 108 && y > 48 && y < 92 ? 1 : 0
    })
    const whole = fitPrimitives(points, free).find((fit) => fit.kind === 'rect')
    if (!whole) throw new Error('no rectangle was fitted')
    expectPlaced(whole, box)
    const all = fitPrimitives(points).find((fit) => fit.kind === 'rect')
    expect(all?.max).toBeGreaterThan(5)
  })

  it('fits nothing to an outline of a few points', () => {
    expect(fitPrimitives(Float32Array.from([0, 0, 10, 0, 10, 10, 0, 10]))).toEqual([])
  })
})

describe('distanceTo', () => {
  it('is below 0 inside a rectangle, 0 on its edge and the distance outside it', () => {
    const fit = closest(rectangle({ x: 30, y: 30, width: 140, height: 80 }, INK))
    expect(distanceTo(fit, 100, 70)).toBeCloseTo(-40, 1)
    expect(distanceTo(fit, 30, 70)).toBeCloseTo(0, 1)
    expect(distanceTo(fit, 20, 70)).toBeCloseTo(10, 1)
    expect(distanceTo(fit, 100, 120)).toBeCloseTo(10, 1)
    // Past a corner it is the distance to the corner.
    expect(distanceTo(fit, 173, 114)).toBeCloseTo(5, 1)
  })

  it('measures from a rounded corner’s arc', () => {
    const fit = closest(rectangle({ x: 30, y: 30, width: 140, height: 80 }, INK, 40))
    // The pill's right end is a half circle round (130, 70).
    expect(distanceTo(fit, 130 + 40 * Math.SQRT1_2, 70 + 40 * Math.SQRT1_2)).toBeCloseTo(0, 0)
    expect(distanceTo(fit, 168, 32)).toBeGreaterThan(10)
  })

  it('follows a turned rectangle', () => {
    const fit = closest(rectangle({ x: 40, y: 40, width: 120, height: 60, rotation: 90 }, INK))
    // Turned a quarter, it is 60 wide and 120 tall round (100, 70).
    expect(distanceTo(fit, 100, 20)).toBeCloseTo(-10, 0)
    expect(distanceTo(fit, 140, 70)).toBeCloseTo(10, 0)
  })

  it('is below 0 inside an ellipse and 0 on its edge', () => {
    const fit = closest(ellipse({ x: 30, y: 35, width: 140, height: 70 }, INK))
    expect(distanceTo(fit, 100, 70)).toBeCloseTo(-35, 0)
    expect(distanceTo(fit, 170, 70)).toBeCloseTo(0, 0)
    expect(distanceTo(fit, 100, 35)).toBeCloseTo(0, 0)
    expect(distanceTo(fit, 180, 70)).toBeCloseTo(10, 0)
  })
})
