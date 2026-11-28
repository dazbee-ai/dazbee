import { describe, expect, it } from 'vitest'

import type { Pixels } from '@dazbee/renderer'
import type { Rgb } from '@dazbee/schema'

import { ciede2000, srgbToLab } from './colour.ts'
import { farShare, LOOKS_SAME, looksSame, shrunk } from './rule.ts'
import { drawShapes, ellipse, prototypePairs, recoloured, rect, ring } from './test-pictures.ts'

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

/** Read once for the file, before its tests are collected, so each pair and view is a test of its own. */
const pairs = await prototypePairs()
const pair = (id: string) => {
  const found = pairs.find((p) => p.id === id)
  if (!found) throw new Error(`no pair ${id}`)
  return found
}

/** Each pair seen each way the prototype scored it. */
const PROTOTYPE_CASES = pairs.flatMap((p) =>
  p.seen.map((prototype) => ({
    name: `${p.id} over ${prototype.backgrounds ? prototype.backgrounds.map((b) => b.join(' ')).join(', ') : 'the see-through grey'}`,
    pair: p,
    prototype,
  })),
)

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

  it('is checked against the prototype on 12 pairs, some of which don’t look the same', () => {
    expect(pairs).toHaveLength(12)
    expect(PROTOTYPE_CASES.filter((c) => !c.prototype.textLooksSame).length).toBeGreaterThan(0)
  })

  it.each(PROTOTYPE_CASES)('gives the text prototype’s numbers and decisions: $name', ({ pair: p, prototype }) => {
    const options = {
      ...(prototype.backgrounds ? { backgrounds: prototype.backgrounds } : {}),
      ...(p.pieceInk ? { pieceInk: p.pieceInk } : {}),
    }
    const scores = { ssim: prototype.ssim, inkMissed: prototype.inkMissed, far: prototype.far }
    expect(looksSame('text', p.piece, p.rebuild, options)).toEqual({
      same: prototype.textLooksSame,
      scores: { ...scores, inkColour: p.inkColour },
    })
    expect(looksSame('shape', p.piece, p.rebuild, options)).toEqual({ same: prototype.shapeLooksSame, scores })
  })

  it('gives the same answer each time', () => {
    const { piece, rebuild, pieceInk, background } = pair('s150')
    const seen = { backgrounds: [background, WHITE], ...(pieceInk ? { pieceInk } : {}) }
    expect(looksSame('text', piece, rebuild, seen)).toEqual(looksSame('text', piece, rebuild, seen))
  })
})

describe('farShare', () => {
  it('is 0 for a rebuild that is the piece, and the share of one that is in a colour ΔE00 15 away', () => {
    expect(farShare(badge(BLUE), badge(BLUE))).toBe(0)
    // The badge's white disc, a fifth of it, is the same in both.
    expect(farShare(badge(BLUE), badge(VIOLET))).toBeGreaterThan(0.75)
    expect(farShare(badge(BLUE), badge(VIOLET))).toBeLessThan(0.85)
  })

  it('is the share of the foreground that a missing part is', () => {
    const whole = drawShapes(200, 100, [
      [rect(20, 20, 80, 60), BLUE],
      [rect(120, 20, 40, 60), BLUE],
    ])
    const half = drawShapes(200, 100, [[rect(20, 20, 80, 60), BLUE]])
    // The second rectangle is a third of the ink; the blur takes a little in at its edge.
    expect(farShare(whole, half)).toBeGreaterThan(0.3)
    expect(farShare(whole, half)).toBeLessThan(0.4)
    expect(farShare(half, whole)).toBe(farShare(whole, half))
  })

  it('is the far share looksSame judges shapes by, over the see-through grey', () => {
    const piece = drawShapes(100, 100, [[ring(50, 50, 40, 25), BLACK]])
    const filled = drawShapes(100, 100, [
      [ellipse(50, 50, 25, 25), WHITE],
      [ring(50, 50, 40, 25), BLACK],
    ])
    const { scores } = looksSame('shape', piece, filled)
    expect(scores.far).toBeGreaterThan(LOOKS_SAME.shape.far)
    expect(farShare(piece, filled)).toBe(scores.far)
    expect(farShare(badge(BLUE), badge(VIOLET))).toBe(looksSame('shape', badge(BLUE), badge(VIOLET)).scores.far)
  })

  it('takes a rebuild at the piece’s size or at the size the rule shrinks the piece to, and refuses another', () => {
    const shapes = (scale: number, colour: Rgb) =>
      drawShapes(1024 * scale, 300 * scale, [[rect(100 * scale, 50 * scale, 800 * scale, 200 * scale), colour]])
    const piece = shapes(1, BLUE)
    expect(farShare(piece, shapes(1, BLUE))).toBe(0)
    expect(farShare(piece, shapes(0.5, BLUE))).toBe(0)
    expect(farShare(piece, shapes(0.5, VIOLET))).toBeGreaterThan(0.9)
    expect(() => farShare(piece, shapes(0.25, BLUE))).toThrow('the rebuild is 256×75, the piece 1024×300')
  })
})

describe('shrunk', () => {
  it('gives a picture at a smaller size with its colours and its see-through pixels kept, and itself at its own', () => {
    const picture = badge(BLUE)
    expect(shrunk(picture, 160, 120)).toBe(picture)
    const half = shrunk(picture, 80, 60)
    expect(half).toMatchObject({ width: 80, height: 60 })
    expect(half.pixels).toHaveLength(80 * 60 * 4)
    const at = (x: number, y: number) => [...half.pixels.subarray((y * 80 + x) * 4, (y * 80 + x) * 4 + 4)]
    expect(at(10, 10)).toEqual([...BLUE, 255])
    expect(at(40, 30)).toEqual([...WHITE, 255])
    expect(at(2, 2)).toEqual([0, 0, 0, 0])
  })
})
