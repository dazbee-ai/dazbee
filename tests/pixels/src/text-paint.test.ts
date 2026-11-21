// Text paint (#108): a gradient paints a text or a run in the text layer's box, its underline with
// it, and an outline under the letters leaves their shape whole and reaches its width past them, on
// the CPU surface and in PDF and SVG exports; superscripts and subscripts are drawn in the font's own
// glyphs or made up smaller and moved off the baseline, alike in each.
import { afterAll, describe, expect, it } from 'vitest'

import { layerReach, makeResources, render, renderDesign, renderVector } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { parseDesign } from '@dazbee/schema'

import { fixtureResources } from './pixels.ts'
import { pdfText, rasterisePdf, rasteriseSvg, startPdfium } from './vector.ts'

type Rgba = [number, number, number, number]

const ck = await loadCanvasKit()
const bytes = fixtureResources()
const pdfium = await startPdfium(afterAll)

const WIDTH = 760
const HEIGHT = 160
const RED = '#FF0000FF'
const BLUE = '#0000FFFF'
const GREEN = '#00A000FF'
/** Red at the box's left edge to blue at its right. */
const SWEEP = {
  type: 'linear',
  from: { x: 0, y: 0.5 },
  to: { x: 1, y: 0.5 },
  stops: [
    { offset: 0, color: RED },
    { offset: 1, color: BLUE },
  ],
}
const TEXT = 'IIIIIIIIIIII'

/** A frame holding one text at `x`, in a box 600 wide, in heavy capitals that fill much of it. */
function design(style: Record<string, unknown>, props: Record<string, unknown> = {}, x = 20) {
  return {
    meta: { designId: 'text-paint', name: 'Text paint' },
    pages: { p1: { name: 'Page 1', order: 'a0' } },
    frames: {
      f: {
        pageId: 'p1',
        name: 'Frame',
        width: WIDTH,
        height: HEIGHT,
        x: 0,
        y: 0,
        fills: [{ type: 'solid', color: '#FFFFFFFF' }],
        order: 'a0',
      },
    },
    nodes: {
      t: {
        type: 'text',
        parentId: 'f',
        link: 't',
        index: 'a0',
        name: 'Text',
        props: {
          x,
          y: 20,
          width: 600,
          height: 120,
          boxMode: 'fixed',
          text: TEXT,
          style: { fontFamily: 'Noto Sans', fontSize: 96, fontWeight: 900, color: GREEN, ...style },
          ...props,
        },
      },
    },
  }
}

const drawn = (json: unknown) => renderDesign(ck, json, 'f', bytes).pixels
const at = (pixels: Uint8Array, x: number, y: number): Rgba => {
  const i = (y * WIDTH + x) * 4
  return [pixels[i] ?? 0, pixels[i + 1] ?? 0, pixels[i + 2] ?? 0, pixels[i + 3] ?? 0]
}
const white = ([r, g, b]: Rgba) => r > 250 && g > 250 && b > 250
/** The columns of row `y` that anything is drawn in. */
const inked = (pixels: Uint8Array, y: number) =>
  Array.from({ length: WIDTH }, (_, x) => x).filter((x) => !white(at(pixels, x, y)))
/** Whether a pixel is green or a green edge over white: the text's own colour. */
const greenish = ([r, g, b]: Rgba) => g > r && g > b
/** Whether a pixel is the colour given, to within a step either way in each channel. */
const near = (pixel: Rgba, hex: string) =>
  [1, 3, 5].every((c, i) => Math.abs((pixel[i] ?? 0) - Number.parseInt(hex.slice(c, c + 2), 16)) <= 2)

describe('gradient text', () => {
  it('paints the text with the gradient across its box, red at its left and blue at its right', () => {
    const pixels = drawn(design({ gradient: SWEEP }))
    const ink = inked(pixels, 80)
    const left = at(pixels, ink[1] ?? 0, 80)
    const right = at(pixels, ink.at(-2) ?? 0, 80)
    expect(left[0]).toBeGreaterThan(200)
    expect(left[2]).toBeLessThan(80)
    expect(right[2]).toBeGreaterThan(160)
    expect(right[0]).toBeLessThan(120)
    expect(ink.some((x) => near(at(pixels, x, 80), GREEN))).toBe(false)
  })

  it('keeps the gradient in the box wherever the text is placed', () => {
    const here = drawn(design({ gradient: SWEEP }, {}, 20))
    const there = drawn(design({ gradient: SWEEP }, {}, 120))
    for (const x of inked(here, 80)) expect(at(there, x + 100, 80)).toEqual(at(here, x, 80))
  })

  it('paints a run with the part of the box’s gradient its characters cover', () => {
    const whole = drawn(design({ gradient: SWEEP }))
    const run = drawn(design({}, { runs: [{ start: 3, end: 9, style: { gradient: SWEEP } }] }))
    const ink = inked(run, 80)
    const swept = ink.filter((x) => !greenish(at(run, x, 80)))
    expect(swept.length).toBeGreaterThan(ink.length / 3)
    for (const x of swept) expect(at(run, x, 80)).toEqual(at(whole, x, 80))
  })

  it('shows a run’s colour over a gradient text, and the colour again when the gradient is hidden', () => {
    const coloured = drawn(design({ gradient: SWEEP }, { runs: [{ start: 0, end: 4, style: { color: GREEN } }] }))
    expect(near(at(coloured, inked(coloured, 80)[1] ?? 0, 80), GREEN)).toBe(true)
    const hidden = drawn(design({ gradient: { ...SWEEP, visible: false } }))
    expect(inked(hidden, 80).every((x) => white(at(hidden, x, 80)) || !near(at(hidden, x, 80), RED))).toBe(true)
    expect(inked(hidden, 80).some((x) => near(at(hidden, x, 80), GREEN))).toBe(true)
  })

  it('paints its underline with the gradient too', () => {
    const pixels = drawn(design({ gradient: SWEEP, underline: true }, { text: '____________' }))
    const row = Array.from({ length: HEIGHT }, (_, y) => y).find((y) => inked(pixels, y).length > 400) ?? 0
    const ink = inked(pixels, row)
    expect(at(pixels, ink[2] ?? 0, row)[0]).toBeGreaterThan(200)
    expect(at(pixels, ink.at(-3) ?? 0, row)[2]).toBeGreaterThan(160)
    expect(ink.some((x) => near(at(pixels, x, row), GREEN))).toBe(false)
  })

  it('draws a gradient underline in an SVG as its image, also where the underline comes from another run', () => {
    const svg = (runs: unknown[]) => new TextDecoder().decode(renderVector(ck, design({}, { runs }), 'f', bytes, 'svg'))
    expect(svg([{ start: 0, end: 6, style: { gradient: SWEEP } }])).not.toContain('<image')
    const crossing = [
      { start: 0, end: 6, style: { gradient: SWEEP } },
      { start: 3, end: 9, style: { underline: true } },
    ]
    expect(svg(crossing)).toContain('<image')
  })

  it('keeps the text as text in a PDF, and draws it in the gradient there and in an SVG', async () => {
    const json = design({ gradient: SWEEP })
    const pdf = renderVector(ck, json, 'f', bytes, 'pdf')
    expect((await pdfText(pdfium, pdf)).replaceAll(/\s/g, '')).toBe(TEXT)
    const cpu = drawn(json)
    for (const pixels of [
      (await rasterisePdf(pdfium, pdf)).pixels,
      rasteriseSvg(renderVector(ck, json, 'f', bytes, 'svg')).pixels,
    ]) {
      const ink = inked(cpu, 80)
      const left = at(pixels, ink[1] ?? 0, 80)
      const right = at(pixels, ink.at(-2) ?? 0, 80)
      expect(left[0]).toBeGreaterThan(200)
      expect(right[2]).toBeGreaterThan(160)
    }
  })
})

describe('outline under the letters', () => {
  const outline = (width: number, under: boolean) => ({ outline: { width, color: BLUE, ...(under ? { under } : {}) } })

  it('leaves every pixel of the letters’ fill as it was', () => {
    const plain = drawn(design({ color: RED }))
    const under = drawn(design({ color: RED, ...outline(8, true) }))
    const over = drawn(design({ color: RED, ...outline(8, false) }))
    const filled = Array.from({ length: WIDTH * HEIGHT }, (_, i) => i).filter((i) =>
      near(at(plain, i % WIDTH, Math.floor(i / WIDTH)), RED),
    )
    expect(filled.length).toBeGreaterThan(2000)
    const kept = (pixels: Uint8Array) =>
      filled.filter((i) => near(at(pixels, i % WIDTH, Math.floor(i / WIDTH)), RED)).length
    expect(kept(under)).toBe(filled.length)
    expect(kept(over)).toBeLessThan(filled.length * 0.9)
  })

  it('reaches its whole width past the letters, as far as an outline over them twice as wide', () => {
    const under = drawn(design({ color: RED, ...outline(8, true) }))
    const over = drawn(design({ color: RED, ...outline(16, false) }))
    const [underLeft] = inked(under, 80)
    const [overLeft] = inked(over, 80)
    expect(Math.abs((underLeft ?? 0) - (overLeft ?? 0))).toBeLessThanOrEqual(1)
  })

  it('counts its whole width in the text’s reach', () => {
    const resources = makeResources(ck, bytes)
    const reach = (style: Record<string, unknown>) => {
      const parsed = parseDesign(design(style))
      if (!parsed.success) throw new Error(parsed.errors.join('\n'))
      const layer = render(parsed.design, 'f').layers[0]
      if (!layer) throw new Error('no layer')
      return layerReach(ck, layer, resources)
    }
    const over = reach(outline(8, false))
    const under = reach(outline(8, true))
    expect(over.x - under.x).toBeCloseTo(4, 5)
    resources.delete()
  })

  it('draws under a gradient fill in a PDF and an SVG as on the CPU surface', async () => {
    const json = design({ gradient: SWEEP, ...outline(8, true) })
    const cpu = drawn(json)
    for (const pixels of [
      (await rasterisePdf(pdfium, renderVector(ck, json, 'f', bytes, 'pdf'))).pixels,
      rasteriseSvg(renderVector(ck, json, 'f', bytes, 'svg')).pixels,
    ]) {
      const [left] = inked(cpu, 80)
      expect(Math.abs((inked(pixels, 80)[0] ?? 0) - (left ?? 0))).toBeLessThanOrEqual(1)
    }
  })
})

describe('superscript and subscript', () => {
  /** The first and last rows anything is drawn in. */
  const inkRows = (pixels: Uint8Array) => {
    const rows = Array.from({ length: HEIGHT }, (_, y) => y).filter((y) => inked(pixels, y).length > 0)
    return { top: rows[0] ?? -1, bottom: rows.at(-1) ?? -1 }
  }
  const scripted = (text: string, fontFamily: string, features: Record<string, boolean> = {}) =>
    design({ fontFamily, fontWeight: 400, features }, { text })

  it('raises a made-up superscript 35 % of an em, its letters at 60 % of the size, where the font has no glyph for a letter', () => {
    const plain = inkRows(drawn(scripted('xxxx', 'Noto Sans')))
    const raised = inkRows(drawn(scripted('xxxx', 'Noto Sans', { sups: true })))
    expect(plain.bottom - raised.bottom).toBeGreaterThanOrEqual(33)
    expect(plain.bottom - raised.bottom).toBeLessThanOrEqual(35)
    expect((raised.bottom - raised.top) / (plain.bottom - plain.top)).toBeCloseTo(0.6, 1)
  })

  it('draws a made-up superscript whole where a colour starts inside a letter, at an accent drawn on it', () => {
    const style = { fontFamily: 'Noto Sans', fontWeight: 400, features: { sups: true } }
    const whole = inkRows(drawn(design(style, { text: 'xé' })))
    const split = inkRows(drawn(design(style, { text: 'xé', runs: [{ start: 2, end: 3, style: { color: RED } }] })))
    expect(split.top).toBe(whole.top)
  })

  it('lowers a made-up subscript 7.5 % of an em', () => {
    const plain = inkRows(drawn(scripted('xxxx', 'Noto Sans')))
    const lowered = inkRows(drawn(scripted('xxxx', 'Noto Sans', { subs: true })))
    expect(lowered.bottom - plain.bottom).toBeGreaterThanOrEqual(6)
    expect(lowered.bottom - plain.bottom).toBeLessThanOrEqual(8)
  })

  it.each([
    ['the font’s own superscript digits', '2222', 'Noto Sans', { sups: true }, '²²²²'],
    ['the font’s own subscript digits', '2222', 'Noto Sans', { subs: true }, '₂₂₂₂'],
    ['a made-up superscript', 'xxxx', 'Noto Sans', { sups: true }, 'xxxx'],
    ['a made-up subscript in a font with none', 'ااااا', 'Noto Naskh Arabic', { subs: true }, 'ااااا'],
    ['a made-up superscript in a font with none', 'ااااا', 'Noto Naskh Arabic', { sups: true }, 'ااااا'],
  ])(
    'draws %s in a PDF and an SVG where the CPU surface does, the PDF keeping the text as its glyphs read',
    async (_, text, family, features, read) => {
      const json = scripted(text, family, features)
      const cpu = inkRows(drawn(json))
      const pdf = renderVector(ck, json, 'f', bytes, 'pdf')
      expect((await pdfText(pdfium, pdf)).replaceAll(/\s/g, '')).toBe(read)
      for (const pixels of [
        (await rasterisePdf(pdfium, pdf)).pixels,
        rasteriseSvg(renderVector(ck, json, 'f', bytes, 'svg')).pixels,
      ]) {
        const rows = inkRows(pixels)
        expect(Math.abs(rows.top - cpu.top)).toBeLessThanOrEqual(1)
        expect(Math.abs(rows.bottom - cpu.bottom)).toBeLessThanOrEqual(1)
      }
    },
  )
})
