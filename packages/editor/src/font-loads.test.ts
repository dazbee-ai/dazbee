import { describe, expect, it } from 'vitest'

import type { FontUse } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { variableTestFont } from '@dazbee/fonts/test-fonts'
import type { DesignInput } from '@dazbee/schema'

import { editorFontLoads, type FontSources, type ListedFace, NO_FONTS } from './font-loads.ts'
import { testCatalog } from './test-catalog.ts'
import { testEditor } from './test-editor.ts'

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

/** A design whose one frame holds a line of words in `family`. */
function wordsIn(family: string): DesignInput {
  return {
    meta: { designId: 'd', name: 'Words' },
    pages: { p1: { name: 'Page 1', order: 'a0' } },
    frames: { f: { pageId: 'p1', name: 'Square', width: 300, height: 80, x: 0, y: 0, order: 'a0' } },
    nodes: {
      t: {
        type: 'text',
        parentId: 'f',
        link: 't',
        index: 'a0',
        name: 'Words',
        props: {
          ...{ x: 10, y: 10, width: 280, height: 60, text: 'Big sale' },
          style: { fontFamily: family, fontSize: 40, color: '#000000FF' },
        },
      },
    },
  }
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
})

describe('a design in a shipped family', () => {
  it("draws the brand's upload of that family's name, and the shipped file for a brand without one", async () => {
    // A file of other letters under the name of a font we ship, and the same file under a name of its own.
    const upload = new Uint8Array(shippedFile('NotoSans-Bold.ttf'))
    const pixels = async (family: string, faces: Parameters<typeof testCatalog>[0]) => {
      const editor = await testEditor(wordsIn(family), { sources: testCatalog(faces).sources })
      const drawn = editor.core.exportPixels('f')
      editor.end()
      return Buffer.from(drawn)
    }
    const uploaded = await pixels('Noto Naskh Arabic', [{ family: 'Noto Naskh Arabic', bytes: upload }])
    const ownName = await pixels('Own Sans', [{ family: 'Own Sans', bytes: upload }])
    const shipped = await pixels('Noto Naskh Arabic', [])
    expect(uploaded.equals(ownName)).toBe(true)
    expect(shipped.equals(uploaded)).toBe(false)
  })
})
