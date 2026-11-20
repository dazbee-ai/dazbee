// Editing inside a text layer (#47): the ranges a double or triple click selects, where the arrow
// keys go, and the rule a style key follows: whether its style is on, and what turning it on or off
// writes, Bold picking from the weights a family has. Kept free of the editor so it can be tested on
// its own. Offsets count UTF-16 units, as the document's text does.
import { type Design, withRunStyle } from '@dazbee/schema'

import type { ShortcutAction } from '../shortcuts.ts'

type TextNode = Extract<Design['nodes'][string], { type: 'text' }>
type Style = TextNode['props']['style']
export type RunStyle = Partial<Style>

/** A range of the text; `start` is never after `end`. */
export interface TextRange {
  start: number
  end: number
}

/** The shortcut actions that toggle a text style: on the selected range while typing, else on the selected text layers. */
export const STYLE_TOGGLES = [
  'bold',
  'italic',
  'underline',
  'strikethrough',
] as const satisfies readonly ShortcutAction[]
/** What a style key toggles: bold, italic, underline or strikethrough. */
export type StyleToggle = (typeof STYLE_TOGGLES)[number]

/** Bold from this weight up, as type designers name their weights. */
const BOLD = 600
/** Whether each toggle's style is on in a style. */
const ON: Record<StyleToggle, (style: Style) => boolean> = {
  bold: (s) => s.fontWeight >= BOLD,
  italic: (s) => s.fontStyle === 'italic',
  underline: (s) => s.underline === true,
  strikethrough: (s) => s.strikethrough === true,
}
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const words = new Intl.Segmenter(undefined, { granularity: 'word' })
/** A letter of any script, Unicode's Alphabetic property, which a grapheme's trailing marks may follow. */
const LETTER = /\p{Alphabetic}/u
const ZWJ = '‍'

/** Every offset a caret can stand at: the edges of Unicode's graphemes. */
const graphemeEdges = (text: string) => [0, ...[...graphemes.segment(text)].map((g) => g.index + g.segment.length)]

/** Whether a text is one grapheme: what a key that types carries, an emoji of several code points too. */
export function oneGrapheme(text: string): boolean {
  const [first, second] = graphemes.segment(text)
  return first !== undefined && second === undefined
}

/** Whether a shortcut action toggles a text style. */
export function isStyleToggle(action: ShortcutAction | null): action is StyleToggle {
  return (STYLE_TOGGLES as readonly string[]).includes(action ?? '')
}

/** The offset one grapheme on, or back. */
export function step(text: string, offset: number, forward: boolean): number {
  const edges = graphemeEdges(text)
  return forward ? (edges.find((x) => x > offset) ?? text.length) : (edges.findLast((x) => x < offset) ?? 0)
}

/**
 * Where Backspace at an offset deletes back to: a letter's trailing mark alone (a Devanagari vowel
 * sign or virama, a Thai tone mark, an accent typed after its letter), so कि becomes क as Indic
 * keyboards expect; any other grapheme whole, so emoji, flags, keycaps and Hangul syllables go at once.
 */
export function backspaceStep(text: string, offset: number): number {
  const start = step(text, offset, false)
  const chars = [...text.slice(start, offset)]
  const last = chars.at(-1)
  const letter = chars.length > 1 && LETTER.test(chars[0] ?? '')
  return letter && last !== undefined && isTrailingMark(last) ? offset - last.length : start
}

/**
 * The word a double click at an offset selects: the word it is in, or touches at its end; between
 * words, the space or punctuation there.
 */
export function wordAt(text: string, offset: number): TextRange {
  const segments = [...words.segment(text)]
  const inside =
    segments.find((s) => offset >= s.index && offset < s.index + s.segment.length && s.isWordLike) ??
    segments.find((s) => offset === s.index + s.segment.length && s.isWordLike) ??
    segments.find((s) => offset >= s.index && offset < s.index + s.segment.length) ??
    segments.at(-1)
  return inside ? { start: inside.index, end: inside.index + inside.segment.length } : { start: offset, end: offset }
}

/**
 * The offset a word on, or back, as Ctrl+Left and Ctrl+Right (Alt on a Mac) move: on to the end of
 * the next word, back to the start of the word before; the text's ends past the last.
 */
export function wordStep(text: string, offset: number, forward: boolean): number {
  const found = [...words.segment(text)].filter((s) => s.isWordLike)
  if (forward) return found.map((s) => s.index + s.segment.length).find((end) => end > offset) ?? text.length
  return found.map((s) => s.index).findLast((start) => start < offset) ?? 0
}

/** The paragraph a triple click selects: the text between the line breaks around the offset. */
export function paragraphAt(text: string, offset: number): TextRange {
  const start = text.lastIndexOf('\n', offset - 1) + 1
  const next = text.indexOf('\n', offset)
  return { start, end: next === -1 ? text.length : next }
}

/** Each character's style in a range: the base, then every run over it, later runs winning (`withRunStyle`). */
export function stylesIn(props: TextNode['props'], range: TextRange): Style[] {
  const out: Style[] = []
  for (let i = range.start; i < range.end; i++) {
    let style = { ...props.style }
    for (const run of props.runs) if (run.start <= i && run.end > i) style = withRunStyle(style, run.style)
    out.push(style)
  }
  return out
}

/** Whether a style is on in every one of `styles` (true), in some (`mixed`) or in none (false); bold from weight 600 up. */
export function styleOn(styles: readonly Style[], toggle: StyleToggle): boolean | 'mixed' {
  const on = styles.map((s) => ON[toggle](s))
  return on.every(Boolean) ? true : on.some(Boolean) ? 'mixed' : false
}

/**
 * What a toggle writes to turn its style on or off, in a family with the upright `weights`: Bold on
 * is the weight nearest 700 from 600 up, off the weight nearest 400 below 600; null, writing
 * nothing, where the family has no weight on that side. The other styles write whatever the family.
 */
export function styleWrite(toggle: StyleToggle, on: boolean, weights: readonly number[]): RunStyle | null {
  switch (toggle) {
    case 'bold': {
      const side = weights.filter((w) => (on ? w >= BOLD : w < BOLD))
      const wanted = on ? 700 : 400
      const [first] = side
      if (first === undefined) return null
      return {
        fontWeight: side.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best), first),
      }
    }
    case 'italic':
      return { fontStyle: on ? 'italic' : 'normal' }
    case 'underline':
      return { underline: on }
    case 'strikethrough':
      return { strikethrough: on }
  }
}

/** Whether a character joins the grapheme of a letter before it as a mark (Extend or SpacingMark); the zero-width joiner joins, but is no mark. */
function isTrailingMark(char: string): boolean {
  return char !== ZWJ && oneGrapheme(`a${char}`)
}
