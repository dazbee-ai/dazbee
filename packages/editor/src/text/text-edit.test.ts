// Ranges and style keys inside text (#47), on English, Hindi and Arabic.
import { describe, expect, it } from 'vitest'

import { TextProps } from '@dazbee/schema'

import {
  backspaceStep,
  oneGrapheme,
  paragraphAt,
  step,
  styleOn,
  stylesIn,
  styleWrite,
  wordAt,
  wordStep,
} from './text-edit.ts'

const props = (text: string, runs: unknown[] = [], weight = 400) =>
  TextProps.parse({
    x: 0,
    y: 0,
    width: 100,
    height: 20,
    text,
    runs,
    style: { fontFamily: 'Noto Sans', fontSize: 16, fontWeight: weight, color: '#000000FF' },
  })

describe('text editing', () => {
  it('knows one grapheme, an emoji of several code points too, from none, two or a named key', () => {
    for (const text of ['a', 'é', '👍🏽', '🇮🇳', '👨‍👩‍👧', '1️⃣', '新']) expect(oneGrapheme(text), text).toBe(true)
    for (const text of ['', 'ab', 'Dead', 'Unidentified', '😀😀']) expect(oneGrapheme(text), text).toBe(false)
  })

  it('steps a grapheme at a time, a Devanagari conjunct whole', () => {
    const text = 'क्ष a'
    expect(step(text, 0, true)).toBe(3)
    expect(step(text, 3, false)).toBe(0)
    expect(step(text, text.length, true)).toBe(text.length)
    expect(step(text, 0, false)).toBe(0)
  })

  it('steps back for Backspace over a letter’s trailing vowel sign or mark alone: कि becomes क', () => {
    expect(backspaceStep('कि', 2)).toBe(1)
    // A conjunct with its vowel sign is one grapheme; the sign goes first, then the conjunct whole.
    expect(backspaceStep('क्षि', 4)).toBe(3)
    expect(backspaceStep('क्ष', 3)).toBe(0)
    // A virama just typed goes on its own.
    expect(backspaceStep('क्', 2)).toBe(1)
    expect(backspaceStep('सेल', 2)).toBe(1)
    expect(backspaceStep('น\u0E49\u0E33', 3)).toBe(2)
    expect(backspaceStep('e\u0301', 2)).toBe(1)
    expect(backspaceStep('ab', 2)).toBe(1)
    expect(backspaceStep('ab', 0)).toBe(0)
  })

  it('steps back over an emoji whose first code point is a letter whole, and a variation selector with its letter', () => {
    // Ⓜ️, ℹ️ and 🅰️ with their emoji variation selector; 漢 with a variation selector of its own.
    for (const codes of [
      [0x24c2, 0xfe0f],
      [0x2139, 0xfe0f],
      [0x1f170, 0xfe0f],
      [0x6f22, 0xfe00],
    ]) {
      const text = String.fromCodePoint(...codes)
      expect(backspaceStep(text, text.length), text).toBe(0)
    }
  })

  it('steps back over emoji, flags, keycaps and Hangul whole', () => {
    for (const text of ['👨\u200D👩\u200D👧', '👍🏽', '🇯🇵', '1\uFE0F\u20E3', '\u1112\u1161\u11AB', '한', 'a\u200D'])
      expect(backspaceStep(`x${text}`, text.length + 1), text).toBe(1)
  })

  it('double click selects the word under it, in any script', () => {
    const text = 'Big summer sale'
    expect(wordAt(text, 5)).toEqual({ start: 4, end: 10 })
    // At a word's end it is still that word.
    expect(wordAt(text, 10)).toEqual({ start: 4, end: 10 })
    expect(wordAt('خصم اليوم', 6)).toEqual({ start: 4, end: 9 })
    expect(wordAt('श्री क्षेत्र', 6)).toEqual({ start: 5, end: 12 })
    // Between words, the space.
    expect(wordAt('a  b', 2)).toEqual({ start: 1, end: 3 })
  })

  it('steps a word at a time: on to the end of the next word, back to the start of the one before, in any script', () => {
    const text = 'Big summer, sale'
    expect([0, 3, 10, 16].map((at) => wordStep(text, at, true))).toEqual([3, 10, 16, 16])
    expect([16, 12, 5, 4, 0].map((at) => wordStep(text, at, false))).toEqual([12, 4, 4, 0, 0])
    expect(wordStep('خصم اليوم', 0, true)).toBe(3)
    expect(wordStep('خصم اليوم', 9, false)).toBe(4)
    expect(wordStep('श्री क्षेत्र', 0, true)).toBe(4)
  })

  it('triple click selects the paragraph', () => {
    const text = 'One\nTwo three\nFour'
    expect(paragraphAt(text, 6)).toEqual({ start: 4, end: 13 })
    expect(paragraphAt(text, 0)).toEqual({ start: 0, end: 3 })
    expect(paragraphAt(text, text.length)).toEqual({ start: 14, end: 18 })
  })

  it('says whether a style is on in every character, some or none', () => {
    const plain = stylesIn(props('Buy now'), { start: 0, end: 3 })
    expect(styleOn(plain, 'bold')).toBe(false)
    const partly = props('Buy now', [{ start: 0, end: 2, style: { fontWeight: 700, underline: true } }])
    expect(styleOn(stylesIn(partly, { start: 0, end: 3 }), 'bold')).toBe('mixed')
    expect(styleOn(stylesIn(partly, { start: 0, end: 2 }), 'underline')).toBe(true)
    expect(styleOn(stylesIn(props('Buy', [], 800), { start: 0, end: 3 }), 'bold')).toBe(true)
    const struck = props('Buy now', [{ start: 0, end: 7, style: { strikethrough: true, fontStyle: 'italic' } }])
    expect(styleOn(stylesIn(struck, { start: 2, end: 5 }), 'strikethrough')).toBe(true)
    expect(styleOn(stylesIn(struck, { start: 2, end: 5 }), 'italic')).toBe(true)
  })

  it('gives each character the features of its text and its runs, tag by tag', () => {
    const base = props('12 sold')
    const text = {
      ...base,
      style: { ...base.style, features: { liga: false } },
      runs: [{ start: 0, end: 2, style: { features: { tnum: true } } }],
    }
    expect(stylesIn(text, { start: 1, end: 3 }).map((s) => s.features)).toEqual([
      { liga: false, tnum: true },
      { liga: false },
    ])
  })

  it('writes Bold as the weight nearest 700 a family has from 600 up, and takes it off to the nearest 400 below', () => {
    expect(styleWrite('bold', true, [400, 700, 800])).toEqual({ fontWeight: 700 })
    expect(styleWrite('bold', false, [400, 700, 800])).toEqual({ fontWeight: 400 })
    expect(styleWrite('bold', true, [300, 600, 900])).toEqual({ fontWeight: 600 })
    expect(styleWrite('bold', false, [300, 500, 900])).toEqual({ fontWeight: 300 })
  })

  it('writes no weight for a family with none on the side asked for', () => {
    expect(styleWrite('bold', true, [400])).toBeNull()
    expect(styleWrite('bold', false, [700, 900])).toBeNull()
    expect(styleWrite('bold', true, [])).toBeNull()
  })

  it('writes italic, underline and strikethrough on or off, whatever the family', () => {
    expect(styleWrite('italic', true, [])).toEqual({ fontStyle: 'italic' })
    expect(styleWrite('italic', false, [])).toEqual({ fontStyle: 'normal' })
    expect(styleWrite('underline', true, [])).toEqual({ underline: true })
    expect(styleWrite('strikethrough', false, [])).toEqual({ strikethrough: false })
  })
})
