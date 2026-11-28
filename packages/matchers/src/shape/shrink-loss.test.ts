import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { shrunk } from '../looks-same/rule.ts'
import { drawGraphics } from './draw-layers.ts'
import { busyShare, SHRINK_LOSS, shrunkWithLoss } from './shrink-loss.ts'
import { halftone, painted } from './test-matching.ts'
import { ellipse, hiding, rectangle } from './test-pieces.ts'

const ck = await loadCanvasKit()
const BLUE = '#2563EBFF'
const CORAL = '#F2765AFF'

/** Halftone dots over the left half of a piece of 1080 px a side, and one flat blue over its right half. */
const halfDotted = painted(1080, 1080, (x, y) =>
  x >= 540 ? [37, 99, 235, 255] : x % 4 < 2 && y % 4 < 2 ? [20, 20, 20, 255] : [255, 255, 255, 255],
)
/** A rounded card with a circle on it, 1080 px a side, clear around the card. */
const card = drawGraphics(
  ck,
  [
    rectangle({ x: 60, y: 60, width: 960, height: 960 }, BLUE, 80),
    ellipse({ x: 340, y: 340, width: 400, height: 400 }, CORAL),
  ],
  1080,
  1080,
)

describe('shrunkWithLoss', () => {
  it('shrinks a picture to the pixels the looks-the-same rule’s shrink gives', () => {
    // A rounded panel with a disc half over its edge: see-through edges, and two colours that meet.
    const piece = drawGraphics(
      ck,
      [
        rectangle({ x: 20, y: 20, width: 220, height: 150 }, BLUE, 30),
        ellipse({ x: 190, y: 90, width: 100, height: 100 }, CORAL),
      ],
      300,
      200,
    )
    const lossy = shrunkWithLoss(piece, 128, 85)
    const plain = shrunk(piece, 128, 85)
    expect(lossy.shrunk.width).toBe(128)
    expect(lossy.shrunk.height).toBe(85)
    expect(Array.from(lossy.shrunk.pixels)).toEqual(Array.from(plain.pixels))
    expect(lossy.spread).toHaveLength(128 * 85)
  })

  it('reads no spread over a flat colour, and a wide one under a pixel that covers black and white', () => {
    const flat = shrunkWithLoss(
      painted(8, 8, () => [37, 99, 235, 255]),
      4,
      4,
    )
    expect(Math.max(...flat.spread)).toBe(0)
    // A checkerboard of single pixels: each shrunk pixel covers two black pixels and two white.
    const checks = shrunkWithLoss(
      painted(8, 8, (x, y) => ((x + y) % 2 ? [0, 0, 0, 255] : [255, 255, 255, 255])),
      4,
      4,
    )
    expect(Array.from(checks.shrunk.pixels.subarray(0, 4))).toEqual([128, 128, 128, 255])
    expect(Math.min(...checks.spread)).toBeGreaterThan(SHRINK_LOSS.busy)
  })
})

describe('busyShare', () => {
  it('finds a fine pattern the shrink turned into one tone busy underneath, over the share a piece may have', () => {
    const { shrunk: small, spread } = shrunkWithLoss(halftone(), 512, 512)
    expect(busyShare(small, spread)).toBeGreaterThan(SHRINK_LOSS.mostBusy)
  })

  it('finds flat shapes not busy: their edges show in the shrunk picture', () => {
    const { shrunk: small, spread } = shrunkWithLoss(card, 512, 512)
    // The spread is wide under the edges, which the shrunk picture steps at.
    expect(spread.some((lost) => lost > SHRINK_LOSS.busy)).toBe(true)
    expect(busyShare(small, spread)).toBe(0)
  })

  it('counts no pixel marked hidden', () => {
    const { shrunk: small, spread } = shrunkWithLoss(halfDotted, 512, 512)
    expect(busyShare(small, spread)).toBeGreaterThan(SHRINK_LOSS.mostBusy)
    // A layer in front hides the dotted half.
    expect(busyShare(small, spread, hiding({ x: 0, y: 0, width: 256, height: 512 }, 512, 512))).toBe(0)
  })
})
