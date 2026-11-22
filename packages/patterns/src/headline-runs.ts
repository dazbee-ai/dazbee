// How a lead text's words are set as one text at every size: the words that belong together joined so no line
// breaks between them, the words set apart in a colour or a face the font has, and a number's unit set smaller.
import { shownScale } from '@dazbee/schema'

import { contrast, type Swatch, TEXT_CONTRAST } from './palette.ts'
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
 * apart, a word of two letters or fewer and the word after it, and its last two words where they are short, so no
 * line ends on a small word and no word is left alone on the last line.
 */
export function kept(text: string, highlight?: string): string {
  const words = text.split(' ')
  // A join at `i` keeps word `i` and the word after it together.
  const joins = new Set<number>()
  for (let i = 0; i + 1 < words.length; i++) if ((words[i] ?? '').replace(/\W/gu, '').length <= 2) joins.add(i)
  const last = words.length - 2
  if (words.length >= 4 && (words[last] ?? '').length + (words[last + 1] ?? '').length < KEPT_END) joins.add(last)
  const at = highlight ? text.toLowerCase().indexOf(highlight.toLowerCase()) : -1
  if (highlight && at >= 0 && highlight.split(' ').length <= 3) {
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

/**
 * The runs that set the highlighted words apart, alike at every size: in the italic of a style that slants them
 * where its own font has one; else in the first of the kit's colours, but the text's own, that reads on the surface
 * as small text does; else in the way the style's own font has (italic or a heavier weight), and underlined in a
 * brand's font, whose faces aren't known. A slant is never made up for a font without an italic.
 */
export function highlightRuns(setting: Setting, surface: string, part: WordPart, ink: Swatch) {
  const spaced = part.text.replaceAll(KEEP, ' ').toLowerCase()
  const at = part.highlight ? spaced.indexOf(part.highlight.toLowerCase()) : -1
  if (!part.highlight || at < 0) return []
  const range = { start: at, end: at + part.highlight.length }
  const { palette, style } = setting
  const emphasis = palette.brandFont.heading ? { by: 'underline' as const } : style.emphasis
  const italic = { ...range, style: { fontStyle: 'italic' as const } }
  if (style.highlight === 'italic' && emphasis.by === 'italic') return [italic]
  const colour = [palette.accent, palette.primary, palette.secondary, palette.text, palette.background].find(
    (swatch) => swatch.value !== ink.value && contrast(swatch.value, surface) >= TEXT_CONTRAST,
  )
  if (colour) return [{ ...range, style: { color: colour.value } }]
  if (emphasis.by === 'italic') return [italic]
  if (emphasis.by === 'weight') return [{ ...range, style: { fontWeight: emphasis.weight ?? 800 } }]
  return [{ ...range, style: { underline: true } }]
}
