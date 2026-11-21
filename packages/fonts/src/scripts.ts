// The script fonts: Noto families a text draws the characters of other scripts and colour emoji in
// when its own font lacks them. Each is a Google Fonts family, copied into our storage and offered in
// the chooser with the others; a text that isn't set in it loads it only once it has its characters.

/** A script font: the Google family, and what in a text needs it. */
export interface ScriptFont {
  family: string
  /** Matches a character, or a sequence, of a text that this family draws. */
  needs: RegExp
  /** Matches a text whose `needs` characters an earlier family draws, so this one isn't needed. */
  unless?: RegExp
}

/** The colour emoji font: COLRv1 glyphs, which CanvasKit draws in colour on every surface. */
export const EMOJI_FAMILY = 'Noto Color Emoji'

/** Kana: a text with it is Japanese, so its Han is drawn by the Japanese font. */
const KANA = /[\p{Script=Hiragana}\p{Script=Katakana}]/u
/** Hangul: a text with it is Korean, so its Hanja are drawn by the Korean font. */
const HANGUL = /\p{Script=Hangul}/u
/** Han, Bopomofo, CJK punctuation and full-width forms: the Chinese font's, unless kana or Hangul. */
const CJK = /[\p{Script=Han}\p{Script=Bopomofo}\u3000-\u303f\uff00-\uffef]/u
/** Kana or Hangul: the Japanese or the Korean font draws the text's other CJK characters. */
const KANA_OR_HANGUL = new RegExp(`${KANA.source}|${HANGUL.source}`, 'u')

const script = (family: string, needs: RegExp, unless?: RegExp): ScriptFont => ({
  family,
  needs,
  ...(unless ? { unless } : {}),
})

/**
 * The script fonts, in the order a text tries those it needs after the shipped fallbacks. The emoji
 * font comes last, so a symbol another font has keeps that font's look.
 */
export const SCRIPT_FONTS: readonly ScriptFont[] = [
  script('Noto Sans JP', KANA),
  script('Noto Sans KR', HANGUL),
  script('Noto Sans SC', CJK, KANA_OR_HANGUL),
  script('Noto Sans Thai', /\p{Script=Thai}/u),
  script('Noto Sans Hebrew', /\p{Script=Hebrew}/u),
  script('Noto Sans Bengali', /\p{Script=Bengali}/u),
  script('Noto Sans Gujarati', /\p{Script=Gujarati}/u),
  script('Noto Sans Gurmukhi', /\p{Script=Gurmukhi}/u),
  script('Noto Sans Kannada', /\p{Script=Kannada}/u),
  script('Noto Sans Malayalam', /\p{Script=Malayalam}/u),
  script('Noto Sans Oriya', /\p{Script=Oriya}/u),
  script('Noto Sans Tamil', /\p{Script=Tamil}/u),
  script('Noto Sans Telugu', /\p{Script=Telugu}/u),
  script('Noto Sans Sinhala', /\p{Script=Sinhala}/u),
  script('Noto Sans Georgian', /\p{Script=Georgian}/u),
  script('Noto Sans Armenian', /\p{Script=Armenian}/u),
  script('Noto Sans Khmer', /\p{Script=Khmer}/u),
  script('Noto Sans Lao', /\p{Script=Lao}/u),
  script('Noto Sans Myanmar', /\p{Script=Myanmar}/u),
  script('Noto Sans Ethiopic', /\p{Script=Ethiopic}/u),
  {
    family: EMOJI_FAMILY,
    // A pictograph from U+2300 on (☀ ♥ ✔ ⭐ 😀), one before it asked to be an emoji (U+FE0F), a
    // skin tone, a flag's regional indicator or a keycap. The signs before U+2300 alone (© ® ™ ‼ ↔) are in Noto
    // Sans and keep their text look; any other font a text tries first keeps its own glyph too.
    needs:
      /(?=\p{Extended_Pictographic})[\u{2300}-\u{10ffff}]|\p{Extended_Pictographic}\ufe0f|\p{Emoji_Modifier}|\p{Regional_Indicator}|\u20e3/u,
  },
]

/**
 * The script fonts a text needs, in `SCRIPT_FONTS`'s order: those whose characters it has and whose
 * `unless` it doesn't match. So Han needs the Chinese font only in a text with no kana and no Hangul.
 */
export function scriptFamilies(text: string): string[] {
  return SCRIPT_FONTS.filter((font) => !font.unless?.test(text) && font.needs.test(text)).map((f) => f.family)
}
