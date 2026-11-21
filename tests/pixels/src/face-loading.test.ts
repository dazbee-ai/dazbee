// Loading only the faces a design uses draws what loading every face of its families draws: each
// family here is built from our test fonts with every face's weight, slant and size rewritten, so
// each face draws apart, and every weight from 100 to 900, upright and italic, is drawn both ways.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { type CatalogFace, facesToLoad, FALLBACK_FAMILIES, type FontUse } from '@dazbee/fonts'
import { FONT_FILES_DIR, loadFontFiles } from '@dazbee/fonts/node'
import { restyledTestFont, variableTestFont } from '@dazbee/fonts/test-fonts'
import { renderDesign, type ResourceBytes, resourceCache } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { fontUses, parseDesign } from '@dazbee/schema'

type Face = CatalogFace & { bytes: Uint8Array }

const ck = await loadCanvasKit()
const shipped = (file: string) => new Uint8Array(readFileSync(join(FONT_FILES_DIR, file)))
const REGULAR = shipped('NotoSans-Regular.ttf')
const BOLD = shipped('NotoSans-Bold.ttf')
const EXTRA_BOLD = shipped('NotoSans-ExtraBold.ttf')

/** A face of `family` recorded at `weight` and `style`, its file `source` restyled. */
const face = (
  family: string,
  recorded: Omit<CatalogFace, 'family'>,
  source: Uint8Array,
  file: { weight?: number; unitsPerEm: number },
): Face => ({
  family,
  ...recorded,
  bytes: restyledTestFont(source, { ...file, italic: recorded.style === 'italic' }),
})

/** Uploads, at the weights their files say: eight faces, two of them italic. */
const UPLOADED = [
  face('Upload Test', { weight: 100, style: 'normal', source: 'upload' }, REGULAR, { weight: 100, unitsPerEm: 900 }),
  face('Upload Test', { weight: 300, style: 'normal', source: 'upload' }, REGULAR, { weight: 300, unitsPerEm: 1100 }),
  face('Upload Test', { weight: 400, style: 'normal', source: 'upload' }, REGULAR, { weight: 400, unitsPerEm: 1000 }),
  face('Upload Test', { weight: 500, style: 'normal', source: 'upload' }, BOLD, { weight: 500, unitsPerEm: 1150 }),
  face('Upload Test', { weight: 700, style: 'normal', source: 'upload' }, BOLD, { weight: 700, unitsPerEm: 1000 }),
  face('Upload Test', { weight: 900, style: 'normal', source: 'upload' }, EXTRA_BOLD, {
    weight: 900,
    unitsPerEm: 1000,
  }),
  face('Upload Test', { weight: 300, style: 'italic', source: 'upload' }, REGULAR, { weight: 300, unitsPerEm: 950 }),
  face('Upload Test', { weight: 700, style: 'italic', source: 'upload' }, BOLD, { weight: 700, unitsPerEm: 1050 }),
]

/** Google statics, whose Thin and ExtraLight files say 250 and 275 where the catalogue says 100 and 200. */
const GOOGLE = [
  face('Google Test', { weight: 100, style: 'normal', source: 'google' }, REGULAR, { weight: 250, unitsPerEm: 900 }),
  face('Google Test', { weight: 200, style: 'normal', source: 'google' }, REGULAR, { weight: 275, unitsPerEm: 1100 }),
  face('Google Test', { weight: 400, style: 'normal', source: 'google' }, REGULAR, { weight: 400, unitsPerEm: 1000 }),
  face('Google Test', { weight: 700, style: 'normal', source: 'google' }, BOLD, { weight: 700, unitsPerEm: 1000 }),
  face('Google Test', { weight: 400, style: 'italic', source: 'google' }, BOLD, { weight: 400, unitsPerEm: 1200 }),
]

/** Google variable faces, upright and italic, recorded at Regular. */
const VARIABLE = [
  face(
    'Vary Test',
    { weight: 400, weights: { min: 100, max: 900 }, style: 'normal', source: 'google' },
    variableTestFont(),
    {
      unitsPerEm: 1000,
    },
  ),
  face(
    'Vary Test',
    { weight: 400, weights: { min: 100, max: 900 }, style: 'italic', source: 'google' },
    variableTestFont(),
    {
      unitsPerEm: 1150,
    },
  ),
]

const WEIGHTS = Array.from({ length: 81 }, (_, i) => 100 + i * 10)
const WORDS = 'Hamburgefonstiv 123'

/** One text in `family`, `runs` over it, on white. */
const design = (family: string, weight: number, style: 'normal' | 'italic', runs: unknown[] = []) => ({
  meta: { designId: 'faces', name: 'Faces' },
  pages: { p1: { name: 'Page 1', order: 'a0' } },
  frames: {
    sq: {
      pageId: 'p1',
      name: 'Post',
      width: 520,
      height: 64,
      x: 0,
      y: 0,
      fills: [{ type: 'solid', color: '#FFFFFFFF' }],
      order: 'a0',
    },
  },
  nodes: {
    t: {
      type: 'text',
      parentId: 'sq',
      link: 't',
      index: 'a0',
      name: 'Words',
      props: {
        x: 8,
        y: 8,
        width: 504,
        height: 48,
        boxMode: 'fixed',
        text: WORDS,
        runs,
        style: { fontFamily: family, fontSize: 32, fontWeight: weight, fontStyle: style, color: '#15121AFF' },
      },
    },
  },
})

/** The shipped fonts and `faces`, in the order given, as the API and the editor register them. */
const withFaces = (faces: readonly Face[]): ResourceBytes => ({
  fonts: [...loadFontFiles(), ...faces.map(({ family, bytes }) => ({ family, bytes }))],
  fallbackFamilies: [...FALLBACK_FAMILIES],
  images: {},
})

/** The faces of `family` that `facesToLoad` picks for what the design uses of it. */
const picked = (family: readonly Face[], uses: readonly FontUse[]) =>
  facesToLoad(
    family,
    uses.filter((use) => use.family === family[0]?.family),
  )

/** Each family's fonts registered once, for drawing with every face of it. */
const everyFace = resourceCache(ck)

const pixelsOf = (json: unknown, faces: readonly Face[], cache?: ReturnType<typeof resourceCache>) =>
  renderDesign(ck, json, 'sq', withFaces(faces), cache).pixels

describe('loading only the faces a design uses', { timeout: 120_000 }, () => {
  for (const [name, family] of [
    ['uploads', UPLOADED],
    ['Google statics whose files say other weights', GOOGLE],
    ['Google variable faces', VARIABLE],
  ] as const) {
    it(`draws every weight and style of ${name} as loading every face does`, () => {
      const differ: string[] = []
      for (const style of ['normal', 'italic'] as const)
        for (const weight of WEIGHTS) {
          const json = design(family[0]?.family ?? '', weight, style)
          const loaded = picked(family, [{ family: family[0]?.family ?? '', weight, style }])
          const all = pixelsOf(json, family, everyFace)
          if (!Buffer.from(pixelsOf(json, loaded)).equals(Buffer.from(all))) differ.push(`${weight} ${style}`)
        }
      expect(differ).toEqual([])
    })
  }

  it('draws a text whose runs set several weights and styles as loading every face does, from fewer faces', () => {
    const json = design('Upload Test', 400, 'normal', [
      { start: 0, end: 5, style: { fontWeight: 700 } },
      { start: 6, end: 10, style: { fontStyle: 'italic', fontWeight: 300 } },
      { start: 12, end: 15, style: { fontWeight: 900, fontStyle: 'italic' } },
    ])
    const parsed = parseDesign(json)
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const uses = fontUses(parsed.design)
    const loaded = picked(UPLOADED, uses)
    // Italic text at 900 may draw in the upright 900 where the uploaded italics' files call them oblique.
    expect(loaded.map((f) => `${f.weight} ${f.style}`)).toEqual([
      '400 normal',
      '700 normal',
      '900 normal',
      '300 italic',
      '700 italic',
    ])
    expect(Buffer.from(pixelsOf(json, loaded)).equals(Buffer.from(pixelsOf(json, UPLOADED)))).toBe(true)
  })

  it('draws faces apart, so a face loaded wrongly would show', () => {
    const drawn = (weight: number) => Buffer.from(pixelsOf(design('Upload Test', weight, 'normal'), UPLOADED))
    expect(drawn(400).equals(drawn(300))).toBe(false)
    expect(drawn(400).equals(drawn(500))).toBe(false)
    const google = (weight: number) => Buffer.from(pixelsOf(design('Google Test', weight, 'normal'), GOOGLE))
    expect(google(100).equals(google(400))).toBe(false)
  })
})
