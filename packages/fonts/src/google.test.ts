import { describe, expect, it } from 'vitest'

import { GOOGLE_FONTS, googleFaces, googleFileUrl } from './google.ts'
import { FONT_FACES } from './index.ts'
import { SCRIPT_FONTS } from './scripts.ts'
import { SHIPPED_RANKS } from './shipped-ranks.ts'

/** Google's categories, as the list names them. */
const CATEGORIES = ['sans-serif', 'serif', 'display', 'handwriting', 'monospace']

/** Families designs are already set in: the list keeps them, so no such design loses its font. */
const FAMILIES_IN_USE = [
  'Inter',
  'Roboto',
  'Open Sans',
  'Montserrat',
  'Poppins',
  'Lato',
  'Oswald',
  'Raleway',
  'Nunito',
  'Work Sans',
  'DM Sans',
  'Space Grotesk',
  'Rubik',
  'Bebas Neue',
  'Anton',
  'Archivo Black',
  'Playfair Display',
  'Merriweather',
  'Lora',
  'DM Serif Display',
  'Abril Fatface',
  'Lobster',
  'Pacifico',
  'Dancing Script',
  'Caveat',
  'Permanent Marker',
  'Space Mono',
  'Cairo',
  'Tajawal',
  'Hind',
]

describe('GOOGLE_FONTS', () => {
  const names = GOOGLE_FONTS.map((f) => f.family)

  it('offers every Google Fonts family, about 1,900', () => {
    expect(names.length).toBeGreaterThanOrEqual(1800)
  })

  it('gives every family a category, a licence we take, a folder and at least one file', () => {
    const bad = GOOGLE_FONTS.filter(
      (f) =>
        !CATEGORIES.includes(f.category) ||
        !['OFL', 'Apache-2.0', 'UFL'].includes(f.licence) ||
        !/^(ofl|apache|ufl)\/[a-z0-9]+$/.test(f.path) ||
        f.faces.length === 0,
    )
    expect(bad.map((f) => f.family)).toEqual([])
  })

  it('has every category', () => {
    expect(new Set(GOOGLE_FONTS.map((f) => f.category))).toEqual(new Set(CATEGORIES))
  })

  it('names each family once', () => {
    expect(names.filter((name, i) => names.indexOf(name) !== i)).toEqual([])
  })

  it('lists the families in popularity order, the places of the families we ship left to them', () => {
    const places = [...GOOGLE_FONTS.map((f) => f.rank), ...Object.values(SHIPPED_RANKS)].sort((a, b) => a - b)
    expect(places).toEqual(places.map((_, i) => i + 1))
    expect(GOOGLE_FONTS.map((f) => f.rank)).toEqual(GOOGLE_FONTS.map((f) => f.rank).sort((a, b) => a - b))
    expect(Object.keys(SHIPPED_RANKS).sort()).toEqual([...new Set(FONT_FACES.map((f) => f.family))].sort())
  })

  it('names no font we ship, and every script font', () => {
    expect(names.filter((name) => FONT_FACES.some((f) => f.family === name))).toEqual([])
    expect(SCRIPT_FONTS.filter((f) => !names.includes(f.family)).map((f) => f.family)).toEqual([])
  })

  it('keeps every family designs are set in', () => {
    expect(FAMILIES_IN_USE.filter((name) => !names.includes(name))).toEqual([])
  })

  it('gives each file a weight from 1 to 1000 and a style, each weight and style once in a family', () => {
    const bad = GOOGLE_FONTS.filter(({ faces }) =>
      faces.some(
        (face, i) =>
          !Number.isInteger(face.weight) ||
          face.weight < 1 ||
          face.weight > 1000 ||
          !['normal', 'italic'].includes(face.style) ||
          !/^[0-9a-f]{40}$/.test(face.blob) ||
          face.bytes <= 0 ||
          faces.findIndex((other) => other.weight === face.weight && other.style === face.style) !== i,
      ),
    )
    expect(bad.map((f) => f.family)).toEqual([])
  })

  it('names the scripts each family draws as ISO 15924 codes', () => {
    expect(
      GOOGLE_FONTS.filter((f) => f.scripts.some((code) => !/^[A-Z][a-z]{3}$/.test(code))).map((f) => f.family),
    ).toEqual([])
    expect(GOOGLE_FONTS.find((f) => f.family === 'Noto Sans JP')?.scripts).toContain('Jpan')
    expect(GOOGLE_FONTS.find((f) => f.family === 'Cairo')?.scripts).toEqual(expect.arrayContaining(['Arab', 'Latn']))
  })

  it('takes about 2 GB of storage', () => {
    const bytes = GOOGLE_FONTS.flatMap((f) => f.faces).reduce((sum, face) => sum + face.bytes, 0)
    expect(bytes).toBeGreaterThan(1.5e9)
    expect(bytes).toBeLessThan(2.5e9)
  })
})

describe('googleFileUrl', () => {
  it('names the file in google/fonts at the commit the list was written from', () => {
    expect(googleFileUrl({ path: 'ofl/inter' }, { file: 'Inter[opsz,wght].ttf' })).toMatch(
      /^https:\/\/raw\.githubusercontent\.com\/google\/fonts\/[0-9a-f]{40}\/ofl\/inter\/Inter%5Bopsz%2Cwght%5D\.ttf$/,
    )
  })
})

describe('googleFaces', () => {
  it('gives a file variable in its weight its family’s range, and a static file none', () => {
    const roboto = GOOGLE_FONTS.find((f) => f.family === 'Roboto')
    const abeezee = GOOGLE_FONTS.find((f) => f.family === 'ABeeZee')
    if (!roboto || !abeezee) throw new Error('Roboto or ABeeZee left the list')
    expect(googleFaces(roboto).map(({ style, weight, weights }) => ({ style, weight, weights }))).toEqual([
      { style: 'normal', weight: 400, weights: { min: 100, max: 900 } },
      { style: 'italic', weight: 400, weights: { min: 100, max: 900 } },
    ])
    expect(googleFaces(abeezee).every((face) => face.weights === undefined)).toBe(true)
  })
})
