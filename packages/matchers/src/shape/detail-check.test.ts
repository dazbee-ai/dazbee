import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import type { Rgb } from '@dazbee/schema'

import { type Detail, detailOf, judgedScale } from './detail-check.ts'
import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { ellipse, graphic, rectangle, shadowed } from './test-pieces.ts'

const ck = await loadCanvasKit()
const BLUE = '#2563EBFF'
const WHITE = '#FFFFFFFF'
const WIDTH = 200
const HEIGHT = 140

/** What the check reads of a rebuild's graphics against a piece's, both drawn on a 200 × 140 piece unless a size is given. */
const read = (
  piece: ShapeLayer[],
  rebuild: ShapeLayer[],
  { width = WIDTH, height = HEIGHT, behind }: { width?: number; height?: number; behind?: Rgb } = {},
): Detail => {
  const detail = detailOf(drawGraphics(ck, piece, width, height), drawGraphics(ck, rebuild, width, height), behind)
  // The same pictures read the same again.
  expect(detailOf(drawGraphics(ck, piece, width, height), drawGraphics(ck, rebuild, width, height), behind)).toEqual(
    detail,
  )
  return detail
}

const panel = rectangle({ x: 20, y: 20, width: 160, height: 100 }, BLUE, 12)
const pill = rectangle({ x: 30, y: 40, width: 140, height: 48 }, '#16A34AFF', 24)
/** A square with a square hole in its middle, 20 px a side. */
const holed = graphic(
  {
    kind: 'path',
    d: 'M0 0 H100 V100 H0 Z M40 40 V60 H60 V40 Z',
    fillRule: 'evenodd',
    drawnIn: { width: 100, height: 100 },
  },
  { x: 50, y: 20, width: 100, height: 100 },
  { fill: { type: 'solid', color: BLUE } },
)

describe('judgedScale', () => {
  it('judges a piece of 192 to 512 px at its own size', () => {
    expect(judgedScale({ width: 200, height: 140 })).toBe(1)
    expect(judgedScale({ width: 512, height: 300 })).toBe(1)
  })

  it('judges a small piece enlarged, at most four times', () => {
    expect(judgedScale({ width: 96, height: 60 })).toBe(2)
    expect(judgedScale({ width: 40, height: 40 })).toBe(4)
    expect(judgedScale({ width: 20, height: 20 })).toBe(4)
  })

  it('judges a thin piece by its short side, enlarged until its long side is 512 px', () => {
    // 60 px tall, it is judged as it is; 6 px tall, it is enlarged, though it is as long.
    expect(judgedScale({ width: 300, height: 60 })).toBe(1)
    expect(judgedScale({ width: 300, height: 6 })).toBeCloseTo(512 / 300, 10)
    expect(judgedScale({ width: 200, height: 8 })).toBe(1.5)
  })

  it('judges a large piece shrunk to 512 px on its long side', () => {
    expect(judgedScale({ width: 1024, height: 300 })).toBe(0.5)
    expect(judgedScale({ width: 300, height: 2048 })).toBe(0.25)
  })
})

describe('detailOf', () => {
  it('reads no blob and no halo in a piece against itself', () => {
    const detail = read([panel], [panel])
    expect(detail).toMatchObject({ seen: 0, blob: 0, blobs: 0, halo: 0, width: WIDTH, height: HEIGHT })
    expect(detail.different.some((pixel) => pixel === 1)).toBe(false)
  })

  it('reads none where an edge is a pixel off, or softer', () => {
    const shifted = rectangle({ x: 21, y: 20, width: 160, height: 100 }, BLUE, 12)
    expect(read([panel], [shifted])).toMatchObject({ blob: 0, halo: 0 })
    // Half a pixel wider all round, so every edge pixel is half covered.
    const softer = rectangle({ x: 19.5, y: 19.5, width: 161, height: 101 }, BLUE, 12.5)
    expect(read([panel], [softer])).toMatchObject({ blob: 0, halo: 0 })
  })

  it('reads a blob where the whole shape is three pixels off', () => {
    const moved = rectangle({ x: 23, y: 20, width: 160, height: 100 }, BLUE, 12)
    expect(read([panel], [moved]).blob).toBeGreaterThan(100)
  })

  it('reads a blob the size of a small part that is missing, whichever picture misses it', () => {
    // A dot of 10 px, 0.5% of the panel.
    const dot = ellipse({ x: 140, y: 40, width: 10, height: 10 }, WHITE)
    const dotPixels = Math.PI * 5 * 5
    const missing = read([panel, dot], [panel])
    expect(missing.blob).toBeGreaterThan(dotPixels * 0.75)
    expect(missing.blob).toBeLessThan(dotPixels * 2)
    expect(missing.halo).toBe(0)
    // The pixels seen as different are the dot's.
    expect(missing.different[45 * WIDTH + 145]).toBe(1)
    expect(missing.different[90 * WIDTH + 60]).toBe(0)
    expect(read([panel], [panel, dot]).blob).toBe(missing.blob)
  })

  it('reads a blob where a hole is filled', () => {
    const filled = rectangle({ x: 50, y: 20, width: 100, height: 100 }, BLUE)
    const detail = read([holed], [filled])
    expect(detail.blob).toBeGreaterThan(20 * 20 * 0.75)
    expect(detail.blob).toBeLessThan(20 * 20 * 1.5)
  })

  it('reads a blob over the whole of a rebuild in another colour', () => {
    const detail = read([panel], [rectangle({ x: 20, y: 20, width: 160, height: 100 }, '#7446B2FF', 12)])
    expect(detail.seen).toBe(1)
    expect(detail.blobs).toBe(1)
  })

  it('reads a missing soft shadow as halo, and a missing glow', () => {
    const shadow = shadowed(pill, { x: 0, y: 8, blur: 16, color: '#00000066' })
    const lost = read([shadow], [pill])
    expect(lost.halo).toBeGreaterThan(500)
    // A shadow fades into what is behind it: its loss is no difference in shape.
    expect(lost.blob).toBe(0)
    expect(read([shadow], [shadow]).halo).toBe(0)
    const glow = shadowed(pill, { x: 0, y: 0, blur: 18, color: '#F59E0BCC' })
    expect(read([glow], [pill]).halo).toBeGreaterThan(500)
  })

  it('reads no halo where the colour behind the piece is the shadow’s own', () => {
    const shadow = shadowed(pill, { x: 0, y: 8, blur: 16, color: '#00000066' })
    expect(read([shadow], [pill], { behind: [0, 0, 0] }).halo).toBe(0)
    expect(read([shadow], [pill], { behind: [255, 255, 255] }).halo).toBeGreaterThan(500)
  })

  it('judges a small piece enlarged, so a part of a few pixels missing in it reads a blob', () => {
    const disc = ellipse({ x: 4, y: 4, width: 32, height: 32 }, '#DC2626FF')
    const dot = ellipse({ x: 18, y: 18, width: 4, height: 4 }, WHITE)
    const same = read([disc], [disc], { width: 40, height: 40 })
    expect(same).toMatchObject({ blob: 0, halo: 0, width: 160, height: 160 })
    // 13 pixels of the piece are 16 times as many at the size judged.
    expect(read([disc, dot], [disc], { width: 40, height: 40 }).blob).toBeGreaterThan(100)
  })

  it('takes a rebuild as what draws it at the size judged', () => {
    const disc = ellipse({ x: 4, y: 4, width: 32, height: 32 }, '#DC2626FF')
    const piece = drawGraphics(ck, [disc], 40, 40)
    const scales: number[] = []
    const detail = detailOf(piece, (scale) => {
      scales.push(scale)
      return drawGraphics(ck, [disc], 40, 40, scale)
    })
    expect(scales).toEqual([4])
    expect(detail).toMatchObject({ blob: 0, halo: 0, width: 160, height: 160 })
  })
})
