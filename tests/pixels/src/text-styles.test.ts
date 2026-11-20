// The paragraph-level text styles (#47) laid out with the real fonts: lists keep their lines clear
// of the markers, paragraph spacing goes between paragraphs, maxLines cuts with an ellipsis, shrink
// to fit picks the largest size that fits, case keeps offsets, and editing still finds every offset.
// Letter spacing as a percentage follows the font size, and OpenType features change the glyphs.
import { afterAll, describe, expect, it } from 'vitest'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { caretAt, caretPosition, layoutText, makeResources, selectionBoxes } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { TextProps } from '@dazbee/schema'

const ck = await loadCanvasKit()
const resources = makeResources(ck, { fonts: loadFontFiles(), fallbackFamilies: [...FALLBACK_FAMILIES], images: {} })
afterAll(() => resources.delete())

const layout = (text: string, more: Record<string, unknown> = {}, family = 'Noto Sans') =>
  layoutText(
    ck,
    TextProps.parse({
      x: 0,
      y: 0,
      width: 320,
      height: 200,
      text,
      style: { fontFamily: family, fontSize: 32, color: '#000000FF' },
      ...more,
    }),
    resources,
  )

describe('paragraph text styles', () => {
  it('lays each paragraph out on its own, paragraph spacing apart', () => {
    const one = layout('Free delivery')
    const three = layout('Free delivery\nTwo-year warranty\nEasy returns', { paragraphSpacing: 10 })
    expect(three.blocks.map((b) => [b.start, b.end])).toEqual([
      [0, 13],
      [14, 31],
      [32, 44],
    ])
    const [a, b, c] = three.blocks
    expect(b?.y).toBeCloseTo((a?.height ?? 0) + 10, 5)
    expect(c?.y).toBeCloseTo((b?.y ?? 0) + (b?.height ?? 0) + 10, 5)
    expect(three.height).toBeCloseTo(3 * one.height + 20, 5)
    one.delete()
    three.delete()
  })

  it('a list puts every line of a paragraph clear of its marker, on the side the text starts', () => {
    const ltr = layout('Free delivery on every order over two thousand\n\nEasy returns', { list: 'number' })
    const [first, empty, last] = ltr.blocks
    // The empty paragraph has no marker and the numbering skips it.
    expect([first?.marker !== null, empty?.marker, last?.marker !== null]).toEqual([true, null, true])
    expect(first?.paragraph.getLineMetrics().length).toBeGreaterThan(1)
    for (const line of first?.paragraph.getLineMetrics() ?? [])
      expect((first?.x ?? 0) + line.left).toBeGreaterThanOrEqual(first?.markerX ?? 0)
    expect(first?.x).toBeGreaterThan(first?.marker?.getMaxIntrinsicWidth() ?? 0)
    // The marker sits on the first line's baseline.
    expect((first?.markerY ?? 0) + (first?.marker?.getLineMetrics()[0]?.baseline ?? 0)).toBeCloseTo(
      first?.paragraph.getLineMetrics()[0]?.baseline ?? NaN,
      3,
    )
    const rtl = layout('توصيل مجاني\nإرجاع سهل', { list: 'bullet' }, 'Noto Naskh Arabic')
    const [r] = rtl.blocks
    expect(r?.x).toBe(0)
    expect(r?.markerX).toBeGreaterThan(r?.paragraph.getMaxWidth() ?? NaN)
    ltr.delete()
    rtl.delete()
  })

  it('maxLines cuts the text with an ellipsis, and later paragraphs go', () => {
    const long = 'Every bean we sell is roasted in the harbour the same morning it ships to you'
    const cut = layout(`${long}\nSecond paragraph`, { maxLines: 2 })
    expect(cut.blocks).toHaveLength(1)
    expect(cut.blocks[0]?.paragraph.getLineMetrics()).toHaveLength(2)
    expect(cut.blocks[0]?.paragraph.didExceedMaxLines()).toBe(true)
    const exact = layout('One\nTwo\nThree', { maxLines: 2 })
    // Two whole paragraphs fill the lines; the second ends in an ellipsis for the third.
    expect(exact.blocks).toHaveLength(2)
    expect(exact.blocks[1]?.paragraph.getMaxIntrinsicWidth()).toBeGreaterThan(
      layout('Two').blocks[0]?.paragraph.getMaxIntrinsicWidth() ?? Infinity,
    )
    cut.delete()
    exact.delete()
  })

  it('shrink to fit picks the largest quarter point size that fits the box, between the bounds', () => {
    const text = 'Fresh roast every morning'
    const fits = layout(text, { boxMode: 'fixed', height: 60, shrinkToFit: { min: 10, max: 80 } })
    const size = fits.scale * 32
    expect(size * 4).toBeCloseTo(Math.round(size * 4), 6)
    expect(fits.height).toBeLessThanOrEqual(60)
    const bigger = layout(text, {
      boxMode: 'fixed',
      height: 60,
      style: { fontFamily: 'Noto Sans', fontSize: size + 0.25, color: '#000000FF' },
    })
    expect(bigger.height > 60 || bigger.blocks.some((b) => b.paragraph.getMinIntrinsicWidth() > 320)).toBe(true)
    // Too long to fit at the smallest size: drawn at the smallest.
    const floor = layout(text.repeat(20), { boxMode: 'fixed', height: 60, shrinkToFit: { min: 20, max: 80 } })
    expect(floor.scale * 32).toBe(20)
    // A short word in a big box grows to the largest.
    const ceiling = layout('Hi', { boxMode: 'fixed', height: 400, shrinkToFit: { min: 10, max: 120 } })
    expect(ceiling.scale * 32).toBe(120)
    for (const l of [fits, bigger, floor, ceiling]) l.delete()
  })

  it('case changes what is drawn, never the offsets', () => {
    const laid = layout('straße sale', { runs: [{ start: 0, end: 11, style: { textCase: 'upper' } }] })
    // ß has no one-letter capital, so it stays; the rest is upper case and as long as typed.
    expect(laid.blocks[0]?.text).toBe('STRAßE SALE')
    laid.delete()
    const title = layout('big summer-sale', {
      style: { fontFamily: 'Noto Sans', fontSize: 32, color: '#000000FF', textCase: 'title' },
    })
    expect(title.blocks[0]?.text).toBe('Big Summer-Sale')
    title.delete()
  })

  it('title case keeps a word going over an apostrophe after a letter or digit and before a letter', () => {
    const titled = layout("don't miss\nrock ’n’ roll\no'clock\n80's hits\nthe 90’s", {
      style: { fontFamily: 'Noto Sans', fontSize: 32, color: '#000000FF', textCase: 'title' },
    })
    // The apostrophes round "n" have a space on one side, so "n" starts a word.
    expect(titled.blocks.map((b) => b.text)).toEqual([
      "Don't Miss",
      'Rock ’N’ Roll',
      "O'clock",
      "80's Hits",
      'The 90’s',
    ])
    titled.delete()
  })

  it('the caret and selection reach every paragraph, an empty one included', () => {
    const text = 'One\n\nThree'
    const laid = layout(text, { paragraphSpacing: 12 })
    const [, empty, third] = laid.blocks
    const inEmpty = caretPosition(ck, laid, 4)
    expect(inEmpty.y).toBeCloseTo(empty?.y ?? NaN, 3)
    expect(inEmpty.height).toBeGreaterThan(0)
    expect(caretAt(ck, laid, 5, (empty?.y ?? 0) + 2)).toBe(4)
    expect(caretAt(ck, laid, 1000, (third?.y ?? 0) + 5)).toBe(text.length)
    const boxes = selectionBoxes(ck, laid, 1, 7)
    expect(boxes.map((b) => Math.round(b.y))).toEqual([0, Math.round(third?.y ?? NaN)])
    laid.delete()
  })
})

/** The glyphs a one-paragraph text is drawn with: each run's size and glyph ids, line by line. */
const glyphsOf = (laid: ReturnType<typeof layout>) =>
  laid.blocks[0]?.paragraph
    .getShapedLines()
    .flatMap((line) => line.runs.map((run) => ({ size: run.size, glyphs: [...run.glyphs] }))) ?? []
const style = (more: Record<string, unknown>, family = 'Noto Sans') => ({
  style: { fontFamily: family, fontSize: 32, color: '#000000FF', ...more },
})
const widthOf = (laid: ReturnType<typeof layout>) => laid.blocks[0]?.paragraph.getMaxIntrinsicWidth() ?? NaN

describe('letter spacing and OpenType features', () => {
  it('spaces letters by a percentage of the font size, as the same pixels at that size, at two sizes', () => {
    for (const fontSize of [32, 80]) {
      const percent = layout('Summer sale', style({ fontSize, letterSpacing: { unit: 'percent', value: 10 } }))
      const pixels = layout('Summer sale', style({ fontSize, letterSpacing: { unit: 'px', value: fontSize / 10 } }))
      const none = layout('Summer sale', style({ fontSize }))
      expect(widthOf(percent)).toBeCloseTo(widthOf(pixels), 3)
      expect(widthOf(percent) - widthOf(none)).toBeGreaterThan((fontSize / 10) * 10)
      for (const l of [percent, pixels, none]) l.delete()
    }
  })

  it('a run’s percentage is of the run’s own size', () => {
    const run = { start: 0, end: 6, style: { fontSize: 64, letterSpacing: { unit: 'percent', value: 10 } } }
    const percent = layout('Summer sale', { runs: [run] })
    const pixels = layout('Summer sale', {
      runs: [{ ...run, style: { fontSize: 64, letterSpacing: { unit: 'px', value: 6.4 } } }],
    })
    expect(widthOf(percent)).toBeCloseTo(widthOf(pixels), 3)
    percent.delete()
    pixels.delete()
  })

  it('turning ligatures off draws fi and ff as letters of their own', () => {
    const on = layout('office', {})
    const off = layout('office', style({ features: { liga: false } }))
    expect(glyphsOf(off).flatMap((r) => r.glyphs)).toHaveLength(6)
    expect(glyphsOf(on).flatMap((r) => r.glyphs).length).toBeLessThan(6)
    on.delete()
    off.delete()
  })

  it('tabular figures draw the digits with other glyphs, on a range of the text only', () => {
    // Noto Sans draws tabular figures unless told proportional ones (`pnum`), so the base asks for those.
    const proportional = style({ features: { pnum: true } })
    const plain = layout('1170 sold', proportional)
    const tabular = layout('1170 sold', {
      ...proportional,
      runs: [{ start: 0, end: 4, style: { features: { tnum: true } } }],
    })
    const glyphs = (laid: ReturnType<typeof layout>) => glyphsOf(laid).flatMap((r) => r.glyphs)
    expect(glyphs(tabular).slice(0, 4)).not.toEqual(glyphs(plain).slice(0, 4))
    expect(glyphs(tabular).slice(4)).toEqual(glyphs(plain).slice(4))
    expect(widthOf(tabular)).toBeGreaterThan(widthOf(plain))
    plain.delete()
    tabular.delete()
  })

  it('draws small caps from the font where it has them, and from capitals at 72% of the size where it has none', () => {
    const plain = layout('Sale', {})
    const native = layout('Sale', style({ features: { smcp: true } }))
    expect(glyphsOf(native).map((r) => r.size)).toEqual([32])
    expect(glyphsOf(native)[0]?.glyphs).not.toEqual(glyphsOf(plain)[0]?.glyphs)
    expect(native.blocks[0]?.text).toBe('Sale')

    // Noto Sans Devanagari has no small caps: the lower case letters are drawn as smaller capitals.
    const family = 'Noto Sans Devanagari'
    const synthetic = layout('Sale', style({ features: { smcp: true } }, family))
    const capitals = layout('SALE', {
      ...style({}, family),
      runs: [{ start: 1, end: 4, style: { fontSize: 32 * 0.72 } }],
    })
    expect(synthetic.blocks[0]?.text).toBe('SALE')
    expect(glyphsOf(synthetic)).toEqual(glyphsOf(capitals))
    expect(widthOf(synthetic)).toBeCloseTo(widthOf(capitals), 3)
    for (const l of [plain, native, synthetic, capitals]) l.delete()
  })
})
