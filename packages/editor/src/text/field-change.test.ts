// What the stage field is given to hold for the text being edited, and each change the browser makes
// in it read as one edit placed where the caret was.
import { describe, expect, it } from 'vitest'

import { compositionOf, fieldChange, fieldEdit, type FieldState, fieldText } from './field-change.ts'

/** A field holding `value`, its selection `start`–`end` (a caret where they meet). */
const field = (value: string, start = value.length, end = start): FieldState => ({ value, start, end })

describe('fieldText', () => {
  it('holds the selected range, all of it selected, and nothing at a caret', () => {
    expect(fieldText('Big sale', { start: 4, end: 8 })).toEqual(field('sale', 0, 4))
    expect(fieldText('Big sale', { start: 3, end: 3 })).toEqual(field(''))
  })

  it('holds nothing for a range over 4,000 UTF-16 units, and the whole of one that long', () => {
    const long = 'a'.repeat(4_001)
    expect(fieldText(long, { start: 0, end: 4_001 })).toEqual(field(''))
    expect(fieldText(long, { start: 1, end: 4_001 })).toEqual(field('a'.repeat(4_000), 0, 4_000))
  })
})

describe('fieldChange', () => {
  it('reads an insert at the caret once, and nothing more once what the field holds moves on to it', () => {
    const given = field('')
    const typed = field('a')
    expect(fieldChange(given, typed)).toEqual({ start: 0, end: 0, text: 'a', caret: 1 })
    expect(fieldChange(typed, typed)).toBeNull()
  })

  it('reads a delete back from the caret', () => {
    expect(fieldChange(field('abc'), field('ab'))).toEqual({ start: 2, end: 3, text: '', caret: 2 })
  })

  it('reads a change over the selection as replacing all of it', () => {
    expect(fieldChange(field('sale', 0, 4), field('x'))).toEqual({ start: 0, end: 4, text: 'x', caret: 1 })
    expect(fieldChange(field('sale', 0, 4), field('sales', 5))).toEqual({ start: 0, end: 4, text: 'sales', caret: 5 })
  })

  it('places "aa" to "aaa" where the caret was', () => {
    expect(fieldChange(field('aa', 1), field('aaa', 2))).toEqual({ start: 1, end: 1, text: 'a', caret: 2 })
    expect(fieldChange(field('aa', 0), field('aaa', 1))).toEqual({ start: 0, end: 0, text: 'a', caret: 1 })
    expect(fieldChange(field('aa'), field('aaa'))).toEqual({ start: 2, end: 2, text: 'a', caret: 3 })
  })

  it('never cuts an emoji in two at either end of a change', () => {
    expect(fieldChange(field('😀'), field('😃'))).toEqual({ start: 0, end: 2, text: '😃', caret: 2 })
    // U+1F600 and U+1FA00 end in the same UTF-16 unit.
    expect(fieldChange(field('\u{1F600}', 0), field('\u{1FA00}', 2))).toEqual({
      start: 0,
      end: 2,
      text: '\u{1FA00}',
      caret: 2,
    })
  })

  it('reads a caret moved with the text as it was as an empty change', () => {
    expect(fieldChange(field('ab', 2), field('ab', 1))).toEqual({ start: 2, end: 2, text: '', caret: 1 })
  })
})

describe('fieldEdit', () => {
  it('places a change over the selection on the range it was given', () => {
    const given = fieldText('Big sale', { start: 4, end: 8 })
    expect(fieldEdit(given, { start: 4, end: 8 }, field('deal'), 8)).toMatchObject({
      range: { start: 4, end: 8 },
      typed: 'deal',
      selection: { start: 8, end: 8 },
    })
  })

  it('replaces the whole of a range over 4,000 units, which the field holds as nothing', () => {
    const range = { start: 100, end: 4_200 }
    const given = fieldText('a'.repeat(4_300), range)
    expect(fieldEdit(given, range, field('x'), 4_300)).toMatchObject({
      range,
      typed: 'x',
      selection: { start: 101, end: 101 },
    })
  })

  it('writes line breaks as paragraphs, the selection after them', () => {
    expect(fieldEdit(field(''), { start: 2, end: 2 }, field('a\r\nb'), 5)).toMatchObject({
      range: { start: 2, end: 2 },
      typed: 'a\nb',
      selection: { start: 5, end: 5 },
    })
  })

  it('gives nothing when the field holds what it was given', () => {
    expect(fieldEdit(field('ab'), { start: 0, end: 2 }, field('ab'), 2)).toBeNull()
  })
})

describe('compositionOf', () => {
  /** The edit a field given nothing at offset 3 of a text makes as it comes to hold `value`, its caret at `caret`. */
  const edit = (value: string, caret = value.length) => {
    const made = fieldEdit(field(''), { start: 3, end: 3 }, field(value, caret), 10)
    if (!made) throw new Error('no edit')
    return made
  }

  it('composes the change where it lands, the cursor at the field’s caret', () => {
    expect(compositionOf(edit('nihao'), 'nihao')).toEqual({
      range: { start: 3, end: 3 },
      text: 'nihao',
      part: { start: 0, end: 5 },
      cursor: 5,
    })
  })

  it('underlines the part the input method composes, found around its cursor, else the whole change', () => {
    expect(compositionOf(edit('你hao', 4), 'hao').part).toEqual({ start: 1, end: 4 })
    expect(compositionOf(edit('aXa', 1), 'a').part).toEqual({ start: 0, end: 1 })
    expect(compositionOf(edit('你好'), 'zz').part).toEqual({ start: 0, end: 2 })
  })
})
