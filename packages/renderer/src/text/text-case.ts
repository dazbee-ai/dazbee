import type { TextProps } from '@dazbee/schema'

type Style = TextProps['style']

const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u
const LETTER = /\p{L}/u
const APOSTROPHE = /['’]/u

/** The text with each piece's case applied, a code point at a time and only where that keeps its length, so offsets still match. */
export function withCase(text: string, styleAt: (offset: number) => Style): string {
  let out = ''
  let i = 0
  let before = ''
  let prev = ''
  for (const ch of text) {
    const mode = styleAt(i).textCase ?? 'none'
    let next = ch
    if (mode === 'upper' || (mode === 'title' && startsWord(before, prev, ch))) next = ch.toUpperCase()
    else if (mode === 'lower') next = ch.toLowerCase()
    out += next.length === ch.length ? next : ch
    before = prev
    prev = ch
    i += ch.length
  }
  return out
}

/**
 * Whether `ch`, after `prev` and `before` it, starts a word: it follows no letter, number or mark,
 * and is not a letter after an apostrophe that follows a letter, number or mark.
 */
function startsWord(before: string, prev: string, ch: string): boolean {
  if (WORD_CHAR.test(prev)) return false
  return !(APOSTROPHE.test(prev) && WORD_CHAR.test(before) && LETTER.test(ch))
}
