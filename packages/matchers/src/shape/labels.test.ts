import { describe, expect, it } from 'vitest'

import type { Pixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'

import { drawGraphics } from './draw-layers.ts'
import { type Labels, pixelColours } from './labels.ts'
import { toFloatPicture } from './parts/float-picture.ts'
import { rimmed } from './test-matching.ts'
import { ellipse, hiding, noise, rectangle } from './test-pieces.ts'

const ck = await loadCanvasKit()
const BLUE = '#2563EBFF'
const CORAL = '#F2765AFF'
const INK = '#111827FF'

/**
 * The colours of a piece's pixels, read as the cut reads them from a piece with opaque pixels: a pixel is seen
 * from half alpha up, and a pixel's alpha is its share of the piece's full alpha.
 */
const coloursOf = (
  piece: Pixels,
  around: { hidden?: Uint8Array; behind?: readonly [number, number, number] } = {},
): Labels | null => {
  const picture = toFloatPicture(piece)
  const seen = Uint8Array.from({ length: piece.width * piece.height }, (_, i) =>
    (picture.data[i * 4 + 3] ?? 0) >= 0.5 ? 1 : 0,
  )
  const covered = seen.reduce((sum, one) => sum + one, 0)
  return pixelColours(picture, seen, 1, covered, around.hidden, around.behind)
}

/** The colour a pixel of a 240 px wide piece was given, as the red, green and blue of its palette entry, rounded. */
const colourAt = (labels: Labels | null, x: number, y: number): number[] | undefined =>
  labels?.palette[labels.label[y * 240 + x] ?? -1]?.rgb.map(Math.round)

/** A blue block and a coral disc, apart, on a clear piece of 240 × 120. */
const blockAndDisc = [
  rectangle({ x: 20, y: 20, width: 120, height: 80 }, BLUE),
  ellipse({ x: 160, y: 30, width: 60, height: 60 }, CORAL),
]

describe('pixelColours', () => {
  it('gives each flat colour of the piece one colour, and each seen pixel its own', () => {
    const labels = coloursOf(drawGraphics(ck, blockAndDisc, 240, 120))
    expect(labels?.palette).toHaveLength(2)
    expect(colourAt(labels, 80, 60)).toEqual([37, 99, 235])
    expect(colourAt(labels, 190, 60)).toEqual([242, 118, 90])
    // A pixel that is not seen has no colour.
    expect(labels?.label[60 * 240 + 150]).toBe(-1)
    expect(labels?.unexplained).toBe(0)
  })

  it('gives a pixel on the round edge of a shape the shape’s colour', () => {
    const labels = coloursOf(drawGraphics(ck, blockAndDisc, 240, 120))
    // The disc's leftmost column, where its edge is drawn part covered.
    expect(colourAt(labels, 160, 60)).toEqual([242, 118, 90])
  })

  it('adds no colour for what other layers hide', () => {
    const badge = { x: 60, y: 40, width: 40, height: 40 }
    const piece = drawGraphics(ck, [...blockAndDisc, rectangle(badge, INK)], 240, 120)
    expect(coloursOf(piece)?.palette).toHaveLength(3)
    const labels = coloursOf(piece, { hidden: hiding(badge, 240, 120) })
    expect(labels?.palette).toHaveLength(2)
    // The hidden pixels take the colour that shows around them.
    expect(colourAt(labels, 80, 60)).toEqual([37, 99, 235])
  })

  it('reads no colours from a picture that fills too many bins of colour to be a flat drawing', () => {
    expect(coloursOf(drawGraphics(ck, noise(), 90, 90))).toBeNull()
  })

  it('marks edge rows mixed with the colour behind the piece as the rim of the shape beside them', () => {
    const piece = rimmed()
    const at = (x: number, y: number) => y * piece.width + x
    const labels = coloursOf(piece, { behind: [255, 255, 255] })
    if (!labels?.rim) throw new Error('no rim')
    const navy = labels.label[at(100, 40)] ?? -1
    expect(labels.palette[navy]?.rgb.map(Math.round)).toEqual([16, 40, 72])
    for (let x = 10; x <= 209; x++)
      for (const y of [9, 70]) {
        expect(labels.rim[at(x, y)]).toBe(1)
        expect(labels.label[at(x, y)]).toBe(navy)
      }
    // The block's own pixels are no rim: 400 pixels are, the two rows.
    expect(labels.rim[at(100, 10)]).toBe(0)
    expect(labels.rim.reduce((sum, one) => sum + one, 0)).toBe(400)
    expect(labels.unexplained).toBe(0)
  })

  it('marks no rim when the colour behind the piece is not known', () => {
    expect(coloursOf(rimmed())?.rim).toBeNull()
  })
})
