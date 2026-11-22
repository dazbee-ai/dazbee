import { describe, expect, it } from 'vitest'

import { previewText, scriptsOf } from './preview-text.ts'

/** The code points of a text. */
const points = (text: string) => [...text].map((char) => char.codePointAt(0) ?? 0)

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

describe('scriptsOf', () => {
  it('names the scripts of the letters, the most letters first, and ties by code', () => {
    expect(scriptsOf(points('abcअआइईابتثج'))).toEqual(['Arab', 'Deva', 'Latn'])
    expect(scriptsOf(points('ab'))).toEqual(['Latn'])
    expect(scriptsOf(points('あ漢字'))).toEqual(['Hani', 'Hira'])
  })

  it('names signs and mathematics after the letters, and no script for digits, punctuation or letters of every script', () => {
    expect(scriptsOf(points('★+ب'))).toEqual(['Arab', 'Zsym', 'Zmth'])
    expect(scriptsOf(points('★'))).toEqual(['Zsym'])
    expect(scriptsOf(points('0123.,!ʹ'))).toEqual([])
  })

  it('names a script for every letter of a script Unicode has', () => {
    const letters: string[] = []
    for (let point = 0; point <= 0x10ffff; point++) {
      if (point === 0xd800) point = 0xdfff
      const char = String.fromCodePoint(point)
      if (/\p{L}/u.test(char) && !/[\p{Script=Zyyy}\p{Script=Zinh}]/u.test(char)) letters.push(char)
    }
    const named = new RegExp(
      scriptsOf(points(letters.join('')))
        .map((code) => `\\p{Script=${code}}`)
        .join('|'),
      'u',
    )
    expect(letters.filter((char) => !named.test(char))).toEqual([])
  })
})
