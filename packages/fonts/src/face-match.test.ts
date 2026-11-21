import { describe, expect, it } from 'vitest'

import { type CatalogFace, facesToLoad, missesDrawnFace, WHOLE_FAMILIES } from './face-match.ts'
import { GOOGLE_FONTS_COMMIT } from './google.ts'
import whole from './whole-families.json' with { type: 'json' }

const upload = (weight: number, style: 'normal' | 'italic' = 'normal'): CatalogFace => ({
  family: 'Test',
  weight,
  style,
  source: 'upload',
})
const google = (weight: number, style: 'normal' | 'italic' = 'normal'): CatalogFace => ({
  family: 'Test',
  weight,
  style,
  source: 'google',
})
const variable = (
  weight: number,
  min: number,
  max: number,
  style: 'normal' | 'italic' = 'normal',
  source: 'google' | 'upload' = 'google',
): CatalogFace => ({ family: 'Test', weight, weights: { min, max }, style, source })
const weightsOf = (faces: readonly CatalogFace[]) => faces.map((face) => `${face.weight} ${face.style}`)

/** Nine upright weights and their italics, as an uploaded family of static files. */
const NINE = [100, 200, 300, 400, 500, 600, 700, 800, 900].flatMap((w) => [upload(w), upload(w, 'italic')])

describe('WHOLE_FAMILIES', () => {
  it('was found in the files of the commit the Google list was written from', () => {
    expect(whole.commit).toBe(GOOGLE_FONTS_COMMIT)
  })

  it('loads every face of a Google family whose files CanvasKit reads apart from the catalog', () => {
    const family = [...WHOLE_FAMILIES][0] ?? ''
    const faces = [400, 700].map((weight) => ({ family, weight, style: 'normal' as const, source: 'google' as const }))
    expect(facesToLoad(faces, [{ weight: 400, style: 'normal' }])).toEqual(faces)
  })
})

describe('facesToLoad', () => {
  it('loads only the face of each weight and style asked for, where the family has it', () => {
    const picked = facesToLoad(NINE, [
      { weight: 400, style: 'normal' },
      { weight: 700, style: 'italic' },
    ])
    expect(weightsOf(picked)).toEqual(['400 normal', '700 italic'])
  })

  it("gives each face once, in the catalog's order, however often it is asked for", () => {
    const picked = facesToLoad(NINE, [
      { weight: 700, style: 'normal' },
      { weight: 400, style: 'normal' },
      { weight: 700, style: 'normal' },
    ])
    expect(weightsOf(picked)).toEqual(['400 normal', '700 normal'])
  })

  it('loads the nearest weight as CSS picks it where the family lacks the one asked for', () => {
    const family = [upload(300), upload(400), upload(700)]
    // Up to 400: lighter first. 400 to 500: up to 500, then lighter. Past 500: heavier first.
    expect(weightsOf(facesToLoad(family, [{ weight: 200, style: 'normal' }]))).toEqual(['300 normal'])
    expect(weightsOf(facesToLoad(family, [{ weight: 500, style: 'normal' }]))).toEqual(['400 normal'])
    expect(weightsOf(facesToLoad(family, [{ weight: 600, style: 'normal' }]))).toEqual(['700 normal'])
    expect(weightsOf(facesToLoad(family, [{ weight: 900, style: 'normal' }]))).toEqual(['700 normal'])
  })

  it('loads an upright face for italic text in a family with no italic, and the reverse', () => {
    expect(weightsOf(facesToLoad([upload(400), upload(700)], [{ weight: 700, style: 'italic' }]))).toEqual([
      '700 normal',
    ])
    expect(weightsOf(facesToLoad([upload(400, 'italic')], [{ weight: 400, style: 'normal' }]))).toEqual(['400 italic'])
  })

  it('loads the face CanvasKit draws where a weight far off outscores the slant', () => {
    // Skia's score shifts the slant by 8 bits only, so a 900 upright beats a 100 italic for italic
    // text at 900: 1 × 256 + 1000 against 3 × 256 + 100.
    const family = [upload(400), upload(900), upload(100, 'italic')]
    expect(weightsOf(facesToLoad(family, [{ weight: 900, style: 'italic' }]))).toEqual(['900 normal'])
    expect(weightsOf(facesToLoad(family, [{ weight: 100, style: 'italic' }]))).toEqual(['100 italic'])
  })

  it("loads a variable face's file once for every weight it draws", () => {
    const family = [variable(400, 100, 900), variable(400, 100, 900, 'italic')]
    const picked = facesToLoad(family, [
      { weight: 100, style: 'normal' },
      { weight: 550, style: 'normal' },
      { weight: 900, style: 'normal' },
    ])
    expect(weightsOf(picked)).toEqual(['400 normal'])
  })

  it("loads only the italic variable face for italic text, whatever weight the files' defaults are", () => {
    // Google records a variable face at Regular; CanvasKit reads its weight from the file's default,
    // which both of a family's variable files share.
    const family = [variable(400, 100, 900), variable(400, 100, 900, 'italic')]
    for (const weight of [100, 400, 700, 900])
      expect(weightsOf(facesToLoad(family, [{ weight, style: 'italic' }]))).toEqual(['400 italic'])
  })

  it('loads the Thin and the ExtraLight of a Google family for 200, as its Thin may say 250 in its file', () => {
    // A Thin file at 250 and an ExtraLight at 200: CanvasKit draws 200 in the ExtraLight. At 250
    // and 275, it draws 200 in the Thin. The catalog can't tell them apart.
    const family = [google(100), google(200), google(400)]
    expect(weightsOf(facesToLoad(family, [{ weight: 200, style: 'normal' }]))).toEqual(['100 normal', '200 normal'])
    expect(weightsOf(facesToLoad(family, [{ weight: 400, style: 'normal' }]))).toEqual(['400 normal'])
  })

  it("trusts an upload's weight, read from its own file", () => {
    const family = [upload(100), upload(200), upload(400)]
    expect(weightsOf(facesToLoad(family, [{ weight: 200, style: 'normal' }]))).toEqual(['200 normal'])
  })

  it('loads nothing for a family with no faces, and nothing when nothing is asked', () => {
    expect(facesToLoad([], [{ weight: 400, style: 'normal' }])).toEqual([])
    expect(facesToLoad(NINE, [])).toEqual([])
  })
})

describe('missesDrawnFace', () => {
  it('finds a family whose widths differ, which CanvasKit picks by before weight', () => {
    // A regular at width 7 and a bold at width 5: CanvasKit draws every weight in the bold.
    const faces = [google(400), google(700)]
    expect(
      missesDrawnFace(faces, [
        { weight: 400, width: 7, slant: 0 },
        { weight: 700, width: 5, slant: 0 },
      ]),
    ).toBe(true)
    expect(
      missesDrawnFace(faces, [
        { weight: 400, width: 5, slant: 0 },
        { weight: 700, width: 5, slant: 0 },
      ]),
    ).toBe(false)
  })
})
