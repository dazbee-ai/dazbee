import { beforeAll, describe, expect, it } from 'vitest'

import type { Pixels } from '@dazbee/renderer'
import type { Rgb } from '@dazbee/schema'

import { ciede2000, srgbToLab } from './colour.ts'
import { LOOKS_SAME, looksSame } from './rule.ts'
import { drawShapes, ellipse, type PrototypePair, prototypePairs, recoloured, rect, ring } from './test-pictures.ts'

const WHITE: Rgb = [255, 255, 255]
const BLACK: Rgb = [0, 0, 0]
/** Two colours ΔE00 15 apart, of about the same luminance. */
const BLUE: Rgb = [40, 90, 200]
const VIOLET: Rgb = [116, 70, 178]

const badge = (colour: Rgb) =>
  drawShapes(160, 120, [
    [rect(10, 10, 140, 100), colour],
    [ellipse(80, 60, 30, 30), WHITE],
  ])

/** A picture with the ink right of the column that leaves a third of its ink made see-through. */
const withoutLastThird = (picture: Pixels): Pixels => {
  const { width, height } = picture
  const columns = new Array<number>(width).fill(0)
  let ink = 0
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      if ((picture.pixels[(y * width + x) * 4 + 3] ?? 0) > 127) {
        columns[x] = (columns[x] ?? 0) + 1
        ink++
      }
  let kept = 0
  let cut = 0
  while (cut < width && kept + (columns[cut] ?? 0) <= (ink * 2) / 3) kept += columns[cut++] ?? 0
  const pixels = new Uint8Array(picture.pixels)
  for (let y = 0; y < height; y++) for (let x = cut; x < width; x++) pixels[(y * width + x) * 4 + 3] = 0
  return { width, height, pixels }
}

let pairs: PrototypePair[] = []
const pair = (id: string) => {
  const found = pairs.find((p) => p.id === id)
  if (!found) throw new Error(`no pair ${id}`)
  return found
}

beforeAll(async () => {
  pairs = await prototypePairs()
})

describe('looksSame', () => {
  it('passes identical pictures, text and shapes alike', () => {
    const text = pair('s241').piece
    expect(looksSame('text', text, text)).toEqual({
      same: true,
      scores: { ssim: 1, inkMissed: 0, far: 0, inkColour: 0 },
    })
    expect(looksSame('shape', badge(BLUE), badge(BLUE))).toEqual({
      same: true,
      scores: { ssim: 1, inkMissed: 0, far: 0 },
    })
  })

  it('fails text whose rebuild misses a third of the ink', () => {
    const piece = pair('s241').piece
    const { same, scores } = looksSame('text', piece, withoutLastThird(piece))
    expect(same).toBe(false)
    expect(scores.inkMissed).toBeGreaterThan(LOOKS_SAME.text.inkMissed)
    expect(scores.inkMissed).toBeLessThan(0.34)
  })

  it('fails shapes rebuilt in a colour ΔE00 15 away, and text by the colour guard alone', () => {
    expect(ciede2000(srgbToLab(...BLUE), srgbToLab(...VIOLET))).toBeCloseTo(15, 1)
    const shapes = looksSame('shape', badge(BLUE), badge(VIOLET))
    expect(shapes.same).toBe(false)
    expect(shapes.scores.far).toBeGreaterThan(LOOKS_SAME.shape.far)

    const words = pair('s241').piece
    const text = looksSame('text', recoloured(words, BLUE), recoloured(words, VIOLET), { backgrounds: [WHITE] })
    expect(text.same).toBe(false)
    expect(text.scores.ssim).toBeGreaterThanOrEqual(LOOKS_SAME.text.ssim)
    expect(text.scores.inkMissed).toBe(0)
    expect(text.scores.inkColour).toBeCloseTo(15, 1)
  })

  it('judges a see-through piece over each background given, the worse counting, and over the grey when none is', () => {
    const piece = drawShapes(100, 100, [[ring(50, 50, 40, 25), BLACK]])
    const filled = drawShapes(100, 100, [
      [ellipse(50, 50, 25, 25), WHITE],
      [ring(50, 50, 40, 25), BLACK],
    ])
    const overWhite = looksSame('shape', piece, filled, { backgrounds: [WHITE] })
    expect(overWhite.same).toBe(true)
    const overBoth = looksSame('shape', piece, filled, { backgrounds: [WHITE, BLACK] })
    expect(overBoth.same).toBe(false)
    expect(overBoth.scores.far).toBe(looksSame('shape', piece, filled, { backgrounds: [BLACK] }).scores.far)

    const overNone = looksSame('shape', piece, filled)
    expect(overNone.same).toBe(false)
    expect(overNone).toEqual(looksSame('shape', piece, filled, { backgrounds: [LOOKS_SAME.seeThrough] }))
    expect(looksSame('shape', piece, filled, { backgrounds: [] })).toEqual(overNone)
    expect(LOOKS_SAME.seeThrough).toEqual([180, 180, 180])

    const textOverBoth = looksSame('text', piece, filled, { backgrounds: [WHITE, BLACK] }).scores.ssim
    const textOverBlack = looksSame('text', piece, filled, { backgrounds: [BLACK] }).scores.ssim
    expect(textOverBoth).toBe(
      Math.min(textOverBlack, looksSame('text', piece, filled, { backgrounds: [WHITE] }).scores.ssim),
    )
  })

  it('refuses pictures of different sizes', () => {
    expect(() => looksSame('shape', badge(BLUE), drawShapes(10, 10, []))).toThrow(
      'the rebuild is 10×10, the piece 160×120',
    )
  })

  it('gives the text prototype’s numbers and decisions on its pieces and rebuilds', () => {
    expect(pairs).toHaveLength(12)
    let differentText = 0
    for (const { id, piece, rebuild, pieceInk, inkColour, seen } of pairs) {
      for (const prototype of seen) {
        const options = {
          ...(prototype.backgrounds ? { backgrounds: prototype.backgrounds } : {}),
          ...(pieceInk ? { pieceInk } : {}),
        }
        const text = looksSame('text', piece, rebuild, options)
        const shape = looksSame('shape', piece, rebuild, options)
        const scores = { ssim: prototype.ssim, inkMissed: prototype.inkMissed, far: prototype.far }
        expect({ id, ...text }).toEqual({ id, same: prototype.textLooksSame, scores: { ...scores, inkColour } })
        expect({ id, ...shape }).toEqual({ id, same: prototype.shapeLooksSame, scores })
        if (!prototype.textLooksSame) differentText++
      }
    }
    expect(differentText).toBeGreaterThan(0)
  })

  it('gives the same answer each time', () => {
    const { piece, rebuild, pieceInk, background } = pair('s316')
    const seen = { backgrounds: [background, WHITE], ...(pieceInk ? { pieceInk } : {}) }
    expect(looksSame('text', piece, rebuild, seen)).toEqual(looksSame('text', piece, rebuild, seen))
  })
})
