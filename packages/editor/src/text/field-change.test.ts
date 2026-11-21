// What the stage field is given to hold for the text being edited, and each change the browser makes
// in it read as one edit placed where the caret was.
import { describe, expect, it } from 'vitest'

import {
  cancels,
  compositionOf,
  fieldChange,
  fieldEdit,
  type FieldState,
  fieldText,
  holdsAround,
  keptField,
} from './field-change.ts'

/** A field holding `value`, its selection `start`–`end` (a caret where they meet). */
const field = (value: string, start = value.length, end = start): FieldState => ({ value, start, end })

describe('fieldText', () => {
  it('holds the selected range and the text around it, at the text’s start and end', () => {
    expect(fieldText('Big sale', { start: 4, end: 8 })).toEqual(field('Big sale', 4, 8))
    expect(fieldText('Big sale', { start: 0, end: 0 })).toEqual(field('Big sale', 0))
    expect(fieldText('Big sale', { start: 8, end: 8 })).toEqual(field('Big sale', 8))
    expect(fieldText('', { start: 0, end: 0 })).toEqual(field(''))
  })

  it('holds up to 1,000 UTF-16 units on each side of the selection', () => {
    const text = `${'a'.repeat(1_500)}SALE${'b'.repeat(1_500)}`
    expect(fieldText(text, { start: 1_500, end: 1_504 })).toEqual(
      field(`${'a'.repeat(1_000)}SALE${'b'.repeat(1_000)}`, 1_000, 1_004),
    )
  })

  it('holds a line break written as \\r or \\r\\n as \\n, one unit for one, as a text area holds it', () => {
    const held = fieldText('a\r\nb\rc', { start: 3, end: 3 })
    expect(held).toEqual(field('a\n\nb\nc', 3))
    expect(keptField('a\r\nb\rc', held, { start: 3, end: 3 }, { start: 5, end: 5 })).toEqual(field('a\n\nb\nc', 5))
  })

  it('says a selection runs backward', () => {
    expect(fieldText('Big sale', { start: 4, end: 8 }, true)).toEqual({ ...field('Big sale', 4, 8), backward: true })
  })

  it('cuts the text around it at grapheme edges, never inside an emoji, a flag, a conjunct or a surrogate pair', () => {
    // Each lies across the 1,000th unit on both sides of the caret.
    for (const grapheme of ['\u{1F44D}\u{1F3FD}', '\u{1F1EE}\u{1F1F3}', 'क्ष', '\u{1F600}']) {
      const before = `x${grapheme}${'a'.repeat(999)}`
      const caret = before.length
      const held = fieldText(`${before}${'b'.repeat(999)}${grapheme}y`, { start: caret, end: caret })
      expect(held, grapheme).toEqual(field(`${'a'.repeat(999)}${'b'.repeat(999)}`, 999))
    }
  })

  it('holds nothing for a range over 4,000 UTF-16 units, and the whole of one that long', () => {
    const long = 'a'.repeat(4_001)
    expect(fieldText(long, { start: 0, end: 4_001 })).toEqual(field(''))
    expect(fieldText(long, { start: 1, end: 4_001 })).toEqual(field(long, 1, 4_001))
  })
})

describe('keptField', () => {
  it('keeps what the field holds after a commit that landed as it holds it, its selection moved with the text’s', () => {
    const held = field('Hello there你好', 13)
    const ends = { start: 13, end: 13 }
    expect(keptField('Hello there你好', held, ends, { start: 13, end: 13 })).toEqual(held)
    expect(keptField('Hello there你好', held, ends, { start: 6, end: 11 }, true)).toEqual({
      ...field('Hello there你好', 6, 11),
      backward: true,
    })
  })

  it('takes it again after another tab’s edit inside it, before or after the selection, and keeps it after one outside', () => {
    const text = `${'a'.repeat(2_000)}Hello there${'b'.repeat(2_000)}`
    const caret = { start: 2_005, end: 2_005 }
    const held = fieldText(text, caret)
    expect(keptField(`${text.slice(0, 2_002)}X${text.slice(2_002)}`, held, { start: 2_006, end: 2_006 }, caret)).toBe(
      null,
    )
    expect(keptField(`${text.slice(0, 2_008)}X${text.slice(2_008)}`, held, caret, caret)).toBe(null)
    const moved = { start: 2_006, end: 2_006 }
    expect(keptField(`X${text}`, held, moved, moved)).toEqual(held)
  })

  it('takes it again with the selection within 100 units of an edge that is not the text’s own end', () => {
    const text = 'a'.repeat(3_000)
    const held = fieldText(text, { start: 1_500, end: 1_500 })
    const ends = { start: 1_500, end: 1_500 }
    expect(keptField(text, held, ends, { start: 550, end: 550 })).toBe(null)
    expect(keptField(text, held, ends, { start: 650, end: 2_399 })).toEqual(field(held.value, 150, 1_899))
    expect(keptField(text, held, ends, { start: 650, end: 2_450 })).toBe(null)
    const short = 'a'.repeat(1_500)
    const atEnd = fieldText(short, { start: 1_000, end: 1_000 })
    expect(keptField(short, atEnd, { start: 1_000, end: 1_000 }, { start: 1_490, end: 1_500 })).toEqual(
      field(short, 1_490, 1_500),
    )
  })

  it('takes a range over 4,000 units again, which the field holds as nothing', () => {
    const text = 'a'.repeat(5_000)
    const range = { start: 0, end: 4_500 }
    expect(keptField(text, fieldText(text, range), range, range)).toBe(null)
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

  it('reads a caret or a selection moved with the text as it was as an empty change at its start', () => {
    expect(fieldChange(field('ab', 2), field('ab', 1))).toEqual({ start: 2, end: 2, text: '', caret: 1 })
    expect(fieldChange(field('there', 0, 5), field('there', 0, 2))).toEqual({ start: 0, end: 0, text: '', caret: 2 })
  })

  it('reads a selection that turned round as moved', () => {
    expect(fieldChange(field('ab', 0, 2), { ...field('ab', 0, 2), backward: true })).toEqual({
      start: 0,
      end: 0,
      text: '',
      caret: 2,
    })
  })

  it('widens a change to cover a range of what the field was given, the text there kept or not', () => {
    const cover = { start: 6, end: 9 }
    expect(fieldChange(field('Hello wor'), field('Hello words'), cover)).toEqual({
      start: 6,
      end: 9,
      text: 'words',
      caret: 11,
    })
    expect(fieldChange(field('Hello wor'), field('Hello wor'), cover)).toEqual({
      start: 6,
      end: 9,
      text: 'wor',
      caret: 9,
    })
  })
})

describe('fieldEdit', () => {
  it('places a change over the selection on the range it was given', () => {
    const given = fieldText('Big sale', { start: 4, end: 8 })
    expect(fieldEdit(given, { start: 4, end: 8 }, field('Big deal'), 8)).toMatchObject({
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

  it('replaces the whole of the input method’s data where the field holds it around its caret, a word it re-opened', () => {
    const ends = { start: 9, end: 9 }
    expect(fieldEdit(field('Hello wor'), ends, field('Hello words'), 9, 'words')).toMatchObject({
      range: { start: 6, end: 9 },
      typed: 'words',
      selection: { start: 11, end: 11 },
    })
    expect(fieldEdit(field('Hello wor'), ends, field('Hello wor'), 9, 'wor')).toMatchObject({
      range: { start: 6, end: 9 },
      typed: 'wor',
    })
    // Data that doesn't hold the change, or isn't around the caret, widens nothing.
    expect(fieldEdit(field('Hello wor'), ends, field('Hello words'), 9, 'ds!')).toMatchObject({
      range: { start: 9, end: 9 },
      typed: 'ds',
    })
    expect(fieldEdit(field('Hello wor'), ends, field('Hello wor'), 9, 'Hello')).toBeNull()
  })

  it('keeps the field’s selection running backward', () => {
    const edit = fieldEdit(
      field('Hello there'),
      { start: 11, end: 11 },
      { ...field('Hello there', 6, 11), backward: true },
      11,
    )
    expect(edit).toMatchObject({ selection: { start: 6, end: 11 }, backward: true })
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

describe('cancels', () => {
  /** The edit a field given `given` makes as it comes to hold `value`, its caret at `caret`. */
  const edit = (given: FieldState, value: string, caret: number) => {
    const made = fieldEdit(given, { start: given.start, end: given.end }, field(value, caret), given.value.length)
    if (!made) throw new Error('no edit')
    return made
  }

  it('reads a commit that puts nothing in place of the selected range, or changes nothing, as a cancel', () => {
    const selected = field('Big sale', 4, 8)
    expect(cancels(selected, edit(selected, 'Big ', 4))).toBe(true)
    expect(cancels(selected, edit(selected, 'Big sale', 8))).toBe(true)
    expect(cancels(selected, edit(selected, 'Big deal', 8))).toBe(false)
  })

  it('reads one that deletes a word re-opened at a caret as a delete', () => {
    const atCaret = field('Big sale')
    expect(cancels(atCaret, edit(atCaret, 'Big ', 4))).toBe(false)
  })
})

describe('holdsAround', () => {
  it('says the field holds an input method’s data around its caret, a word it re-opened', () => {
    expect(holdsAround(field('Big sale'), 'sale')).toBe(true)
    expect(holdsAround(field('Big sale', 5), 'sale')).toBe(true)
    expect(holdsAround(field('Big sale'), 'Big')).toBe(false)
    expect(holdsAround(field('Big sale'), '')).toBe(false)
  })
})
