// What a font's preview draws: the family's name, or, for a face that lacks its name's letters, as a
// font made for another script does, a few characters of that script it has.

/** How many characters a preview of a family's script shows. */
const SAMPLE_LENGTH = 8
/** The highest code point. */
const LAST_CODE_POINT = 0x10ffff

/**
 * The characters that stand for an ISO 15924 code: those of its Unicode script, or for the codes
 * that are no one script, kana and Han for Japanese, Hangul for Korean, Han for Chinese,
 * pictographs for emoji and signs for symbols and mathematics.
 */
const SCRIPT_CHARACTERS: Readonly<Record<string, RegExp>> = {
  Jpan: /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}]/u,
  Kore: /\p{Script=Hangul}/u,
  Hans: /\p{Script=Han}/u,
  Hant: /\p{Script=Han}/u,
  Zsye: /\p{Extended_Pictographic}/u,
  Zsym: /\p{So}/u,
  Zmth: /\p{Sm}/u,
}

/** Each script's characters that may stand for it, in code point order, once worked out. */
const samples = new Map<string, string>()

/**
 * The text a preview of `family` draws, given the face's glyph IDs for a text (0 where it lacks a
 * character): its name when the face draws every letter of it, else its name in capitals, else the
 * first few characters of the family's first script (in `scripts`' order) the face draws, else its
 * name as it is.
 */
export function previewText(
  family: string,
  scripts: readonly string[],
  glyphs: (text: string) => ArrayLike<number>,
): string {
  for (const name of [family, family.toUpperCase()]) if (drawsAll(name.replace(/\s/g, ''), glyphs)) return name
  for (const code of scripts) {
    const candidates = sampleOf(code)
    if (!candidates) continue
    const ids = glyphs(candidates)
    const drawn = [...candidates].filter((_, i) => (ids[i] ?? 0) !== 0)
    if (drawn.length > 0) return drawn.slice(0, SAMPLE_LENGTH).join('')
  }
  return family
}

/** Whether the face has a glyph for every character of the text. */
function drawsAll(text: string, glyphs: (text: string) => ArrayLike<number>): boolean {
  const ids = glyphs(text)
  return Array.from({ length: [...text].length }, (_, i) => ids[i] ?? 0).every((id) => id !== 0)
}

/**
 * Every character that may stand for the script, in code point order: its letters, or the signs
 * of a code that is signs. Null for a code no regular expression knows.
 */
function sampleOf(code: string): string | null {
  const known = samples.get(code)
  if (known !== undefined) return known || null
  let script = SCRIPT_CHARACTERS[code]
  const letter = script ? /./su : /\p{L}/u
  if (!script)
    try {
      script = new RegExp(`\\p{Script=${code}}`, 'u')
    } catch {
      samples.set(code, '')
      return null
    }
  const chars: string[] = []
  for (let point = 0x21; point <= LAST_CODE_POINT; point++) {
    if (point === 0xd800) point = 0xe000
    const char = String.fromCodePoint(point)
    if (script.test(char) && letter.test(char)) chars.push(char)
  }
  samples.set(code, chars.join(''))
  return chars.join('') || null
}
