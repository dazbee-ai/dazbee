import { describe, expect, it } from 'vitest'

import { previewText } from './preview-text.ts'

/** A face that has a glyph for every character `has` matches, as CanvasKit gives glyph IDs: 0 for one it lacks. */
const face = (has: RegExp) => (text: string) => [...text].map((char, i) => (has.test(char) ? i + 1 : 0))

describe('previewText', () => {
  it('is the family’s name when the face draws it', () => {
    expect(previewText('Inter', ['Latn'], face(/[\p{L} ]/u))).toBe('Inter')
  })

  it('is the name in capitals when the face draws only those', () => {
    expect(previewText('Bungee Shade', ['Latn'], face(/[A-Z ]/))).toBe('BUNGEE SHADE')
  })

  it('is a few letters of the family’s first script the face draws when it lacks its name’s', () => {
    expect(previewText('Noto Sans Tifinagh', ['Tfng'], face(/\p{Script=Tifinagh}/u))).toBe('ⴰⴱⴲⴳⴴⴵⴶⴷ')
    expect(previewText('Noto Sans Arabic', ['Arab', 'Latn'], face(/[ء-ي]/u))).toBe('ءآأؤإئاب')
  })

  it('takes kana for Japanese, Hangul for Korean and Han for Chinese', () => {
    expect(previewText('Mincho', ['Jpan'], face(/\p{Script=Hiragana}/u))).toBe('ぁあぃいぅうぇえ')
    expect(previewText('Gothic', ['Kore'], face(/\p{Script=Hangul}/u))).toMatch(/^\p{Script=Hangul}{8}$/u)
    expect(previewText('Song', ['Hant'], face(/\p{Script=Han}/u))).toMatch(/^\p{Script=Han}{8}$/u)
  })

  it('takes pictographs for emoji and signs for symbols', () => {
    expect(previewText('Emoji', ['Zsye'], face(/\p{Extended_Pictographic}/u))).toMatch(
      /^\p{Extended_Pictographic}{8}$/u,
    )
    expect(previewText('Symbols', ['Zsym'], face(/\p{So}/u))).toMatch(/^\p{So}{8}$/u)
  })

  it('is the name when the face draws nothing of its scripts, or a script no regular expression knows', () => {
    expect(previewText('Blank', ['Latn'], face(/$^/))).toBe('Blank')
    expect(previewText('Future', ['Qaaa'], face(/$^/))).toBe('Future')
  })
})
