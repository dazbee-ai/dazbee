// What a font's preview draws: the family's name, or, for a face that lacks its name's letters, as a
// font made for another script does, a few characters of that script it has; and which scripts a
// face's own characters are in, for an upload, whose scripts no catalog names.
import { byCodeUnits } from '@dazbee/schema'

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

/**
 * The ISO 15924 codes of Unicode's scripts that have letters, but Common and Inherited. A code the
 * running engine's Unicode doesn't know is skipped.
 */
const UNICODE_SCRIPTS =
  'Adlm Aghb Ahom Arab Armi Armn Avst Bali Bamu Bass Batk Beng Berf Bhks Bopo Brah Brai Bugi Buhd Cakm Cans Cari ' +
  'Cham Cher Chis Chrs Copt Cpmn Cprt Cyrl Deva Diak Dogr Dsrt Dupl Egyp Elba Elym Ethi Gara Geor Glag Gong Gonm ' +
  'Goth Gran Grek Gujr Gukh Guru Hang Hani Hano Hatr Hebr Hira Hluw Hmng Hmnp Hung Ital Java Kali Kana Kawi Khar ' +
  'Khmr Khoj Kits Knda Krai Kthi Lana Laoo Latn Lepc Limb Lina Linb Lisu Lyci Lydi Mahj Maka Mand Mani Marc Medf ' +
  'Mend Merc Mero Mlym Modi Mong Mroo Mtei Mult Mymr Nagm Nand Narb Nbat Newa Nkoo Nshu Ogam Olck Onao Orkh Orya ' +
  'Osge Osma Ougr Palm Pauc Perm Phag Phli Phlp Phnx Plrd Prti Rjng Rohg Runr Samr Sarb Saur Sgnw Shaw Shrd Sidd ' +
  'Sidt Sind Sinh Sogd Sogo Sora Soyo Sund Sunu Sylo Syrc Tagb Takr Tale Talu Taml Tang Tavt Tayo Telu Tfng Tglg ' +
  'Thaa Thai Tibt Tirh Tnsa Todr Tols Toto Tutg Ugar Vaii Vith Wara Wcho Xpeo Xsux Yezi Yiii Zanb'
/** A letter of any script. */
const LETTER = /\p{L}/u

/** Each script's characters that may stand for it, in code point order, once worked out. */
const samples = new Map<string, string>()
/** Each script of `UNICODE_SCRIPTS` the engine knows, with what matches its characters, once made. */
let scriptPatterns: readonly (readonly [string, RegExp])[] | undefined

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

/**
 * The scripts a face's characters are in, as ISO 15924 codes for `previewText`: those it has letters
 * of, the most letters first (ties by code), then signs (`Zsym`) and mathematics (`Zmth`) when it
 * has those.
 */
export function scriptsOf(codePoints: Iterable<number>): string[] {
  const patterns = (scriptPatterns ??= UNICODE_SCRIPTS.split(' ').flatMap((code) => {
    try {
      return [[code, new RegExp(`\\p{Script=${code}}`, 'u')] as const]
    } catch {
      return []
    }
  }))
  const letters = new Map<string, number>()
  const signs = new Set<string>()
  // A script's letters come in runs, so the last letter's script is tried first.
  let last: readonly [string, RegExp] | undefined
  for (const point of codePoints) {
    const char = String.fromCodePoint(point)
    if (!LETTER.test(char)) {
      for (const code of ['Zsym', 'Zmth']) if (SCRIPT_CHARACTERS[code]?.test(char)) signs.add(code)
      continue
    }
    const script = last?.[1].test(char) ? last : patterns.find(([, pattern]) => pattern.test(char))
    if (!script) continue
    last = script
    letters.set(script[0], (letters.get(script[0]) ?? 0) + 1)
  }
  const byLetters = [...letters].sort(([a, m], [b, n]) => n - m || byCodeUnits(a, b)).map(([code]) => code)
  return [...byLetters, ...['Zsym', 'Zmth'].filter((code) => signs.has(code))]
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
