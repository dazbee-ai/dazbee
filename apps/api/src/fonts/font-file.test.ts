import { describe, expect, it } from 'vitest'

import { emojiTestFont, TEST_EMOJI, variableTestFont } from '@dazbee/fonts/test-fonts'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { readImageHeader } from '@dazbee/schema'

import { fontFile } from '../test-files.ts'
import { fontPreview, readFontInfo, withoutSvgTable } from './font-file.ts'

/** `text` drawn at 48 pixels in a font's bytes on a white strip, as RGBA. */
async function drawnIn(font: Uint8Array, text: string) {
  const ck = await loadCanvasKit()
  const provider = ck.TypefaceFontProvider.Make()
  provider.registerFont(font, 'Font')
  const fonts = ck.FontCollection.Make()
  fonts.setDefaultFontManager(provider)
  const builder = ck.ParagraphBuilder.MakeFromFontCollection(
    new ck.ParagraphStyle({ textStyle: { color: ck.BLACK, fontFamilies: ['Font'], fontSize: 48 } }),
    fonts,
  )
  builder.addText(text)
  const paragraph = builder.build()
  paragraph.layout(600)
  const surface = ck.MakeSurface(600, 80)
  if (!surface) throw new Error('no surface')
  surface.getCanvas().clear(ck.WHITE)
  surface.getCanvas().drawParagraph(paragraph, 0, 0)
  const pixels = surface.makeImageSnapshot().readPixels(0, 0, {
    width: 600,
    height: 80,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  })
  for (const x of [paragraph, builder, surface, fonts, provider]) x.delete()
  return pixels
}

/** A font's tables by tag, each as its bytes. */
function tablesOf(bytes: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tables = new Map<string, Uint8Array>()
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + i * 16
    const tag = new TextDecoder().decode(bytes.subarray(record, record + 4))
    const at = view.getUint32(record + 8)
    tables.set(tag, bytes.subarray(at, at + view.getUint32(record + 12)))
  }
  return tables
}

/** Vary Sans with its one axis rewritten: its tag and range, its axes said to run past the table, or their size too small. */
function withAxis({ tag = 'wght', min = 100, at = 400, max = 900, count = 1, size = 20 } = {}) {
  const bytes = variableTestFont()
  const view = new DataView(bytes.buffer)
  const fvar = tablesOf(bytes).get('fvar')
  if (!fvar) throw new Error('no fvar')
  const table = fvar.byteOffset
  const axis = table + view.getUint16(table + 4)
  bytes.set(new TextEncoder().encode(tag), axis)
  for (const [offset, value] of [
    [4, min],
    [8, at],
    [12, max],
  ] as const)
    view.setInt32(axis + offset, value * 65536)
  view.setUint16(table + 8, count)
  view.setUint16(table + 10, size)
  return bytes
}

/** Vary Sans whose fvar table is said to be 8 bytes long, shorter than its header. */
function shortFvar() {
  const bytes = variableTestFont()
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < view.getUint16(4); i++) {
    const record = 12 + i * 16
    if (new TextDecoder().decode(bytes.subarray(record, record + 4)) === 'fvar') view.setUint32(record + 12, 8)
  }
  return bytes
}

describe('readFontInfo', () => {
  it('reads the family, weight and style from the font’s own tables', () => {
    expect(readFontInfo(fontFile('NotoSans-Regular.ttf'))).toEqual({
      contentType: 'font/ttf',
      family: 'Noto Sans',
      weight: 400,
      style: 'normal',
    })
    expect(readFontInfo(fontFile('NotoSans-ExtraBold.ttf'))).toEqual({
      contentType: 'font/ttf',
      family: 'Noto Sans',
      weight: 800,
      style: 'normal',
    })
    expect(readFontInfo(fontFile('NotoNaskhArabic-Bold.ttf'))).toMatchObject({
      family: 'Noto Naskh Arabic',
      weight: 700,
    })
  })

  it('reads a variable font’s weight axis: its range, and its default as the weight', () => {
    expect(readFontInfo(variableTestFont())).toEqual({
      contentType: 'font/ttf',
      family: 'Vary Sans',
      weight: 400,
      style: 'normal',
      weights: { min: 100, max: 900 },
    })
    expect(readFontInfo(withAxis({ min: 250.4, at: 350, max: 749.6 }))).toMatchObject({
      weight: 350,
      weights: { min: 250, max: 750 },
    })
    // A default outside the range, or past 1000, is taken back into it.
    expect(readFontInfo(withAxis({ min: 300, at: 200, max: 1200 }))).toMatchObject({
      weight: 300,
      weights: { min: 300, max: 1000 },
    })
  })

  it('reads a font whose weight doesn’t vary as one weight', () => {
    expect(readFontInfo(fontFile('NotoSans-Regular.ttf'))).not.toHaveProperty('weights')
    for (const bytes of [
      withAxis({ tag: 'wdth' }),
      withAxis({ min: 400, max: 400 }),
      withAxis({ count: 400 }),
      withAxis({ size: 12 }),
      shortFvar(),
    ])
      expect(readFontInfo(bytes)).toEqual({
        contentType: 'font/ttf',
        family: 'Vary Sans',
        weight: 400,
        style: 'normal',
      })
  })

  it('refuses what is not one TrueType or OpenType font', () => {
    const font = fontFile('NotoSans-Regular.ttf')
    expect(readFontInfo(new TextEncoder().encode('not a font at all, just some text'))).toBeNull()
    // WOFF2 and collections, by their signatures.
    expect(readFontInfo(new Uint8Array([...new TextEncoder().encode('wOF2'), ...font.subarray(4)]))).toBeNull()
    expect(readFontInfo(new Uint8Array([...new TextEncoder().encode('ttcf'), ...font.subarray(4)]))).toBeNull()
    // Cut short, so its tables run past the end.
    expect(readFontInfo(font.subarray(0, 2000))).toBeNull()
  })
})

describe('fontPreview', () => {
  it('draws the family’s name in the face as a PNG', async () => {
    const preview = await fontPreview(fontFile('NotoSans-Bold.ttf'), {
      family: 'Noto Sans',
      weight: 700,
      style: 'normal',
    })
    const header = readImageHeader(preview)
    expect(header?.contentType).toBe('image/png')
    expect(header?.height).toBe(48)
    expect(header?.width).toBeGreaterThan(100)
  })

  it('draws a variable face at the weight asked for, not its default', async () => {
    const draw = (weight: number) => fontPreview(variableTestFont(), { family: 'Vary Sans', weight, style: 'normal' })
    const [thin, regular, black] = await Promise.all([draw(100), draw(400), draw(900)])
    const ink = async (png: Uint8Array) => {
      const ck = await loadCanvasKit()
      const image = ck.MakeImageFromEncoded(png)
      if (!image) throw new Error('the preview is no image')
      const pixels = image.readPixels(0, 0, {
        width: image.width(),
        height: image.height(),
        colorType: ck.ColorType.RGBA_8888,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: ck.ColorSpace.SRGB,
      })
      image.delete()
      let alpha = 0
      for (let i = 3; i < (pixels?.length ?? 0); i += 4) alpha += pixels?.[i] ?? 0
      return alpha
    }
    const [a, b, c] = await Promise.all([ink(thin), ink(regular), ink(black)])
    expect(a).toBeLessThan(b)
    expect(b).toBeLessThan(c)
  })

  it('throws for bytes CanvasKit can’t read', async () => {
    await expect(fontPreview(new Uint8Array(100), { family: 'X', weight: 400, style: 'normal' })).rejects.toThrow(
      /can't read/,
    )
  })
})

// Each draw loads CanvasKit and the emoji font, seconds on a busy two-core CI runner.
describe('withoutSvgTable', { timeout: 30_000 }, () => {
  it('gives back a font with no SVG table as it is', () => {
    const font = fontFile('NotoSans-Regular.ttf')
    expect(withoutSvgTable(font)).toBe(font)
  })

  it('drops the SVG table and keeps every other table byte for byte, with a sound directory', () => {
    const font = emojiTestFont()
    const before = tablesOf(font)
    expect(before.has('SVG ')).toBe(true)
    const dropped = withoutSvgTable(font)
    const after = tablesOf(dropped)
    expect([...after.keys()]).toEqual([...before.keys()].filter((tag) => tag !== 'SVG '))
    for (const [tag, bytes] of after) if (tag !== 'head') expect(bytes, tag).toEqual(before.get(tag))
    expect(dropped.length).toBeLessThan(font.length - (before.get('SVG ')?.length ?? 0) + 16)
    // Every table starts on four bytes, as the format asks; the whole file sums to the magic number.
    const view = new DataView(dropped.buffer, dropped.byteOffset, dropped.byteLength)
    for (let i = 0; i < view.getUint16(4); i++) expect(view.getUint32(12 + i * 16 + 8) % 4).toBe(0)
    let sum = 0
    for (let at = 0; at < dropped.length; at += 4) sum = (sum + view.getUint32(at)) >>> 0
    expect(sum).toBe(0xb1b0afba)
    expect(readFontInfo(dropped)).toEqual(readFontInfo(font))
  })

  it('leaves a font that draws the same pixels', async () => {
    const font = emojiTestFont()
    const before = await drawnIn(font, TEST_EMOJI)
    expect(before?.some((v, i) => i % 4 === 0 && v < 200)).toBe(true)
    expect(await drawnIn(withoutSvgTable(font), TEST_EMOJI)).toEqual(before)
  })
})
