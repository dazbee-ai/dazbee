import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { drawGraphics } from './draw-layers.ts'
import { FRINGE, fringeOf } from './fringe.ts'
import { type FloatPicture, toFloatPicture } from './parts/float-picture.ts'
import { rectangle, shadowed } from './test-pieces.ts'

const ck = await loadCanvasKit()

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** A picture 60 px a side, and a box of 20 px a side in its middle. */
const SIDE = 60
const BLOCK: Box = { x: 20, y: 20, width: 20, height: 20 }

/** A picture of black pixels, each with the alpha `alphaAt` gives it, 0 to 1. */
const pictureOf = (width: number, height: number, alphaAt: (x: number, y: number) => number): FloatPicture => {
  const data = new Float32Array(width * height * 4)
  for (let i = 0; i < width * height; i++) data[i * 4 + 3] = alphaAt(i % width, Math.floor(i / width))
  return { width, height, data }
}

/** A mask of `width` × `height` pixels, marking those `marked` says. */
const maskOf = (width: number, height: number, marked: (x: number, y: number) => boolean): Uint8Array =>
  Uint8Array.from({ length: width * height }, (_, i) => (marked(i % width, Math.floor(i / width)) ? 1 : 0))

/** How many pixels a pixel lies from a box, the farther of across and down: 0 inside it. */
const away = (box: Box, x: number, y: number): number =>
  Math.max(0, box.x - x, x - (box.x + box.width - 1), box.y - y, y - (box.y + box.height - 1))

/** How many pixels a mask marks. */
const marks = (mask: Uint8Array): number => mask.reduce((sum, mark) => sum + mark, 0)

describe('fringeOf', () => {
  it('marks a soft shadow that fades out beside a solid shape, and neither the shape nor the pixels beside it', () => {
    // A solid block, and round it a shadow of alpha 0.76 that loses 0.04 a pixel: covered up to 7 pixels away.
    const picture = pictureOf(SIDE, SIDE, (x, y) => {
      const d = away(BLOCK, x, y)
      return d === 0 ? 1 : Math.max(0, 0.8 - 0.04 * d)
    })
    const fringe = fringeOf(picture, 0.5, 1)
    expect(fringe).toEqual(maskOf(SIDE, SIDE, (x, y) => away(BLOCK, x, y) >= 2 && away(BLOCK, x, y) <= 7))
  })

  it('marks the covered pixels of a drawn shadow under a pill, and none of the pill', () => {
    const pill = rectangle({ x: 40, y: 30, width: 140, height: 48 }, '#16A34AFF', 24)
    const shadow = { x: 0, y: 16, blur: 16, color: '#000000CC' }
    const picture = toFloatPicture(drawGraphics(ck, [shadowed(pill, shadow)], 220, 140))
    const fringe = fringeOf(picture, 0.5, 1)
    const at = (x: number, y: number) => y * 220 + x
    // Down the middle: the pill, the shadow's row beside it, the shadow, and the shadow where it is too faint to cover.
    expect(fringe[at(110, 54)]).toBe(0)
    expect(fringe[at(110, 78)]).toBe(0)
    expect(fringe[at(110, 84)]).toBe(1)
    expect(picture.data[at(110, 96) * 4 + 3]).toBeGreaterThan(0.1)
    expect(fringe[at(110, 96)]).toBe(0)
    expect(marks(fringe)).toBeGreaterThan(1000)
    const alphas = [...fringe].flatMap((mark, i) => (mark ? [picture.data[i * 4 + 3] ?? 0] : []))
    expect(Math.min(...alphas)).toBeGreaterThanOrEqual(0.5)
    expect(Math.max(...alphas)).toBeLessThan(FRINGE.solid)
  })

  it('marks no pixel of a see-through shape with a hard edge, and all of one that fades out instead', () => {
    const hard = pictureOf(SIDE, SIDE, (x, y) => (away(BLOCK, x, y) === 0 ? 0.6 : 0))
    expect(marks(fringeOf(hard, 0.5, 1))).toBe(0)
    // The same shape, losing 0.04 of alpha a pixel beyond its edge: covered up to 2 pixels away.
    const fading = pictureOf(SIDE, SIDE, (x, y) => Math.max(0, 0.6 - 0.04 * away(BLOCK, x, y)))
    expect(fringeOf(fading, 0.5, 1)).toEqual(maskOf(SIDE, SIDE, (x, y) => away(BLOCK, x, y) <= 2))
  })

  it('marks no soft pixel right beside solid ones, though it fades out', () => {
    // A solid block with a soft edge one pixel wide, which loses 0.08 of alpha a pixel beyond it.
    const picture = pictureOf(SIDE, SIDE, (x, y) => {
      const d = away(BLOCK, x, y)
      return d === 0 ? 1 : Math.max(0, 0.63 - 0.08 * d)
    })
    expect(picture.data[(30 * SIDE + 40) * 4 + 3]).toBeGreaterThan(0.5)
    expect(marks(fringeOf(picture, 0.5, 1))).toBe(0)
  })

  it('marks no pixel of a thin faint stroke, and all the covered pixels of a wide band that fades alike', () => {
    // A line across the picture: alpha 0.62 on its middle row, 0.09 less each row away, so 3 rows are covered.
    const stroke = pictureOf(40, 30, (_, y) => Math.max(0, 0.62 - 0.09 * Math.abs(y - 15)))
    expect(marks(fringeOf(stroke, 0.5, 1))).toBe(0)
    // Rows 10 to 21 at alpha 0.62, fading the same way above and below.
    const band = pictureOf(40, 30, (_, y) => Math.max(0, 0.62 - 0.09 * Math.max(0, 10 - y, y - 21)))
    expect(fringeOf(band, 0.5, 1)).toEqual(maskOf(40, 30, (_, y) => y >= 9 && y <= 22))
  })

  it('counts a pixel solid by its share of the piece’s full alpha, so a see-through shape keeps its own pixels', () => {
    // A block of alpha 0.6, the most the piece has, and round it a shadow that loses 0.024 a pixel.
    const picture = pictureOf(SIDE, SIDE, (x, y) => Math.max(0, 0.6 - 0.024 * away(BLOCK, x, y)))
    const ofSeeThrough = fringeOf(picture, 0.3, 1 / 0.6)
    expect(ofSeeThrough).toEqual(maskOf(SIDE, SIDE, (x, y) => away(BLOCK, x, y) >= 4 && away(BLOCK, x, y) <= 12))
    // Against a full alpha of 1 the block is soft too, and fades out with its shadow.
    expect(fringeOf(picture, 0.5, 1)).toEqual(maskOf(SIDE, SIDE, (x, y) => away(BLOCK, x, y) <= 4))
  })

  it('gives an empty mask for a picture with no soft pixel', () => {
    const solid = pictureOf(SIDE, SIDE, (x, y) => (away(BLOCK, x, y) === 0 ? 1 : 0))
    expect(fringeOf(solid, 0.5, 1)).toEqual(new Uint8Array(SIDE * SIDE))
    expect(
      fringeOf(
        pictureOf(8, 6, () => 0),
        0.5,
        1,
      ),
    ).toEqual(new Uint8Array(48))
  })
})
