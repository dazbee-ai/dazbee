import { describe, expect, it } from 'vitest'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { TextStyle } from '@dazbee/schema'

import { loadCanvasKit } from '../node.ts'
import { resourceCache } from '../resources.ts'
import type { FamilySuperSubs } from './font-features.ts'
import { madeUpSuperSubs, paragraphShape, type ShapedRun, superSubLineStyle, withoutSuperSubs } from './super-sub.ts'

const style = (more: Record<string, unknown> = {}) =>
  TextStyle.parse({ fontFamily: 'Plain', fontSize: 50, color: '#000000FF', ...more })

/** The characters the fake font has superscript and subscript glyphs for: digits, and `n` raised. */
const RAISED = /[0-9n+]/u
const LOWERED = /[0-9]/u
const ARABIC = /\p{Script=Arabic}/u

/**
 * Shapes as a font would that has superscript and subscript glyphs for `RAISED` and `LOWERED`: a
 * glyph per character, its code point, or past 10000 when the feature on gives it its own glyph.
 * Arabic comes in runs of its own, from a fallback font with no such glyphs, its glyphs right to left
 * and, as SkParagraph gives them, the offset past its last glyph being where the run starts.
 */
function shape(s: TextStyle, text: string): ShapedRun[] {
  const runs: { glyphs: number[]; offsets: number[]; arabic: boolean; start: number; end: number }[] = []
  let utf8 = 0
  let lineStart = true
  for (const ch of text) {
    const bytes = new TextEncoder().encode(ch).length
    const arabic = ARABIC.test(ch)
    let run = runs.at(-1)
    if (ch === '\n') lineStart = true
    else {
      if (!run || lineStart || run.arabic !== arabic) {
        run = { glyphs: [], offsets: [], arabic, start: utf8, end: utf8 }
        runs.push(run)
      }
      lineStart = false
      const own = !arabic && ((s.features?.sups && RAISED.test(ch)) || (s.features?.subs && LOWERED.test(ch)))
      run.glyphs.push((ch.codePointAt(0) ?? 0) + (own ? 10000 : 0))
      run.offsets.push(utf8)
      run.end = utf8 + bytes
    }
    utf8 += bytes
  }
  return runs.map((run) =>
    run.arabic
      ? { glyphs: [...run.glyphs].reverse(), offsets: [...run.offsets].reverse().concat(run.start) }
      : { glyphs: run.glyphs, offsets: [...run.offsets, run.end] },
  )
}

const SUPER_SUBS: FamilySuperSubs = new Map([
  [
    'Plain',
    [{ weight: 400, italic: false, superscript: { scale: 0.6, shift: 0.4 }, subscript: { scale: 0.5, shift: 0.1 } }],
  ],
])
const HAS_BOTH = new Map([['Plain', new Set(['sups', 'subs'])]])

describe('madeUpSuperSubs', () => {
  it('keeps the feature where the font draws every letter and digit of the piece with its own glyphs', () => {
    const pieces = [
      { start: 0, end: 1, style: style() },
      { start: 1, end: 4, style: style({ features: { sups: true } }) },
      { start: 4, end: 6, style: style({ features: { subs: true } }) },
    ]
    expect(madeUpSuperSubs('x2n+12', pieces, shape, SUPER_SUBS, HAS_BOTH)).toEqual(pieces)
  })

  it('draws the whole piece from the standard glyphs, smaller and raised by the font’s values, when a letter lacks one', () => {
    const sups = style({ features: { sups: true, liga: false }, letterSpacing: { unit: 'percent', value: 10 } })
    const made = madeUpSuperSubs('x2', [{ start: 0, end: 2, style: sups }], shape, SUPER_SUBS, HAS_BOTH)
    expect(made).toEqual([
      {
        start: 0,
        end: 2,
        style: { ...sups, features: { liga: false }, fontSize: 30, letterSpacing: { unit: 'px', value: 5 } },
        superSub: { fontSize: 50, baselineShift: -20 },
      },
    ])
  })

  it('lowers a made-up subscript by the font’s subscript offset, at its subscript size', () => {
    const subs = style({ features: { subs: true } })
    const [made] = madeUpSuperSubs('H2O', [{ start: 0, end: 3, style: subs }], shape, SUPER_SUBS, HAS_BOTH)
    expect(made?.style.fontSize).toBe(25)
    expect(made?.style.features).toEqual({})
    expect(made?.superSub?.baselineShift).toBe(5)
  })

  it('makes up the usual 65 % raised 35 % of an em for a family whose values it doesn’t have', () => {
    const sups = style({ fontFamily: 'Other', features: { sups: true } })
    const [made] = madeUpSuperSubs('ab', [{ start: 0, end: 2, style: sups }], shape, SUPER_SUBS, HAS_BOTH)
    expect(made?.style.fontSize).toBeCloseTo(32.5, 5)
    expect(made?.superSub?.baselineShift).toBeCloseTo(-17.5, 5)
  })

  it('makes up the piece where the family lacks the feature, though it holds no letter or digit', () => {
    const sups = style({ features: { sups: true } })
    expect(
      madeUpSuperSubs('-', [{ start: 0, end: 1, style: sups }], shape, SUPER_SUBS, new Map())[0]?.superSub
        ?.baselineShift,
    ).toBe(-20)
    expect(
      madeUpSuperSubs('-', [{ start: 0, end: 1, style: sups }], shape, SUPER_SUBS, HAS_BOTH)[0]?.superSub
        ?.baselineShift,
    ).toBe(undefined)
  })

  it('decides for each font of the piece: digits keep their own glyphs and the fallback’s Arabic is made up', () => {
    const sups = style({ features: { sups: true } })
    const made = madeUpSuperSubs('a 12مرحبا', [{ start: 2, end: 9, style: sups }], shape, SUPER_SUBS, HAS_BOTH)
    expect(made.map((p) => [p.start, p.end, p.style.fontSize, p.superSub?.baselineShift])).toEqual([
      [2, 4, 50, undefined],
      [4, 9, 30, -20],
    ])
  })

  it('carries a line break with the stretch before it', () => {
    const sups = style({ features: { sups: true } })
    const made = madeUpSuperSubs('2\nx', [{ start: 0, end: 3, style: sups }], shape, SUPER_SUBS, HAS_BOTH)
    expect(made.map((p) => [p.start, p.end, p.superSub?.baselineShift])).toEqual([
      [0, 2, undefined],
      [2, 3, -20],
    ])
  })

  it('decides pieces side by side that differ only in colour together, a digit with the letter before it', () => {
    const pieces = [
      { start: 0, end: 1, style: style({ features: { sups: true } }) },
      { start: 1, end: 2, style: style({ features: { sups: true }, color: '#FF0000FF' }) },
      { start: 2, end: 3, style: style({ features: { sups: true }, fontSize: 20 }) },
    ]
    const made = madeUpSuperSubs('x22', pieces, shape, SUPER_SUBS, HAS_BOTH)
    expect(made.map((p) => [p.start, p.end, p.style.color, p.superSub?.baselineShift])).toEqual([
      [0, 1, '#000000FF', -20],
      [1, 2, '#FF0000FF', -20],
      [2, 3, '#000000FF', undefined],
    ])
  })

  it('decides a right-to-left run of one letter by its own font, not by the letter before it', () => {
    const sups = style({ features: { sups: true } })
    const made = madeUpSuperSubs('n ب', [{ start: 0, end: 3, style: sups }], shape, SUPER_SUBS, HAS_BOTH)
    expect(made.map((p) => [p.start, p.end, p.superSub?.baselineShift])).toEqual([
      [0, 2, undefined],
      [2, 3, -20],
    ])
  })
})

describe('paragraphShape', () => {
  it('gives each run of a text shaped in CanvasKit: its glyphs, and the UTF-8 offset of each and past the last', async () => {
    const ck = await loadCanvasKit()
    const fonts = resourceCache(ck).resources({
      fonts: loadFontFiles(),
      fallbackFamilies: [...FALLBACK_FAMILIES],
      images: {},
    })
    const shapeIn = paragraphShape(
      ck,
      fonts.fonts,
      false,
      (s) => new ck.TextStyle({ fontFamilies: [s.fontFamily], fontSize: s.fontSize }),
    )
    const [run, ...more] = shapeIn(style({ fontFamily: 'Noto Sans' }), 'x²')
    expect(more).toHaveLength(0)
    expect(run?.glyphs).toHaveLength(2)
    expect(run?.offsets).toEqual([0, 1, 3])
  })
})

describe('superSubLineStyle', () => {
  const made = (fontSize: number) => ({ fontSize, baselineShift: -10 })

  it('gives the style of the made-up piece standing in for the largest size, at that size', () => {
    const pieces = [
      { start: 0, end: 1, style: style({ fontSize: 30, fontFamily: 'Small' }), superSub: made(50) },
      { start: 1, end: 2, style: style({ fontSize: 42, fontFamily: 'Big' }), superSub: made(70) },
    ]
    expect(superSubLineStyle(pieces)).toEqual({ ...pieces[1]?.style, fontSize: 70 })
  })

  it('gives none where a piece is not made up, or there are no pieces', () => {
    expect(
      superSubLineStyle([
        { start: 0, end: 1, style: style(), superSub: made(50) },
        { start: 1, end: 2, style: style() },
      ]),
    ).toBe(undefined)
    expect(superSubLineStyle([])).toBe(undefined)
  })
})

describe('withoutSuperSubs', () => {
  it('takes superscript and subscript off a style, keeping its other features', () => {
    expect(withoutSuperSubs(style({ features: { sups: true, subs: false, liga: false } })).features).toEqual({
      liga: false,
    })
  })
})
