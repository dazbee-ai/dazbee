import { describe, expect, it } from 'vitest'

import { loadFontFiles } from '@dazbee/fonts/node'
import { variableTestFont } from '@dazbee/fonts/test-fonts'
import { resourceCache } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type Design, parseDesign } from '@dazbee/schema'

import { opacityAt } from './canvas/alpha-map.ts'
import { type CopyMaker, madeCopy } from './display-copies.ts'
import { NO_FONTS } from './font-loads.ts'
import { editorResources } from './resources.ts'
import { testCatalog } from './test-catalog.ts'

const ck = await loadCanvasKit()

/** The PNG bytes of an image of a size, its left half opaque and its right half clear. */
function halfPng(width: number, height: number): Uint8Array {
  const surface = ck.MakeSurface(width, height)
  if (!surface) throw new Error('no surface')
  const canvas = surface.getCanvas()
  canvas.clear(ck.TRANSPARENT)
  const paint = new ck.Paint()
  paint.setColor(ck.Color(10, 200, 90, 1))
  canvas.drawRect(ck.XYWHRect(0, 0, width / 2, height), paint)
  paint.delete()
  const image = surface.makeImageSnapshot()
  const png = image.encodeToBytes()
  image.delete()
  surface.delete()
  if (!png) throw new Error('could not encode')
  return png
}

/** A design whose frame holds a photo layer for each asset id. */
function designOf(assetIds: string[]): Design {
  const parsed = parseDesign({
    meta: { designId: 'd', name: 'D' },
    pages: { p: { name: 'Page', order: 'a0' } },
    frames: { f: { pageId: 'p', name: 'F', width: 750, height: 500, x: 0, y: 0, order: 'a0' } },
    nodes: Object.fromEntries(
      assetIds.map((assetId, i) => [
        assetId,
        {
          type: 'graphic',
          parentId: 'f',
          link: assetId,
          index: `a${i}`,
          name: assetId,
          props: {
            x: 0,
            y: 0,
            width: 750,
            height: 500,
            shape: { kind: 'rect' },
            fills: [{ type: 'image', assetId, fit: 'fill' }],
          },
        },
      ]),
    ),
  })
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
}

/** A design whose frame holds a text in `family` for each weight and style. */
function textsIn(family: string, faces: { weight: number; style?: 'normal' | 'italic' }[]): Design {
  const parsed = parseDesign({
    meta: { designId: 'd', name: 'D' },
    pages: { p: { name: 'Page', order: 'a0' } },
    frames: { f: { pageId: 'p', name: 'F', width: 750, height: 500, x: 0, y: 0, order: 'a0' } },
    nodes: Object.fromEntries(
      faces.map(({ weight, style = 'normal' }, i) => [
        `t${i}`,
        {
          type: 'text',
          parentId: 'f',
          link: `t${i}`,
          index: `a${i}`,
          name: 'Words',
          props: {
            ...{ x: 0, y: 0, width: 700, height: 60, text: 'Sale' },
            style: { fontFamily: family, fontSize: 40, fontWeight: weight, fontStyle: style, color: '#000000FF' },
          },
        },
      ]),
    ),
  })
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
}

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

/** Editor resources over a catalog, with no fonts or images to start. */
function fromCatalog(sources: ReturnType<typeof testCatalog>['sources']) {
  const done = new AbortController()
  const resources = editorResources({
    ck,
    cache: resourceCache(ck),
    first: { fonts: [], fallbackFamilies: [], images: {} },
    firstFonts: NO_FONTS,
    sources,
    connected: () => true,
    status: () => {},
    signal: done.signal,
  })
  return {
    resources,
    end: () => {
      resources.destroy()
      done.abort()
    },
  }
}

/** A design of two frames on two pages, each with a photo layer: `here` on page p, `there` on page q. */
function twoPages(): Design {
  const one = designOf(['here'])
  const parsed = parseDesign({
    ...one,
    pages: { ...one.pages, q: { name: 'Other', order: 'a1' } },
    frames: { ...one.frames, g: { ...one.frames.f, pageId: 'q', order: 'a1', x: 2000 } },
    nodes: {
      ...one.nodes,
      there: {
        ...one.nodes.here,
        parentId: 'g',
        link: 'there',
        props: { ...one.nodes.here?.props, fills: [{ type: 'image', assetId: 'there', fit: 'fill' }] },
      },
    },
  })
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
}

/** Editor resources opened with these images' bytes, counting what is fetched and said. */
function opened(images: Record<string, Uint8Array>, copyMaker?: CopyMaker, fetchable: Record<string, Uint8Array> = {}) {
  const fetched: string[] = []
  const said: string[] = []
  const done = new AbortController()
  const resources = editorResources({
    ck,
    cache: resourceCache(ck),
    first: { fonts: [], fallbackFamilies: [], images },
    firstFonts: NO_FONTS,
    sources: {
      assetBytes: (assetId) => {
        fetched.push(assetId)
        const bytes = fetchable[assetId]
        return bytes ? Promise.resolve(bytes) : new Promise(() => {})
      },
    },
    connected: () => true,
    status: (line) => said.push(line),
    signal: done.signal,
    ...(copyMaker ? { copyMaker } : {}),
  })
  return { resources, fetched, said, done }
}

describe('editorResources', () => {
  it("draws an image from its display copy, with its own size and an alpha map in the image's own pixels", () => {
    const { resources, done } = opened({ photo: halfPng(2400, 1600) })
    const drawn = resources.screen(designOf(['photo']))
    expect(drawn.images.get('photo')?.width()).toBe(1024)
    expect(drawn.imageSizes?.get('photo')).toEqual({ width: 2400, height: 1600 })
    const map = resources.alpha('photo')
    expect([map?.imageWidth, map?.imageHeight]).toEqual([2400, 1600])
    expect(map && opacityAt(map, 1100, 800)).toBe(1)
    expect(map && opacityAt(map, 1300, 800)).toBe(0)
    resources.destroy()
    done.abort()
  })

  it('gives new images and a new alpha map once a bigger copy is made', () => {
    const { resources, done } = opened({ photo: halfPng(2400, 1600) })
    const design = designOf(['photo'])
    const first = resources.screen(design)
    const map = resources.alpha('photo')
    resources.show(
      new Map([
        [
          'photo',
          [{ fill: { type: 'image', assetId: 'photo', fit: 'fill' } as never, box: { width: 750, height: 500 } }],
        ],
      ]),
      2,
    )
    const grown = resources.screen(design)
    expect(grown.images).not.toBe(first.images)
    expect(grown.images.get('photo')?.width()).toBe(2048)
    expect(resources.alpha('photo')).not.toBe(map)
    resources.destroy()
    done.abort()
  })

  it("says once that an image's bytes don't open, draws it clear, and never fetches it again", () => {
    const { resources, fetched, said, done } = opened({ bad: new Uint8Array([1, 2, 3]) })
    const design = designOf(['bad'])
    const drawn = resources.screen(design)
    resources.screen(design)
    expect(drawn.images.get('bad')?.width()).toBe(1)
    expect(fetched).toEqual([])
    expect(said).toEqual(['Error: an image could not be opened'])
    resources.destroy()
    done.abort()
  })

  it('draws an image clear while the image worker copies it, without fetching it again, and tells when it comes', async () => {
    const jobs: (() => void)[] = []
    const maker: CopyMaker = (bytes, side) =>
      new Promise((resolve) => jobs.push(() => resolve(madeCopy(ck, bytes, side))))
    const { resources, fetched, done } = opened({ photo: halfPng(2400, 1600) }, maker)
    let told = 0
    resources.onArrive(() => {
      told++
    })
    const design = designOf(['photo'])
    expect(resources.screen(design).images.get('photo')?.width()).toBe(1)
    resources.screen(design)
    expect([jobs.length, fetched]).toEqual([1, []])
    jobs[0]?.()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(told).toBe(1)
    expect(resources.screen(design).images.get('photo')?.width()).toBe(1024)
    expect(resources.alpha('photo')?.imageWidth).toBe(2400)
    resources.destroy()
    done.abort()
  })

  it("asks only for the images of the frames the screen shows, and another page's once it is drawn", () => {
    const { resources, fetched, done } = opened({})
    const design = twoPages()
    resources.screen(design, ['f'])
    expect(fetched).toEqual(['here'])
    resources.screen(design, ['g'])
    expect(fetched).toEqual(['here', 'there'])
    resources.destroy()
    done.abort()
  })

  it('asks for the brand’s logo where a picture is bound to it, once the brand kit’s values are set', () => {
    const { resources, fetched, done } = opened({})
    const design = designOf(['old-logo'])
    Object.assign(design.nodes['old-logo'] as object, { bindings: { image: 'brand:logo' } })
    resources.screen(design, ['f'])
    expect(fetched).toEqual(['old-logo'])
    resources.setVariables({ 'brand:logo': 'new-logo' })
    resources.screen(design, ['f'])
    expect(fetched).toEqual(['old-logo', 'new-logo'])
    resources.destroy()
    done.abort()
  })

  it("loads an export's images as bytes, decoding none", async () => {
    const photo = halfPng(1200, 800)
    const { resources, fetched, done } = opened({}, undefined, { there: photo })
    resources.load(twoPages(), ['g'])
    await resources.loaded()
    expect(fetched).toEqual(['there'])
    expect(resources.bytes().images.there).toBe(photo)
    expect(resources.resources().images.has('there')).toBe(false)
    resources.destroy()
    done.abort()
  })

  it("gives the stage the same resources while a copy is made for another page's thumbnail", () => {
    const { resources, done } = opened({ here: halfPng(1200, 800), there: halfPng(1200, 800) })
    const design = twoPages()
    const stage = resources.screen(design, ['f'])
    const thumbnail = resources.screen(design, ['g'])
    expect(thumbnail.images.has('there')).toBe(true)
    expect(resources.screen(design, ['f'])).toBe(stage)
    expect([...stage.images.keys()]).toEqual(['here'])
    resources.destroy()
    done.abort()
  })

  it('tells when its bytes change: images or fonts arrive, or the brand kit’s values are set, each a new object', async () => {
    const png = halfPng(20, 10)
    const [shipped] = loadFontFiles()
    const done = new AbortController()
    const resources = editorResources({
      ck,
      cache: resourceCache(ck),
      first: { fonts: [], fallbackFamilies: [], images: {} },
      firstFonts: NO_FONTS,
      sources: {
        assetBytes: () => Promise.resolve(png),
        ...testCatalog([{ family: 'Extra Sans', bytes: shipped?.bytes ?? new Uint8Array() }]).sources,
      },
      connected: () => true,
      status: () => {},
      signal: done.signal,
    })
    const seen = [resources.bytes()]
    resources.onBytes(() => seen.push(resources.bytes()))
    resources.load(designOf(['photo']), ['f'])
    await resources.loaded()
    expect(seen).toHaveLength(2)
    expect(seen[1]?.images.photo).toBe(png)
    expect(resources.resources().familyFeatures?.get('Extra Sans')).toBeUndefined()
    await resources.loadUses([{ family: 'Extra Sans', weight: 400, style: 'normal' }])
    expect(seen).toHaveLength(3)
    expect(seen[2]?.fonts.map((f) => f.family)).toEqual(['Extra Sans'])
    // The features its files have are read once they arrive.
    expect(resources.resources().familyFeatures?.get('Extra Sans')?.has('liga')).toBe(true)
    resources.setVariables({})
    expect(seen).toHaveLength(4)
    expect(new Set(seen).size).toBe(4)
    resources.destroy()
    done.abort()
  })
})

describe('editorResources loading fonts', () => {
  it("fetches only the files of the faces a design's texts are drawn in, and a weight's face once a text asks for it", async () => {
    const { faces, catalog } = brandSans()
    const { resources, end } = fromCatalog(catalog.sources)
    resources.load(textsIn('Brand Sans', [{ weight: 400 }]), ['f'])
    await resources.loaded()
    expect(catalog.asked).toEqual([['Brand Sans']])
    expect(catalog.fetched).toEqual(['Brand Sans 400 normal'])
    expect(resources.facesOf('Brand Sans').map((face) => `${face.weight} ${face.style}`)).toEqual([
      '400 normal',
      '700 normal',
      '900 normal',
      '400 italic',
    ])
    resources.load(textsIn('Brand Sans', [{ weight: 400 }, { weight: 800 }]), ['f'])
    expect(resources.pending('Brand Sans')).toBe(true)
    await resources.loaded()
    // 800 draws in the 900, CSS's nearest heavier weight.
    expect(catalog.asked).toHaveLength(1)
    expect(catalog.fetched).toEqual(['Brand Sans 400 normal', 'Brand Sans 900 normal'])
    expect(resources.bytes().fonts.map((font) => font.bytes)).toEqual([faces[0]?.bytes, faces[2]?.bytes])
    end()
  })

  it('registers each family’s files in the catalog’s order, and gives an export only the faces its design uses', async () => {
    const { faces, catalog } = brandSans()
    const { resources, end } = fromCatalog(catalog.sources)
    await resources.loadUses([{ family: 'Brand Sans', weight: 700, style: 'italic' }])
    await resources.loadUses([{ family: 'Brand Sans', weight: 400, style: 'normal' }])
    // Italic text at 700 draws in the upright 700, which CanvasKit scores above the italic 400.
    expect(catalog.fetched).toEqual(['Brand Sans 700 normal', 'Brand Sans 400 normal'])
    expect(resources.bytes().fonts.map((font) => font.bytes)).toEqual([faces[0]?.bytes, faces[1]?.bytes])
    const regular = textsIn('Brand Sans', [{ weight: 400 }])
    expect(resources.bytesFor(regular).fonts.map((font) => font.bytes)).toEqual([faces[0]?.bytes])
    end()
  })

  it('fetches a face again at the next redraw after its file failed to come offline, and not on every redraw', async () => {
    const { catalog } = brandSans()
    let online = false
    let calls = 0
    const done = new AbortController()
    const resources = editorResources({
      ck,
      cache: resourceCache(ck),
      first: { fonts: [], fallbackFamilies: [], images: {} },
      firstFonts: NO_FONTS,
      sources: {
        ...catalog.sources,
        fontFile: (face) => {
          calls++
          return online ? catalog.sources.fontFile(face) : Promise.reject(new Error('offline'))
        },
      },
      connected: () => online,
      status: () => {},
      signal: done.signal,
    })
    const design = textsIn('Brand Sans', [{ weight: 700 }])
    resources.screen(design)
    await resources.loaded()
    expect(calls).toBe(1)
    online = true
    resources.screen(design)
    await resources.loaded()
    resources.screen(design)
    await resources.loaded()
    expect(calls).toBe(2)
    expect(catalog.fetched).toEqual(['Brand Sans 700 normal'])
    resources.destroy()
    done.abort()
  })

  it("fetches a variable face's file once, whatever weights its texts ask for", async () => {
    const catalog = testCatalog([
      { family: 'Vary Sans', weight: 400, weights: { min: 100, max: 900 }, bytes: variableTestFont() },
      { family: 'Vary Sans', weight: 400, weights: { min: 100, max: 900 }, style: 'italic', bytes: variableTestFont() },
    ])
    const { resources, end } = fromCatalog(catalog.sources)
    resources.load(textsIn('Vary Sans', [{ weight: 100 }, { weight: 550 }, { weight: 900 }]), ['f'])
    await resources.loaded()
    expect(catalog.fetched).toEqual(['Vary Sans 400 normal'])
    end()
  })
})
