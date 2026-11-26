import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { DEFAULT_EXPORT_NAME } from '@dazbee/schema'

import { crc32, exportDesign, fileName, readZip, zip } from './index.ts'

const ck = await loadCanvasKit()
const bytes = {
  fonts: loadFontFiles().map((f) => ({ family: f.family, bytes: f.bytes })),
  fallbackFamilies: [...FALLBACK_FAMILIES],
  images: {},
}

const red = [{ type: 'solid', color: '#FF000080' }]
const box = {
  type: 'graphic',
  index: 'a0',
  name: 'Box',
  props: {
    x: 10,
    y: 10,
    width: 40,
    height: 40,
    shape: { kind: 'rect' },
    fills: [{ type: 'solid', color: '#0000FFFF' }],
  },
}
const title = {
  type: 'text',
  index: 'a0',
  name: 'Title',
  props: {
    x: 4,
    y: 4,
    width: 80,
    height: 40,
    text: 'Sale',
    style: { fontFamily: 'Noto Sans', fontSize: 24, color: '#111111FF' },
  },
}

/** Two pages named alike, each with a square frame and a story frame holding linked copies. */
const design = {
  meta: { designId: 'd', name: 'Summer: sale' },
  pages: {
    p1: { name: 'Hero', order: 'a0' },
    p2: { name: 'Hero', order: 'a1' },
  },
  frames: {
    'p1-sq': { pageId: 'p1', name: 'Square', width: 120, height: 120, x: 0, y: 0, fills: red, order: 'a0' },
    'p1-story': { pageId: 'p1', name: 'Story 9:16', width: 90, height: 160, x: 320, y: 0, fills: red, order: 'a1' },
    'p2-sq': { pageId: 'p2', name: 'Square', width: 120, height: 120, x: 0, y: 0, fills: [], order: 'a0' },
    'p2-story': { pageId: 'p2', name: 'Story 9:16', width: 90, height: 160, x: 320, y: 0, fills: [], order: 'a1' },
  },
  nodes: {
    box: { ...box, parentId: 'p1-sq', link: 'box' },
    'story-box': { ...box, parentId: 'p1-story', link: 'box' },
    title: { ...title, parentId: 'p2-sq', link: 'title' },
    'story-title': { ...title, parentId: 'p2-story', link: 'title' },
  },
}

const pixelAt = (encoded: Uint8Array, x: number, y: number) => {
  const image = ck.MakeImageFromEncoded(encoded)
  if (!image) throw new Error('could not decode')
  const px = image.readPixels(x, y, {
    width: 1,
    height: 1,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  })
  const size = [image.width(), image.height()]
  image.delete()
  return { px: [...(px as Uint8Array)], size }
}

/** A file's pixels, row by row, unpremultiplied. */
const pixelsOf = (encoded: Uint8Array) => {
  const image = ck.MakeImageFromEncoded(encoded)
  if (!image) throw new Error('could not decode')
  try {
    const info = {
      width: image.width(),
      height: image.height(),
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    }
    return [...(image.readPixels(0, 0, info) as Uint8Array)]
  } finally {
    image.delete()
  }
}

describe('exportDesign', () => {
  it('one frame is one PNG, named after the frame, with its transparency', () => {
    const file = exportDesign(ck, design, { frameIds: ['p1-sq'], type: 'png' }, bytes)
    expect(file.name).toBe('Square.png')
    expect(file.type).toBe('image/png')
    const { px, size } = pixelAt(file.bytes, 100, 100)
    expect(size).toEqual([120, 120])
    expect(px[0]).toBe(255)
    expect(Math.abs((px[3] ?? 0) - 128)).toBeLessThanOrEqual(1)
    const named = exportDesign(
      ck,
      design,
      { frameIds: ['p1-sq'], type: 'png', name: '{design} - {page} - {frame}' },
      bytes,
    )
    expect(named.name).toBe('Summer- sale - Hero - Square.png')
    expect(named.bytes).toEqual(file.bytes)
  })

  it('a JPG is drawn over white, at the quality asked for', () => {
    const low = exportDesign(ck, design, { frameIds: ['p1-sq'], type: 'jpg', quality: 20 }, bytes)
    const high = exportDesign(ck, design, { frameIds: ['p1-sq'], type: 'jpg', quality: 95 }, bytes)
    expect(high.name).toBe('Square.jpg')
    expect(high.type).toBe('image/jpeg')
    expect(low.bytes.length).toBeLessThan(high.bytes.length)
    // Half red over white is pink.
    const [r = 0, g = 0, b = 0] = pixelAt(high.bytes, 100, 100).px
    expect(r).toBeGreaterThan(245)
    expect(Math.abs(g - 127)).toBeLessThanOrEqual(4)
    expect(Math.abs(b - 127)).toBeLessThanOrEqual(4)
  })

  it('several frames are one flat zip, in the order asked for, a name taken in any case numbered', () => {
    const seen: number[] = []
    const shouted = { ...design, frames: { ...design.frames, 'p2-sq': { ...design.frames['p2-sq'], name: 'SQUARE' } } }
    const file = exportDesign(
      ck,
      shouted,
      { frameIds: ['p1-sq', 'p2-sq', 'p1-story', 'p2-story'], type: 'png' },
      bytes,
      undefined,
      (done) => seen.push(done),
    )
    expect(file).toMatchObject({ name: 'Summer- sale.zip', type: 'application/zip' })
    expect(seen).toEqual([1, 2, 3, 4])
    const entries = readZip(file.bytes)
    expect(entries.map((e) => e.path)).toEqual(['Square.png', 'SQUARE 2.png', 'Story 9-16.png', 'Story 9-16 2.png'])
    expect(pixelAt(entries[2]?.bytes ?? new Uint8Array(), 0, 0).size).toEqual([90, 160])
    // Each one is the file a single export gives.
    expect(entries[3]?.bytes).toEqual(exportDesign(ck, design, { frameIds: ['p2-story'], type: 'png' }, bytes).bytes)
    const byPage = exportDesign(ck, design, { frameIds: ['p1-sq', 'p2-sq'], type: 'png', name: '{page}' }, bytes)
    expect(readZip(byPage.bytes).map((e) => e.path)).toEqual(['Hero.png', 'Hero 2.png'])
  })

  it('frames of a page that share a name are numbered by their place on the page, whichever are asked for', () => {
    const sale = (order: string, x: number) => ({
      pageId: 'p1',
      name: 'Sale',
      width: 40,
      height: 40,
      x,
      y: 0,
      fills: red,
      order,
    })
    const sales = {
      ...design,
      pages: { p1: design.pages.p1 },
      frames: { s1: sale('a0', 0), s2: sale('a1', 240), s3: sale('a2', 480) },
      nodes: {},
    }
    const names = (frameIds: string[], name?: string) =>
      readZip(exportDesign(ck, sales, { frameIds, type: 'png', name }, bytes).bytes).map((e) => e.path)
    expect(names(['s1', 's2', 's3'])).toEqual(['Sale.png', 'Sale 2.png', 'Sale 3.png'])
    expect(names(['s3', 's2'])).toEqual(['Sale 3.png', 'Sale 2.png'])
    expect(exportDesign(ck, sales, { frameIds: ['s3'], type: 'svg' }, bytes).name).toBe('Sale 3.svg')
    // The File names field's {frame} is the numbered name too.
    expect(names(['s2', 's3'], '{page} {frame}')).toEqual(['Hero Sale 2.png', 'Hero Sale 3.png'])
  })

  it('numbers frames by the names their files take, so frames filed alike are numbered, whichever are asked for', () => {
    const promo = (name: string, order: string) => ({ ...design.frames['p1-sq'], name, order })
    const promos = {
      ...design,
      pages: { p1: design.pages.p1 },
      frames: { a: promo('Sale/Promo', 'a0'), b: promo('Sale-Promo', 'a1') },
      nodes: {},
    }
    expect(
      readZip(exportDesign(ck, promos, { frameIds: ['a', 'b'], type: 'png' }, bytes).bytes).map((e) => e.path),
    ).toEqual(['Sale-Promo.png', 'Sale-Promo 2.png'])
    expect(exportDesign(ck, promos, { frameIds: ['b'], type: 'png' }, bytes).name).toBe('Sale-Promo 2.png')
    expect(exportDesign(ck, promos, { frameIds: ['a'], type: 'png' }, bytes).name).toBe('Sale-Promo.png')
  })

  it('the same request gives the same bytes every time', () => {
    const request = { frameIds: ['p1-sq', 'p2-sq', 'p1-story', 'p2-story'], type: 'jpg' }
    expect(exportDesign(ck, design, request, bytes).bytes).toEqual(exportDesign(ck, design, request, bytes).bytes)
  })

  it('draws no section, connector or star: every format gives the same bytes as the design without them', () => {
    const sectioned = {
      ...design,
      frames: {
        ...design.frames,
        'p1-sq': { ...design.frames['p1-sq'], sectionId: 'hero' },
        'p1-story': { ...design.frames['p1-story'], sectionId: 'hero', starred: true },
        'p2-sq': { ...design.frames['p2-sq'], sectionId: 'second' },
      },
      sections: {
        hero: { pageId: 'p1', title: 'Hero ads', order: 'a0' },
        second: { pageId: 'p2', title: 'Second', order: 'a0' },
      },
      connectors: {
        one: { pageId: 'p1', from: 'p1-sq', to: 'p1-story', order: 'a0' },
        two: { pageId: 'p2', from: 'second', to: 'p2-story', order: 'a0' },
        three: { pageId: 'p2', from: 'p2-story', to: 'p2-sq', order: 'a1' },
      },
    }
    const frameIds = Object.keys(design.frames)
    for (const type of ['png', 'jpg', 'pdf', 'svg'] as const) {
      const request = { frameIds, type }
      expect(exportDesign(ck, sectioned, request, bytes)).toEqual(exportDesign(ck, design, request, bytes))
    }
  })

  it('refuses a frame the design does not have, no frames, or a bad quality', () => {
    for (const id of ['nope', 'p1', 'box'])
      expect(() => exportDesign(ck, design, { frameIds: ['p1-sq', id], type: 'png' }, bytes)).toThrow(
        `no frame "${id}"`,
      )
    expect(() => exportDesign(ck, design, { frameIds: [], type: 'png' }, bytes)).toThrow()
    expect(() => exportDesign(ck, design, { frameIds: ['p1-sq'], type: 'jpg', quality: 0 }, bytes)).toThrow()
  })

  it('a PNG at 2x is twice the frame each way, drawn twice as dense, and named so', () => {
    const file = exportDesign(ck, design, { frameIds: ['p1-sq'], type: 'png', scale: 2 }, bytes)
    expect(file.name).toBe('Square@2x.png')
    expect(pixelAt(file.bytes, 0, 0).size).toEqual([240, 240])
    // The box starts at 10, so at 2x the 20th pixel is the frame's red and the 21st the box's blue.
    expect(pixelAt(file.bytes, 19, 19).px.slice(0, 3)).toEqual([255, 0, 0])
    expect(pixelAt(file.bytes, 20, 20).px).toEqual([0, 0, 255, 255])
    expect(pixelAt(file.bytes, 99, 99).px).toEqual([0, 0, 255, 255])
    expect(pixelAt(file.bytes, 100, 100).px.slice(0, 3)).toEqual([255, 0, 0])
    const three = exportDesign(ck, design, { frameIds: ['p1-story'], type: 'jpg', scale: 3 }, bytes)
    expect(three.name).toBe('Story 9-16@3x.jpg')
    expect(pixelAt(three.bytes, 0, 0).size).toEqual([270, 480])
    // 1x is as it was.
    expect(exportDesign(ck, design, { frameIds: ['p1-sq'], type: 'png', scale: 1 }, bytes)).toEqual(
      exportDesign(ck, design, { frameIds: ['p1-sq'], type: 'png' }, bytes),
    )
  })

  it('at 2x draws every edge, corner and blur at twice the density, as the design drawn twice as big', () => {
    /** Shapes off the pixel grid: an ellipse, a turned rounded card and a blurred dot, all `k` times as big. */
    const shapes = (k: number) => ({
      meta: { designId: 'd', name: 'Dense' },
      pages: { p1: { name: 'P', order: 'a0' } },
      frames: { f: { pageId: 'p1', name: 'F', width: 60 * k, height: 40 * k, x: 0, y: 0, fills: [], order: 'a0' } },
      nodes: {
        oval: {
          type: 'graphic',
          parentId: 'f',
          index: 'a0',
          link: 'oval',
          name: 'Oval',
          props: {
            x: 7.3 * k,
            y: 5.1 * k,
            width: 30.7 * k,
            height: 20.2 * k,
            shape: { kind: 'ellipse' },
            fills: [{ type: 'solid', color: '#7C4DFFFF' }],
          },
        },
        card: {
          type: 'graphic',
          parentId: 'f',
          index: 'a1',
          link: 'card',
          name: 'Card',
          props: {
            x: 30 * k,
            y: 8 * k,
            width: 22.5 * k,
            height: 14 * k,
            rotation: -6,
            shape: { kind: 'rect', cornerRadius: 4 * k },
            fills: [{ type: 'solid', color: '#00BFA5FF' }],
          },
        },
        dot: {
          type: 'graphic',
          parentId: 'f',
          index: 'a2',
          link: 'dot',
          name: 'Dot',
          props: {
            x: 10 * k,
            y: 22 * k,
            width: 15 * k,
            height: 12 * k,
            shape: { kind: 'ellipse' },
            fills: [{ type: 'solid', color: '#FFC400FF' }],
            effects: [{ type: 'layerBlur', radius: 3 * k }],
          },
        },
      },
    })
    const at2x = pixelsOf(exportDesign(ck, shapes(1), { frameIds: ['f'], type: 'png', scale: 2 }, bytes).bytes)
    const twiceAsBig = pixelsOf(exportDesign(ck, shapes(2), { frameIds: ['f'], type: 'png' }, bytes).bytes)
    const at1x = pixelsOf(exportDesign(ck, shapes(1), { frameIds: ['f'], type: 'png' }, bytes).bytes)
    // The 1x file made twice as big, each pixel four: what drawing at 1x and enlarging would give.
    const enlarged = Array.from({ length: 120 * 80 * 4 }, (_, i) => {
      const [x, y] = [Math.floor(i / 4) % 120, Math.floor(i / 4 / 120)]
      return at1x[(Math.floor(y / 2) * 60 + Math.floor(x / 2)) * 4 + (i % 4)]
    })
    const differing = (a: number[], b: (number | undefined)[]) =>
      a.filter((v, i) => Math.abs(v - (b[i] ?? 0)) > 1).length
    expect(at2x.length).toBe(120 * 80 * 4)
    expect(differing(at2x, twiceAsBig)).toBe(0)
    expect(differing(at2x, enlarged)).toBeGreaterThan(1000)
  })

  it('numbers a repeated name before the scale, in a zip named after the design', () => {
    const file = exportDesign(ck, design, { frameIds: ['p1-sq', 'p2-sq'], type: 'webp', scale: 2 }, bytes)
    expect(file.name).toBe('Summer- sale.zip')
    expect(readZip(file.bytes).map((e) => e.path)).toEqual(['Square@2x.webp', 'Square 2@2x.webp'])
  })

  it('PDF and SVG are vectors: the scale changes neither their bytes nor their names', () => {
    for (const type of ['pdf', 'svg'] as const) {
      const at1 = exportDesign(ck, design, { frameIds: ['p2-sq'], type }, bytes)
      const at3 = exportDesign(ck, design, { frameIds: ['p2-sq'], type, scale: 3 }, bytes)
      expect(at3).toEqual(at1)
      expect(at3.name).toBe(`Square.${type}`)
    }
  })

  it('a WebP keeps transparency, is the same every time, and at 100 is the PNG’s pixels exactly', () => {
    const file = exportDesign(ck, design, { frameIds: ['p1-sq'], type: 'webp' }, bytes)
    expect(file).toMatchObject({ name: 'Square.webp', type: 'image/webp' })
    const ascii = (from: number, to: number) => String.fromCharCode(...file.bytes.subarray(from, to))
    expect([ascii(0, 4), ascii(8, 12)]).toEqual(['RIFF', 'WEBP'])
    const { px, size } = pixelAt(file.bytes, 100, 100)
    expect(size).toEqual([120, 120])
    expect(px[0]).toBeGreaterThan(245)
    expect(Math.abs((px[3] ?? 0) - 128)).toBeLessThanOrEqual(1)
    expect(exportDesign(ck, design, { frameIds: ['p1-sq'], type: 'webp' }, bytes).bytes).toEqual(file.bytes)

    const text = { frameIds: ['p2-story'], type: 'webp', scale: 2 } as const
    const lossless = exportDesign(ck, design, { ...text, quality: 100 }, bytes)
    const png = exportDesign(ck, design, { ...text, type: 'png' }, bytes)
    expect(pixelsOf(lossless.bytes)).toEqual(pixelsOf(png.bytes))
    const lossy = exportDesign(ck, design, { ...text, quality: 40 }, bytes)
    expect(lossy.bytes.length).toBeLessThan(lossless.bytes.length)
  })

  it('refuses, before drawing any, frames past the size a raster export may have at the scale', () => {
    const big = {
      ...design,
      frames: {
        ...design.frames,
        wide: { ...design.frames['p2-sq'], name: 'Billboard', width: 6_000, height: 100, order: 'a2' },
      },
    }
    const drawn: number[] = []
    const run = (type: 'png' | 'jpg' | 'webp' | 'pdf', scale: 1 | 2 | 3) =>
      exportDesign(ck, big, { frameIds: ['p1-sq', 'wide'], type, scale }, bytes, undefined, (done) => drawn.push(done))
    for (const type of ['png', 'jpg', 'webp'] as const)
      expect(() => run(type, 3)).toThrow('too big to export at 3x: "Billboard"')
    expect(drawn).toEqual([])
    // At 2x it is 12,000 pixels wide, which fits; and a PDF has no pixels to count.
    expect(readZip(run('png', 2).bytes).map((e) => e.path)).toEqual(['Square@2x.png', 'Billboard@2x.png'])
    expect(run('pdf', 3).name).toBe('Summer- sale.zip')
  })
})

describe('fileName', () => {
  it('names are safe on every file system', () => {
    expect(fileName('{design}/{page}', { design: 'A:B', page: '..x', frame: 'f' })).toBe('A-B-..x')
    expect(fileName('{frame}', { design: 'd', page: 'p', frame: '   ' })).toBe('untitled')
  })

  it('fills in the design’s, page’s and frame’s names, names by the frame by default, and keeps other braces', () => {
    const values = { design: 'Cold brew', page: 'Cover', frame: 'Story' }
    expect(fileName('{design} - {page} - {frame}', values)).toBe('Cold brew - Cover - Story')
    expect(DEFAULT_EXPORT_NAME).toBe('{frame}')
    expect(fileName(DEFAULT_EXPORT_NAME, values)).toBe('Story')
    expect(fileName('{size}', values)).toBe('{size}')
  })
})

describe('zip', () => {
  it('writes a zip that unzip reads back, names in UTF-8', () => {
    const entries = [
      { path: 'Carré/a.txt', bytes: new TextEncoder().encode('hello') },
      { path: 'b.bin', bytes: new Uint8Array([0, 1, 2, 255]) },
    ]
    const dir = mkdtempSync(join(tmpdir(), 'zip-'))
    writeFileSync(join(dir, 'out.zip'), zip(entries))
    execFileSync('python3', [
      '-c',
      'import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',
      join(dir, 'out.zip'),
      join(dir, 'x'),
    ])
    expect(readFileSync(join(dir, 'x', 'Carré', 'a.txt'), 'utf8')).toBe('hello')
    expect([...readFileSync(join(dir, 'x', 'b.bin'))]).toEqual([0, 1, 2, 255])
    expect(readZip(zip(entries))).toEqual(entries)
  })
})

describe('crc32', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })
})
