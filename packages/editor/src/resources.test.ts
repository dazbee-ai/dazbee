import { describe, expect, it } from 'vitest'

import { loadFontFiles } from '@dazbee/fonts/node'
import { resourceCache } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type Design, type DesignInput, parseDesign } from '@dazbee/schema'

import { opacityAt } from './canvas/alpha-map.ts'
import { type CopyMaker, madeCopy } from './display-copies.ts'
import { NO_FONTS } from './font-loads.ts'
import { editorResources } from './resources.ts'
import { testCatalog } from './test-catalog.ts'
import { testEditor } from './test-editor.ts'

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

  it('gets an image ready to draw only once the image worker has made its copy, so nothing draws it clear', async () => {
    const jobs: (() => void)[] = []
    const maker: CopyMaker = (bytes, side) =>
      new Promise((resolve) => jobs.push(() => resolve(madeCopy(ck, bytes, side))))
    const { resources, done } = opened({}, maker, { photo: halfPng(2400, 1600) })
    let ready = false
    const preparing = resources.prepareImages(['photo']).then(() => {
      ready = true
    })
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect([ready, jobs.length]).toEqual([false, 1])
    jobs[0]?.()
    await preparing
    expect(
      resources
        .screen(designOf(['photo']))
        .images.get('photo')
        ?.width(),
    ).toBe(1024)
    resources.destroy()
    done.abort()
  })

  it('settles getting an image ready once the editor ends, whatever became of its bytes', async () => {
    const { resources, done } = opened({}, undefined, {})
    const preparing = resources.prepareImages(['gone'])
    done.abort()
    await expect(preparing).resolves.toBeUndefined()
    resources.destroy()
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

  it("draws a text in a shipped family in the brand's upload of that family's name, and in our file for a brand without one", async () => {
    // A file of other letters under the name of a font we ship, and the same file under a name of its own.
    const upload = new Uint8Array(loadFontFiles().find((f) => f.file === 'NotoSans-Bold.ttf')?.bytes ?? [])
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
