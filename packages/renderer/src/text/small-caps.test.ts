import { describe, expect, it } from 'vitest'

import { TextStyle } from '@dazbee/schema'

import { madeUpSmallCaps } from './small-caps.ts'

const style = (more: Record<string, unknown> = {}) =>
  TextStyle.parse({ fontFamily: 'Plain', fontSize: 50, color: '#000000FF', ...more })

describe('madeUpSmallCaps', () => {
  it('draws a family’s lower-case letters as capitals at 72% of the size, keeping the full size’s spacing', () => {
    const smallCaps = style({ features: { smcp: true, liga: false }, letterSpacing: { unit: 'percent', value: 10 } })
    const { shown, pieces } = madeUpSmallCaps('Sale 2', [{ start: 0, end: 6, style: smallCaps }], new Map())
    expect(shown).toBe('SALE 2')
    expect(pieces.map(({ start, end, style: s }) => [start, end, s.fontSize, s.letterSpacing, s.features])).toEqual([
      [0, 1, 50, { unit: 'percent', value: 10 }, { liga: false }],
      [1, 4, 36, { unit: 'px', value: 5 }, { liga: false }],
      [4, 6, 50, { unit: 'percent', value: 10 }, { liga: false }],
    ])
  })

  it('leaves the pieces and text as they are where the family has small caps or none are asked for', () => {
    const pieces = [
      { start: 0, end: 2, style: style({ features: { smcp: true } }) },
      { start: 2, end: 4, style: style({ fontFamily: 'Other' }) },
    ]
    const made = madeUpSmallCaps('abcd', pieces, new Map([['Plain', new Set(['smcp'])]]))
    expect(made.shown).toBe('abcd')
    expect(made.pieces).toEqual(pieces)
  })

  it('keeps a letter whose capital is longer, such as ß, as it is, so offsets still match', () => {
    const { shown } = madeUpSmallCaps(
      'straße',
      [{ start: 0, end: 6, style: style({ features: { smcp: true } }) }],
      new Map(),
    )
    expect(shown).toBe('STRAßE')
  })

  it('keeps a made-up superscript’s size and baseline shift on each piece it splits it into', () => {
    const superSub = { fontSize: 50, baselineShift: -17.5 }
    const { pieces } = madeUpSmallCaps(
      'aB',
      [{ start: 0, end: 2, style: style({ features: { smcp: true } }), superSub }],
      new Map(),
    )
    expect(pieces.map((p) => [p.start, p.end, p.superSub])).toEqual([
      [0, 1, superSub],
      [1, 2, superSub],
    ])
  })
})
