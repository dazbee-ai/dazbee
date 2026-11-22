import { describe, expect, it } from 'vitest'

import type { FontUse } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { variableTestFont } from '@dazbee/fonts/test-fonts'

import { editorFontLoads, type FontSources, type ListedFace, NO_FONTS, openedFonts } from './font-loads.ts'
import { testCatalog, type TestFace } from './test-catalog.ts'

/** Four faces of Brand Sans, each its own bytes: 400, 700 and 900 upright and 400 italic. */
function brandSans() {
  const [regular, bold, extraBold] = ['NotoSans-Regular.ttf', 'NotoSans-Bold.ttf', 'NotoSans-ExtraBold.ttf'].map(
    (file) => loadFontFiles().find((f) => f.file === file)?.bytes ?? new Uint8Array(),
  )
  const faces = [
    { family: 'Brand Sans', weight: 400, bytes: regular ?? new Uint8Array() },
    { family: 'Brand Sans', weight: 700, bytes: bold ?? new Uint8Array() },
    { family: 'Brand Sans', weight: 900, bytes: extraBold ?? new Uint8Array() },
    { family: 'Brand Sans', weight: 400, style: 'italic' as const, bytes: new Uint8Array(regular ?? []) },
  ]
  return { faces, catalog: testCatalog(faces) }
}

/** Brand Sans upright in each weight. */
const upright = (...weights: number[]): FontUse[] =>
  weights.map((weight) => ({ family: 'Brand Sans', weight, style: 'normal' }))

/** The fonts we ship, as the editor registers them. */
const SHIPPED = loadFontFiles().map(({ family, bytes }) => ({ family, bytes }))

/** The file of a font we ship, by its file name. */
const shippedFile = (file: string) => loadFontFiles().find((f) => f.file === file)?.bytes ?? new Uint8Array()

/**
 * The editor's font loads over `sources`, with nothing loaded to start, online unless `online` says otherwise,
 * registering `shipped` before the catalog's files.
 */
function loadsOf(sources: FontSources, online = () => true, shipped: typeof SHIPPED = []) {
  const done = new AbortController()
  const loads = editorFontLoads({
    shipped,
    opened: NO_FONTS,
    sources,
    connected: online,
    status: () => {},
    signal: done.signal,
    arrived: () => {},
  })
  return { loads, end: () => done.abort() }
}

describe('editorFontLoads', () => {
  it("fetches only the files of the faces a design's texts are drawn in, and a weight's face once a text asks for it", async () => {
    const { faces, catalog } = brandSans()
    const { loads, end } = loadsOf(catalog.sources)
    loads.ask(upright(400))
    await loads.loaded()
    expect(catalog.asked).toEqual([['Brand Sans']])
    expect(catalog.fetched).toEqual(['Brand Sans 400 normal'])
    expect(loads.facesOf('Brand Sans').map((face) => `${face.weight} ${face.style}`)).toEqual([
      '400 normal',
      '700 normal',
      '900 normal',
      '400 italic',
    ])
    loads.ask(upright(400, 800))
    expect(loads.pending('Brand Sans')).toBe(true)
    await loads.loaded()
    // 800 draws in the 900, CSS's nearest heavier weight.
    expect(catalog.asked).toHaveLength(1)
    expect(catalog.fetched).toEqual(['Brand Sans 400 normal', 'Brand Sans 900 normal'])
    expect(loads.fonts().map((font) => font.bytes)).toEqual([faces[0]?.bytes, faces[2]?.bytes])
    end()
  })

  it("registers each family's files in the catalog's order, and gives an export only the faces its design uses", async () => {
    const { faces, catalog } = brandSans()
    const { loads, end } = loadsOf(catalog.sources)
    await loads.loadUses([{ family: 'Brand Sans', weight: 700, style: 'italic' }])
    await loads.loadUses(upright(400))
    // Italic text at 700 draws in the upright 700, which CanvasKit scores above the italic 400.
    expect(catalog.fetched).toEqual(['Brand Sans 700 normal', 'Brand Sans 400 normal'])
    expect(loads.fonts().map((font) => font.bytes)).toEqual([faces[0]?.bytes, faces[1]?.bytes])
    expect(loads.fontsFor(upright(400)).map((font) => font.bytes)).toEqual([faces[0]?.bytes])
    end()
  })

  it("settles a family's load only once every file asked for before it has come", async () => {
    const { catalog } = brandSans()
    const held: { face: ListedFace; let: () => void }[] = []
    const { loads, end } = loadsOf({
      ...catalog.sources,
      fontFile: (face) =>
        new Promise((resolve) => held.push({ face, let: () => resolve(catalog.sources.fontFile(face)) })),
    })
    await loads.loadFamilies(['Brand Sans'])[0]
    loads.ask(upright(700))
    let settled = false
    void loads.loadUses(upright(400)).then(() => (settled = true))
    // The 400 comes first; the 700 asked for before it is still on its way.
    held.find((one) => one.face.weight === 400)?.let()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(false)
    held.find((one) => one.face.weight === 700)?.let()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(settled).toBe(true)
    end()
  })

  it('fetches a face again at the next ask after its file failed to come offline, and not on every ask', async () => {
    const { catalog } = brandSans()
    let online = false
    let calls = 0
    const { loads, end } = loadsOf(
      {
        ...catalog.sources,
        fontFile: (face) => {
          calls++
          return online ? catalog.sources.fontFile(face) : Promise.reject(new Error('offline'))
        },
      },
      () => online,
    )
    loads.ask(upright(700))
    await loads.loaded()
    expect(calls).toBe(1)
    online = true
    loads.ask(upright(700))
    await loads.loaded()
    loads.ask(upright(700))
    await loads.loaded()
    expect(calls).toBe(2)
    expect(catalog.fetched).toEqual(['Brand Sans 700 normal'])
    end()
  })

  it("fetches a variable face's file once, whatever weights its texts ask for", async () => {
    const catalog = testCatalog([
      { family: 'Vary Sans', weight: 400, weights: { min: 100, max: 900 }, bytes: variableTestFont() },
      { family: 'Vary Sans', weight: 400, weights: { min: 100, max: 900 }, style: 'italic', bytes: variableTestFont() },
    ])
    const { loads, end } = loadsOf(catalog.sources)
    loads.ask([100, 550, 900].map((weight) => ({ family: 'Vary Sans', weight, style: 'normal' as const })))
    await loads.loaded()
    expect(catalog.fetched).toEqual(['Vary Sans 400 normal'])
    end()
  })

  it("draws a brand's upload of a shipped family's name in place of the shipped file, on the screen and in an export", async () => {
    // A file of other letters under the name of a font we ship.
    const upload = new Uint8Array(shippedFile('NotoSans-Bold.ttf'))
    const catalog = testCatalog([{ family: 'Noto Naskh Arabic', bytes: upload }])
    const { loads, end } = loadsOf(catalog.sources, () => true, SHIPPED)
    const naskh: FontUse[] = [{ family: 'Noto Naskh Arabic', weight: 400, style: 'normal' }]
    await loads.loadUses(naskh)
    expect(catalog.fetched).toEqual(['Noto Naskh Arabic 400 normal'])
    const naskhFiles = (fonts: { family: string; bytes: Uint8Array }[]) =>
      fonts.filter((font) => font.family === 'Noto Naskh Arabic').map((font) => font.bytes)
    expect(naskhFiles(loads.fonts())).toEqual([upload])
    expect(naskhFiles(loads.fontsFor(naskh))).toEqual([upload])
    // The other shipped families still draw, and an export of a design without the family draws the shipped file.
    expect(loads.fonts().filter((font) => font.family === 'Noto Sans')).toHaveLength(3)
    expect(naskhFiles(loads.fontsFor([]))).toEqual([
      shippedFile('NotoNaskhArabic-Regular.ttf'),
      shippedFile('NotoNaskhArabic-Bold.ttf'),
    ])
    expect(loads.facesOf('Noto Naskh Arabic').map((face) => `${face.weight} ${face.style}`)).toEqual(['400 normal'])
    expect(loads.lacking()).toEqual([])
    end()
  })

  it('draws the shipped file of a family the brand has no upload of, which it never lacks', async () => {
    const catalog = testCatalog([])
    const { loads, end } = loadsOf(catalog.sources, () => true, SHIPPED)
    const naskh: FontUse[] = [{ family: 'Noto Naskh Arabic', weight: 700, style: 'normal' }]
    await loads.loadUses(naskh)
    expect(catalog.fetched).toEqual([])
    expect(loads.fonts()).toEqual(SHIPPED)
    expect(loads.fontsFor(naskh)).toEqual(SHIPPED)
    expect(loads.facesOf('Noto Naskh Arabic').map((face) => `${face.weight} ${face.style}`)).toEqual([
      '400 normal',
      '700 normal',
    ])
    expect(loads.lacking()).toEqual([])
    end()
  })

  it("counts a shipped family drawable only once the catalog said whose files draw it and the brand's are here", async () => {
    const upload = new Uint8Array(shippedFile('NotoSans-Bold.ttf'))
    const catalog = testCatalog([{ family: 'Noto Sans', bytes: upload }])
    let online = false
    const { loads, end } = loadsOf(
      {
        ...catalog.sources,
        fontFile: (face) => (online ? catalog.sources.fontFile(face) : Promise.reject(new Error('offline'))),
      },
      () => online,
      SHIPPED,
    )
    const sans: FontUse[] = [{ family: 'Noto Sans', weight: 400, style: 'normal' }]
    expect(loads.drawable('Noto Sans')).toBe(false)
    // The catalog lists the upload, but its file didn't come: our file isn't the one that draws it.
    await loads.loadUses(sans)
    expect(loads.drawable('Noto Sans')).toBe(false)
    online = true
    await loads.loadUses(sans)
    expect(loads.drawable('Noto Sans')).toBe(true)
    end()

    const none = loadsOf(testCatalog([]).sources, () => true, SHIPPED)
    await none.loads.loadUses(sans)
    expect(none.loads.drawable('Noto Sans')).toBe(true)
    none.end()
    expect(loadsOf({}, () => true, SHIPPED).loads.drawable('Noto Sans')).toBe(true)
  })

  it("draws a shipped family in the brand's file once it says it uploaded one, the family asked for again", async () => {
    const upload = new Uint8Array(shippedFile('NotoSans-Bold.ttf'))
    const faces: TestFace[] = []
    const sources: FontSources = {
      fontFaces: (families) => testCatalog(faces).sources.fontFaces(families),
      fontFile: (face) => testCatalog(faces).sources.fontFile(face),
    }
    const { loads, end } = loadsOf(sources, () => true, SHIPPED)
    const naskh: FontUse[] = [{ family: 'Noto Naskh Arabic', weight: 400, style: 'normal' }]
    await loads.loadUses(naskh)
    expect(loads.fonts()).toEqual(SHIPPED)
    faces.push({ family: 'Noto Naskh Arabic', bytes: upload })
    loads.askAgain(['Noto Naskh Arabic', 'Never Asked'])
    await loads.loaded()
    const naskhFiles = loads.fonts().filter((font) => font.family === 'Noto Naskh Arabic')
    expect(naskhFiles.map((font) => font.bytes)).toEqual([upload])
    end()
  })
})

describe('openedFonts', () => {
  it("opens a design in only the fonts we ship in ours when the catalog doesn't answer, and fails one in others", async () => {
    const down: FontSources = {
      fontFaces: () => Promise.reject(new Error('the font store is down')),
      fontFile: () => Promise.resolve(new Uint8Array()),
    }
    expect(await openedFonts([{ family: 'Noto Sans', weight: 400, style: 'normal' }], down)).toBe(NO_FONTS)
    await expect(openedFonts([{ family: 'Brand Sans', weight: 400, style: 'normal' }], down)).rejects.toThrow('down')
  })
})
