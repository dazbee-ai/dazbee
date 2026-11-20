import { afterAll, describe, expect, it } from 'vitest'

import type { Paragraph } from '@dazbee/canvaskit'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import {
  caretAt,
  type CaretPlace,
  caretPosition,
  layoutText,
  makeResources,
  selectionBoxes,
  type TextLayout,
  visualStep,
} from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { TextProps } from '@dazbee/schema'

import { MIXED, SAMPLES, type TextSample } from './text-samples.ts'

const ck = await loadCanvasKit()
const resources = makeResources(ck, { fonts: loadFontFiles(), fallbackFamilies: [...FALLBACK_FAMILIES], images: {} })
afterAll(() => resources.delete())

/** Arabic letters and marks run right to left; Latin and digits, Arabic-Indic ones included, left to right. */
const ARABIC = /(?=\p{Script=Arabic})\P{Nd}/u
const LATIN_OR_DIGIT = /[\p{Script=Latin}\p{Nd}]/u

/** Graphemes as Unicode defines them (Intl.Segmenter), with their UTF-16 ranges. */
function graphemes(text: string) {
  return [...new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(text)].map((s) => ({
    text: s.segment,
    start: s.index,
    end: s.index + s.segment.length,
  }))
}

function laidOut(sample: TextSample, width?: number) {
  const props = TextProps.parse({
    x: 0,
    y: 0,
    width: width ?? 0,
    height: 0,
    boxMode: width ? 'autoHeight' : 'autoWidth',
    text: sample.text,
    style: { fontFamily: sample.family, fontWeight: sample.weight, fontSize: 48, color: '#000000FF' },
  })
  return layoutText(ck, props, resources)
}
/** The one paragraph of a sample with no line breaks. */
function only(laid: TextLayout): Paragraph {
  const [block] = laid.blocks
  if (!block || laid.blocks.length !== 1) throw new Error('not one paragraph')
  return block.paragraph
}

/** Where each glyph is drawn, by the UTF-16 offset of its cluster, from the shaped lines rather than from selection boxes. */
function glyphOrigins(paragraph: Paragraph, text: string) {
  const utf16At = new Map<number, number>()
  let bytes = 0
  for (let i = 0; i < text.length; i++) {
    utf16At.set(bytes, i)
    const code = text.codePointAt(i) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
    if (code >= 0x10000) i++
  }
  return paragraph.getShapedLines().flatMap((line) =>
    line.runs.flatMap((run) =>
      [...run.glyphs].map((_, i) => ({
        offset: utf16At.get(run.offsets[i] ?? -1) ?? -1,
        x: run.positions[2 * i] ?? Number.NaN,
      })),
    ),
  )
}

describe.each([...SAMPLES, MIXED])('caret and selection in $label', (sample) => {
  const laid = laidOut(sample)
  afterAll(() => laid.delete())
  const paragraph = only(laid)
  const cases = graphemes(sample.text).filter((g) => g.text.trim() !== '')
  const [line] = paragraph.getLineMetrics()
  if (!line) throw new Error('no line')
  const lineTop = line.baseline - line.ascent

  it.each(cases)('"$text" has one box in its own direction, around its glyphs', (g) => {
    const boxes = selectionBoxes(ck, laid, g.start, g.end)
    expect(boxes).toHaveLength(1)
    const [box] = boxes
    if (!box) return
    expect(box.width).toBeGreaterThan(0)
    if (ARABIC.test(g.text)) expect(box.rtl).toBe(true)
    if (LATIN_OR_DIGIT.test(g.text)) expect(box.rtl).toBe(false)
    const all = glyphOrigins(paragraph, sample.text)
    const origins = all.filter((o) => o.offset >= g.start && o.offset < g.end)
    // A grapheme with no glyph of its own is inside a ligature that starts earlier, like "fi".
    if (origins.length === 0) expect(all.some((o) => o.offset < g.start)).toBe(true)
    for (const o of origins) {
      expect(o.x).toBeGreaterThanOrEqual(box.x - 1)
      expect(o.x).toBeLessThanOrEqual(box.x + box.width + 1)
    }
  })

  it.each(cases)('a click anywhere up the line on "$text" puts the caret on its near edge', (g) => {
    const [box] = selectionBoxes(ck, laid, g.start, g.end)
    if (!box) throw new Error('no box')
    const leading = box.rtl ? box.x + box.width * 0.75 : box.x + box.width * 0.25
    const trailing = box.rtl ? box.x + box.width * 0.25 : box.x + box.width * 0.75
    for (const share of [0.05, 0.3, 0.6, 0.95]) {
      const y = lineTop + line.height * share
      expect(caretAt(ck, laid, leading, y)).toBe(g.start)
      expect(caretAt(ck, laid, trailing, y)).toBe(g.end)
    }
  })

  it('the caret is drawn where a click puts it', () => {
    for (const g of cases) {
      for (const offset of [g.start, g.end]) {
        const at = caretPosition(ck, laid, offset)
        const clicked = caretAt(ck, laid, at.x, at.y + at.height / 2)
        // Where a left-to-right run meets right-to-left text, two offsets share one place on screen,
        // so the click may pick the other one; it must still draw the caret in the same place.
        expect(caretPosition(ck, laid, clicked).x).toBeCloseTo(at.x, 3)
      }
    }
  })

  it('every caret position is a grapheme edge', () => {
    const edges = new Set(graphemes(sample.text).flatMap((g) => [g.start, g.end]))
    for (let x = -10; x <= paragraph.getMaxWidth() + 10; x += 2) {
      expect(edges).toContain(caretAt(ck, laid, x, lineTop + line.height / 2))
    }
  })
})

describe(`a range across the Arabic and Latin boundary in ${MIXED.label}`, () => {
  const laid = laidOut(MIXED)
  afterAll(() => laid.delete())
  const x = (offset: number) => caretPosition(ck, laid, offset).x
  // "…حذاء Nike Air الجديد": حذاء 9–13, a space, Nike 14–18, a space, Air 19–22.

  it('has a box for each direction, meeting without overlap where the caret and the word put their ends', () => {
    // After "ح" to after "Nik": "ذاء", the space, then "Nik".
    const range = selectionBoxes(ck, laid, 10, 17)
    expect(range).toHaveLength(2)
    const latin = range.find((box) => !box.rtl)
    const arabic = range.find((box) => box.rtl)
    if (!latin || !arabic) throw new Error('not one box in each direction')
    const [nike] = selectionBoxes(ck, laid, 14, 18)
    // The Latin box starts where Nike starts and ends after "Nik"; the Arabic one runs from the end
    // of the Latin words, over the space, to after "ح".
    expect(latin.x).toBeCloseTo(nike?.x ?? Number.NaN, 0)
    expect(latin.x + latin.width).toBeCloseTo(x(17), 0)
    expect(arabic.x).toBeCloseTo(x(22), 0)
    expect(arabic.x + arabic.width).toBeCloseTo(x(10), 0)
    expect(latin.x + latin.width).toBeLessThanOrEqual(arabic.x + 0.5)
  })
})

describe('caret on wrapped text', () => {
  const sample = SAMPLES.find((s) => s.label === 'Hindi body')
  if (!sample) throw new Error('no Hindi body')
  const laid = laidOut(sample, 300)
  afterAll(() => laid.delete())
  const paragraph = only(laid)
  const lines = paragraph.getLineMetrics()

  it('wraps onto several lines', () => {
    expect(lines.length).toBeGreaterThan(1)
  })

  it('a click on a line, beside it or past its ends stays on that line', () => {
    for (const l of lines) {
      const top = l.baseline - l.ascent
      for (const x of [-50, l.left + 1, l.left + l.width / 2, l.left + l.width - 1, 1000]) {
        for (const y of [top + 1, top + l.height / 2, top + l.height - 1]) {
          const offset = caretAt(ck, laid, x, y)
          expect(offset).toBeGreaterThanOrEqual(l.startIndex)
          expect(offset).toBeLessThanOrEqual(l.endIndex)
        }
      }
    }
  })

  it('a click above the text goes to the first line and below it to the last', () => {
    const first = lines[0]
    const last = lines.at(-1)
    if (!first || !last) throw new Error('no lines')
    expect(caretAt(ck, laid, 5, -100)).toBe(first.startIndex)
    expect(caretAt(ck, laid, 1000, paragraph.getHeight() + 100)).toBeGreaterThanOrEqual(last.startIndex)
  })
})

/** Every place the caret can be drawn in a text, each grapheme edge beside the grapheme before it and after it, rounded to a hundredth of a pixel. */
function places(laid: TextLayout, text: string) {
  const round = (n: number) => Math.round(n * 100) / 100
  const edges = [...new Set([0, ...graphemes(text).map((g) => g.end)])]
  return edges.flatMap((offset) =>
    [false, true].map((after) => {
      const at = caretPosition(ck, laid, offset, after)
      return { offset, after, x: round(at.x), y: round(at.y) }
    }),
  )
}

/** The places the caret goes through, pressing an arrow from one until it stops moving. */
function walk(laid: TextLayout, from: CaretPlace, right: boolean) {
  const steps = [from]
  for (let i = 0; i < 200; i++) {
    const last = steps.at(-1) ?? from
    const next = visualStep(ck, laid, last, right)
    if (next === null || (next.offset === last.offset && next.after === last.after)) return steps
    steps.push(next)
  }
  throw new Error('the caret never stopped')
}

const xOf = (laid: TextLayout, place: CaretPlace) => caretPosition(ck, laid, place.offset, place.after).x
const leftmost = <T extends { x: number }>(all: T[]) => all.reduce((a, b) => (b.x < a.x ? b : a))
const rightmost = <T extends { x: number }>(all: T[]) => all.reduce((a, b) => (b.x > a.x ? b : a))
const laidArabic = (text: string, width?: number) =>
  laidOut({ label: text, text, family: 'Noto Naskh Arabic', weight: 400 }, width)

describe(`the arrow keys in ${MIXED.label}`, () => {
  const laid = laidOut(MIXED)
  afterAll(() => laid.delete())
  const all = places(laid, MIXED.text)
  // "احصل على حذاء Nike Air الجديد": Nike 14–18, Air 19–22; the text reads from the right.

  it('Right moves the caret right on screen at every step, through the Latin words left to right, to the right end', () => {
    const steps = walk(laid, leftmost(all), true)
    const xs = steps.map((s) => xOf(laid, s))
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan((xs[i - 1] ?? 0) + 0.01)
    expect(xs.at(-1)).toBeCloseTo(rightmost(all).x, 1)
    expect(steps.map((s) => s.offset).filter((o) => o > 14 && o < 18)).toEqual([15, 16, 17])
  })

  it('Left moves the caret left on screen at every step, through the Latin words right to left, to the left end', () => {
    const steps = walk(laid, rightmost(all), false)
    const xs = steps.map((s) => xOf(laid, s))
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeLessThan((xs[i - 1] ?? 0) - 0.01)
    expect(xs.at(-1)).toBeCloseTo(leftmost(all).x, 1)
    expect(steps.map((s) => s.offset).filter((o) => o > 14 && o < 18)).toEqual([17, 16, 15])
  })

  it('stops at the line’s ends, with no line to go on to', () => {
    for (const [end, right] of [
      [rightmost(all), true],
      [leftmost(all), false],
    ] as const)
      expect(xOf(laid, visualStep(ck, laid, end, right) ?? end)).toBeCloseTo(end.x, 1)
  })

  it('leaves a line all left to right to the step in reading order', () => {
    const english = SAMPLES.find((s) => s.label === 'English')
    if (!english) throw new Error('no English')
    const plain = laidOut(english)
    expect(visualStep(ck, plain, { offset: 3, after: false }, true)).toBeNull()
    plain.delete()
  })
})

describe('the arrow keys where runs of two directions meet', () => {
  it('stop at every place between graphemes on screen, none skipped', () => {
    for (const text of ['Sale خصم', 'ab خصم cd', 'خصم 😀 ok', MIXED.text]) {
      const laid = laidArabic(text)
      const all = places(laid, text)
      const reached = [...walk(laid, leftmost(all), true), ...walk(laid, rightmost(all), false)].map((p) =>
        xOf(laid, p),
      )
      for (const { x } of all)
        expect(
          reached.some((r) => Math.abs(r - x) < 0.02),
          `${text} at ${x}`,
        ).toBe(true)
      laid.delete()
    }
  })
})

describe('the arrow keys at the ends of wrapped Arabic lines', () => {
  const sample = SAMPLES.find((s) => s.label === 'Arabic body')
  if (!sample) throw new Error('no Arabic body')
  const laid = laidOut(sample, 260)
  afterAll(() => laid.delete())
  const all = places(laid, sample.text)
  const tops = [...new Set(all.map((e) => e.y))].sort((a, b) => a - b)
  const onLine = (top: number | undefined) => all.filter((e) => e.y === top)
  const at = (place: CaretPlace | null) => {
    if (!place) throw new Error('no step')
    const drawn = caretPosition(ck, laid, place.offset, place.after)
    return { x: Math.round(drawn.x * 100) / 100, y: Math.round(drawn.y * 100) / 100 }
  }

  it('wraps onto several lines', () => {
    expect(tops.length).toBeGreaterThan(2)
  })

  it('Left at a line’s left end, where it ends, goes on to the next line’s right end, where it starts', () => {
    for (let i = 0; i + 1 < tops.length; i++) {
      const next = at(visualStep(ck, laid, leftmost(onLine(tops[i])), false))
      expect(next).toEqual({ x: rightmost(onLine(tops[i + 1])).x, y: tops[i + 1] })
    }
  })

  it('Right at a line’s right end, where it starts, goes back to the line before’s left end, where it ends', () => {
    for (let i = 1; i < tops.length; i++) {
      const before = at(visualStep(ck, laid, rightmost(onLine(tops[i])), true))
      expect(before).toEqual({ x: leftmost(onLine(tops[i - 1])).x, y: tops[i - 1] })
    }
  })
})

describe('the arrow keys across paragraphs', () => {
  it('go through an empty paragraph in Arabic, Left on to the text’s end and Right back to its start', () => {
    // خصم 0–3, the empty paragraph at 4, اليوم 5–10.
    const text = 'خصم\n\nاليوم'
    const laid = laidArabic(text)
    const left = walk(laid, { offset: 0, after: false }, false).map((p) => p.offset)
    expect(left).toContain(4)
    expect(left.at(-1)).toBe(text.length)
    const right = walk(laid, { offset: text.length, after: false }, true).map((p) => p.offset)
    expect(right).toContain(4)
    expect(right.at(-1)).toBe(0)
    laid.delete()
  })

  it('step on at a line’s end to the next paragraph, entering it at the end the arrow comes in from', () => {
    // "Sale خصم" (0–8) reads left to right; the next paragraph (9–18) starts with Arabic.
    const text = 'Sale خصم\nخصم today'
    const laid = laidArabic(text)
    const all = places(laid, text)
    const first = all.filter((p) => p.offset <= 8 && !(p.offset === 8 && p.after))
    const second = all.filter((p) => p.offset >= 9)
    const next = visualStep(ck, laid, rightmost(first), true)
    expect(next && next.offset >= 9).toBe(true)
    expect(next && xOf(laid, next)).toBeCloseTo(leftmost(second).x, 1)
    const back = visualStep(ck, laid, leftmost(second), false)
    expect(back && back.offset <= 8).toBe(true)
    expect(back && xOf(laid, back)).toBeCloseTo(rightmost(first).x, 1)
    laid.delete()
  })
})

describe('the arrow keys in text cut off by its line limit', () => {
  it('step in reading order from an offset in text not drawn', () => {
    const text = 'abc خصم\nhidden para'
    const props = TextProps.parse({
      x: 0,
      y: 0,
      width: 0,
      height: 0,
      boxMode: 'autoWidth',
      maxLines: 1,
      text,
      style: { fontFamily: 'Noto Naskh Arabic', fontWeight: 400, fontSize: 48, color: '#000000FF' },
    })
    const laid = layoutText(ck, props, resources)
    expect(visualStep(ck, laid, { offset: text.length, after: false }, false)).toBeNull()
    expect(visualStep(ck, laid, { offset: 12, after: false }, true)).toBeNull()
    laid.delete()
  })
})
