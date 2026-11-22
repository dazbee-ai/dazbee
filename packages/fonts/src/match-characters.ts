// The characters ads use, which a match copy keeps and the text matcher's coverage index reads in this order: Latin
// with its extensions, Greek, Cyrillic, Arabic, Devanagari, punctuation, currency and letterlike symbols.

/** The characters, as ranges of code points from the first to the last, in their order. */
export const MATCH_CHARACTER_RANGES: readonly (readonly [number, number])[] = [
  [0x20, 0x7e],
  [0xa0, 0x24f],
  [0x370, 0x3ff],
  [0x400, 0x4ff],
  [0x600, 0x6ff],
  [0x750, 0x77f],
  [0x900, 0x97f],
  [0x1e00, 0x1eff],
  [0x2000, 0x206f],
  [0x20a0, 0x20cf],
  [0x2100, 0x214f],
]

/** Each character's code point, in the ranges' order: the order of a coverage index's bits. */
export const MATCH_CHARACTERS: readonly number[] = MATCH_CHARACTER_RANGES.flatMap(([first, last]) =>
  Array.from({ length: last - first + 1 }, (_, i) => first + i),
)

const MATCH_CHARACTER_SET: ReadonlySet<number> = new Set(MATCH_CHARACTERS)

/** Whether every character of `text` but its white space is one of the characters ads use. */
export function coversAll(text: string): boolean {
  for (const character of text.replace(/\s/gu, ''))
    if (!MATCH_CHARACTER_SET.has(character.codePointAt(0) ?? -1)) return false
  return true
}
