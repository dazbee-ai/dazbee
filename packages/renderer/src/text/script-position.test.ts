import { describe, expect, it } from 'vitest'

import { TextStyle } from '@dazbee/schema'

import type { FamilyScripts } from './font-features.ts'
import { madeUpScripts, type ShapedRun } from './script-position.ts'

const style = (more: Record<string, unknown> = {}) =>
  TextStyle.parse({ fontFamily: 'Plain', fontSize: 50, color: '#000000FF', ...more })

/** The characters the fake font has superscript and subscript glyphs for: digits, and `n` raised. */
const RAISED = /[0-9n+]/u
const LOWERED = /[0-9]/u
const ARABIC = /\p{Script=Arabic}/u

/**
 * Shapes as a font would that has superscript and subscript glyphs for `RAISED` and `LOWERED`: a
 * glyph per character, its code point, or past 10000 when the feature on gives it its own glyph.
 * Arabic comes in runs of its own, from a fallback font with no such glyphs.
 */
function shape(s: TextStyle, text: string): ShapedRun[] {
  const runs: { glyphs: number[]; offsets: number[] }[] = []
  let utf8 = 0
  let arabic: boolean | null = null
  for (const ch of text) {
    const inArabic = ARABIC.test(ch)
    if (inArabic !== arabic || ch === '\n') {
      runs.at(-1)?.offsets.push(utf8)
      runs.push({ glyphs: [], offsets: [] })
      arabic = inArabic
    }
    const own = !inArabic && ((s.features?.sups && RAISED.test(ch)) || (s.features?.subs && LOWERED.test(ch)))
    const run = runs.at(-1)
    if (ch !== '\n' && run) {
      run.glyphs.push((ch.codePointAt(0) ?? 0) + (own ? 10000 : 0))
      run.offsets.push(utf8)
    }
    utf8 += new TextEncoder().encode(ch).length
  }
  runs.at(-1)?.offsets.push(utf8)
  return runs.filter((run) => run.glyphs.length > 0)
}

const SCRIPTS: FamilyScripts = new Map([
  [
    'Plain',
    [
      { weight: 400, italic: false, superscript: { scale: 0.6, shift: 0.4 }, subscript: { scale: 0.5, shift: 0.1 } },
    ],
  ],
])
const HAS_BOTH = new Map([['Plain', new Set(['sups', 'subs'])]])

describe('madeUpScripts', () => {
  it('keeps the feature where the font draws every letter and digit of the piece with its own glyphs', () => {
    const pieces = [
      { start: 0, end: 1, style: style() },
      { start: 1, end: 4, style: style({ features: { sups: true } }) },
      { start: 4, end: 6, style: style({ features: { subs: true } }) },
    ]
    expect(madeUpScripts('x2n+12', pieces, shape, SCRIPTS, HAS_BOTH)).toEqual(pieces)
  })

  it('draws the whole piece from the standard glyphs, smaller and raised by the font’s values, when a letter lacks one', () => {
    const sups = style({ features: { sups: true, liga: false }, letterSpacing: { unit: 'percent', value: 10 } })
    const made = madeUpScripts('x2', [{ start: 0, end: 2, style: sups }], shape, SCRIPTS, HAS_BOTH)
    expect(made).toEqual([
      {
        start: 0,
        end: 2,
        style: { ...sups, features: { liga: false }, fontSize: 30, letterSpacing: { unit: 'px', value: 5 } },
        script: { fontSize: 50, baselineShift: -20 },
      },
    ])
  })

  it('lowers a made-up subscript by the font’s subscript offset, at its subscript size', () => {
    const subs = style({ features: { subs: true } })
    const [made] = madeUpScripts('H2O', [{ start: 0, end: 3, style: subs }], shape, SCRIPTS, HAS_BOTH)
    expect(made?.style.fontSize).toBe(25)
    expect(made?.style.features).toEqual({})
    expect(made?.script?.baselineShift).toBe(5)
  })

  it('makes up the usual 65 % raised 35 % of an em for a family whose values it doesn’t have', () => {
    const sups = style({ fontFamily: 'Other', features: { sups: true } })
    const [made] = madeUpScripts('ab', [{ start: 0, end: 2, style: sups }], shape, SCRIPTS, HAS_BOTH)
    expect(made?.style.fontSize).toBeCloseTo(32.5, 5)
    expect(made?.script?.baselineShift).toBeCloseTo(-17.5, 5)
  })

  it('makes up the piece where the family lacks the feature, though it holds no letter or digit', () => {
    const sups = style({ features: { sups: true } })
    expect(madeUpScripts('-', [{ start: 0, end: 1, style: sups }], shape, SCRIPTS, new Map())[0]?.script?.baselineShift).toBe(
      -20,
    )
    expect(madeUpScripts('-', [{ start: 0, end: 1, style: sups }], shape, SCRIPTS, HAS_BOTH)[0]?.script?.baselineShift).toBe(
      undefined,
    )
  })

  it('decides for each font of the piece: digits keep their own glyphs and the fallback’s Arabic is made up', () => {
    const sups = style({ features: { sups: true } })
    const made = madeUpScripts('a 12مرحبا', [{ start: 2, end: 9, style: sups }], shape, SCRIPTS, HAS_BOTH)
    expect(made.map((p) => [p.start, p.end, p.style.fontSize, p.script?.baselineShift])).toEqual([
      [2, 4, 50, undefined],
      [4, 9, 30, -20],
    ])
  })

  it('carries a line break with the stretch before it', () => {
    const sups = style({ features: { sups: true } })
    const made = madeUpScripts('2\nx', [{ start: 0, end: 3, style: sups }], shape, SCRIPTS, HAS_BOTH)
    expect(made.map((p) => [p.start, p.end, p.script?.baselineShift])).toEqual([
      [0, 2, undefined],
      [2, 3, -20],
    ])
  })
})
