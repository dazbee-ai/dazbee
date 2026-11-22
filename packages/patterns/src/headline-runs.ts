// How a lead text's words are set as one text at every size: the words that belong together joined so no line
// breaks between them, the words set apart in a colour or a face the font has, and a number's unit set smaller.
import { shownScale } from '@dazbee/schema'

import { SHORT_FRAME } from './frame-shape.ts'
import { apart, contrast, inkOn, LARGE_TEXT_CONTRAST, TEXT_CONTRAST } from './palette.ts'
import { LARGE_TEXT_PX } from './text-look.ts'
import type { Setting, WordPart } from './words.ts'

/** A number's unit's share of its digits' size. */
const UNIT_SHARE = 0.6
/** A no-break space: words joined by it stay on one line. */
export const KEEP = '\u00A0'
/** The longest run of words at a line's end that are kept together, in characters. */
const KEPT_END = 14

/**
 * A headline with the words that belong together joined by no-break spaces, alike at every size: the words set
 * apart, a word of two letters or fewer and the word after it, its last two words where they are short, so no line
 * ends on a small word and no word is left alone on the last line, and a headline of two words, such as a product's
 * name, which never splits. Where `ends` is false, in a narrow measure whose lines hold a word or two, the words set
 * apart and the last two words may break.
 */
export function kept(text: string, highlight?: string, ends = true): string {
  const words = text.split(' ')
  // A join at `i` keeps word `i` and the word after it together.
  const joins = new Set<number>()
  for (let i = 0; i + 1 < words.length; i++) if ((words[i] ?? '').replace(/\W/gu, '').length <= 2) joins.add(i)
  const last = words.length - 2
  if (words.length === 2) joins.add(0)
  if (ends && words.length >= 4 && (words[last] ?? '').length + (words[last + 1] ?? '').length < KEPT_END)
    joins.add(last)
  const at = highlight ? text.toLowerCase().indexOf(highlight.toLowerCase()) : -1
  if (ends && highlight && at >= 0 && highlight.split(' ').length <= 3) {
    let start = 0
    for (let i = 0; i + 1 < words.length; i++) {
      start += (words[i] ?? '').length + 1
      if (start > at && start < at + highlight.length) joins.add(i)
    }
  }
  return words.map((word, i) => word + (i + 1 < words.length ? (joins.has(i) ? KEEP : ' ') : '')).join('')
}

/**
 * The runs that set a number's unit apart: a sign after its digits, or a currency before them, set smaller, where it
 * is still large text at that size, so its ink reads as the number's does.
 */
export function unitRuns({ frame }: Setting, text: string, size: number) {
  const digits = /\d[\d.,]*/u.exec(text)
  const unit = Math.round(size * UNIT_SHARE)
  if (!digits || unit / shownScale(frame.width, frame.height) < LARGE_TEXT_PX) return []
  const small = { fontSize: unit }
  const end = digits.index + digits[0].length
  return [
    ...(text.slice(0, digits.index).trim().length > 0 ? [{ start: 0, end: digits.index, style: small }] : []),
    ...(end < text.length ? [{ start: end, end: text.length, style: small }] : []),
  ]
}

/** How far apart a highlight's colour is from the headline's own ink: by contrast, or by CIEDE2000. */
const HIGHLIGHT_APART = { ratio: 1.5, difference: 20 }

/** The line height, as a multiple of the size, an underlined headline is set at least, so its rule clears the next line's caps. */
export const UNDERLINED_LEADING = 1.24

/**
 * The runs that set the highlighted words apart, decided once for every size of a set, so a campaign's key words
 * are set apart alike: in the italic of a style that slants them where its own font has one; else in the first of
 * the kit's colours plainly apart from the text's own ink that reads on the surface as the set's smallest headline
 * does (`setting.highlightContrast`: 3:1 where every size sets it as large text, else 4.5:1); else in the way the
 * style's own font has (italic or a heavier weight), and underlined in a brand's font, whose faces aren't known. A
 * short frame, which has no room for an underline's leading, sets an underlined highlight plain, never in another
 * way. A slant is never made up for a font without an italic.
 */
export function highlightRuns(setting: Setting, surface: string, part: WordPart, size: number) {
  const spaced = part.text.replaceAll(KEEP, ' ').toLowerCase()
  const at = part.highlight ? spaced.indexOf(part.highlight.toLowerCase()) : -1
  if (!part.highlight || at < 0) return []
  const range = { start: at, end: at + part.highlight.length }
  const { palette, style, frame } = setting
  const emphasis = palette.brandFont.heading ? { by: 'underline' as const } : style.emphasis
  const italic = { ...range, style: { fontStyle: 'italic' as const } }
  if (style.highlight === 'italic' && emphasis.by === 'italic') return [italic]
  const large = size / shownScale(frame.width, frame.height) >= LARGE_TEXT_PX
  const needed = setting.highlightContrast ?? (large ? LARGE_TEXT_CONTRAST : TEXT_CONTRAST)
  // The headline's ink as small text takes it, so the colour chosen is alike at every size.
  const ink = inkOn(surface, [palette.text, palette.background])
  const colour = [palette.accent, palette.primary, palette.secondary, palette.text, palette.background].find(
    (swatch) =>
      apart(swatch.value, ink.value, HIGHLIGHT_APART.ratio, HIGHLIGHT_APART.difference) &&
      contrast(swatch.value, surface) >= needed,
  )
  if (colour) return [{ ...range, style: { color: colour.value } }]
  if (emphasis.by === 'italic') return [italic]
  if (emphasis.by === 'weight') return [{ ...range, style: { fontWeight: emphasis.weight ?? 800 } }]
  // A short frame has no room for the leading an underline needs: its words are set plain.
  if (frame.height <= SHORT_FRAME) return []
  return [{ ...range, style: { underline: true } }]
}

/** Whether a text's runs underline some of it. */
export function underlined(runs: readonly { style: object }[]): boolean {
  return runs.some((run) => 'underline' in run.style && run.style.underline === true)
}
