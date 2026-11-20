// Balance and Pretty: a paragraph laid out at its box's width is broken again where the wrap style
// wants its lines to end. SkParagraph has no balance mode and one width per paragraph. Balance
// searches for a narrower width for the whole paragraph, which then moves along its box by what its
// alignment leaves over. Pretty keeps the box's width and ends a line early with a line separator in
// place of the space before a word: the same length, so every offset still matches.
import type { Paragraph } from '@dazbee/canvaskit'
import type { TextProps } from '@dazbee/schema'

/** A paragraph broken as its wrap style wants: the text it was built from, its width, and how far it moves along its box. */
export interface Rewrapped {
  paragraph: Paragraph
  text: string
  width: number
  dx: number
}

/** How close the narrowest width Balance finds is to the true one, in pixels. */
const BALANCE_STEP = 0.5
/** How many of the last lines Pretty may end early, and how many words each may give away. */
const PRETTY_LINES = 3
const PRETTY_WORDS = 3
/** Ends a line without ending the paragraph, and is a space to the bidi algorithm. */
const LINE_SEPARATOR = ' '
/** Spaces a line may break at; a no-break space is none of them. */
const BREAKING_SPACE = /[ \t  -  -  　]/u

const WORDS = new Intl.Segmenter(undefined, { granularity: 'word' })

/**
 * Breaks `paragraph`, built from `text` and laid out `width` wide, again as `props.wrapStyle`
 * wants. Balance lays it out at the narrowest width that adds no line, so its lines come out near
 * even. Pretty, when the last line holds one word, ends one of the three lines before it a word or
 * up to three early, the latest that leaves more than one word on the last line and adds no line;
 * the lines after it stay full. `remake` builds the paragraph from another text of the same length;
 * a paragraph replaced is deleted. A paragraph of one line, one with a word wider than the box, and
 * justified text are left as they are, and no word is broken.
 */
export function rewrap(
  paragraph: Paragraph,
  text: string,
  props: Pick<TextProps, 'wrapStyle' | 'align'>,
  rtl: boolean,
  width: number,
  remake: (text: string) => Paragraph,
): Rewrapped {
  const kept = { paragraph, text, width, dx: 0 }
  if (props.wrapStyle === 'auto' || props.align === 'justify') return kept
  const lines = paragraph.getLineMetrics().length
  const word = paragraph.getMinIntrinsicWidth()
  if (lines < 2 || word >= width) return kept
  if (props.wrapStyle === 'pretty') return pretty(paragraph, text, width, remake) ?? kept
  const narrowest = balanced(paragraph, lines, word, width)
  return { paragraph, text, width: narrowest, dx: alignedShift(props.align, rtl, width - narrowest) }
}

/** The narrowest width from `word` to `width` that keeps `lines` lines, to half a pixel; the paragraph is laid out at it. */
function balanced(paragraph: Paragraph, lines: number, word: number, width: number): number {
  let lo = word
  let hi = width
  while (hi - lo > BALANCE_STEP) {
    const mid = (lo + hi) / 2
    paragraph.layout(mid)
    if (paragraph.getLineMetrics().length === lines) hi = mid
    else lo = mid
  }
  paragraph.layout(hi)
  return hi
}

/** Pretty's paragraph, or null when its last line holds more than one word or no early end helps. */
function pretty(paragraph: Paragraph, text: string, width: number, remake: (text: string) => Paragraph) {
  const metrics = paragraph.getLineMetrics()
  if (!loneLastWord(paragraph, text)) return null
  for (let j = metrics.length - 2; j >= Math.max(0, metrics.length - 1 - PRETTY_LINES); j--) {
    const line = metrics[j]
    if (!line) continue
    const starts = wordStarts(text, line.startIndex, line.endExcludingWhitespaces).slice(-PRETTY_WORDS).reverse()
    for (const start of starts) {
      const broken = `${text.slice(0, start - 1)}${LINE_SEPARATOR}${text.slice(start)}`
      const tried = remake(broken)
      tried.layout(width)
      if (tried.getLineMetrics().length === metrics.length && !loneLastWord(tried, broken)) {
        paragraph.delete()
        return { paragraph: tried, text: broken, width, dx: 0 }
      }
      tried.delete()
    }
  }
  return null
}

/** Whether the paragraph's last line holds one word at most. */
function loneLastWord(paragraph: Paragraph, text: string): boolean {
  const last = paragraph.getLineMetrics().at(-1)
  if (!last) return false
  const words = [...WORDS.segment(text.slice(last.startIndex, last.endExcludingWhitespaces))]
  return words.filter((s) => s.isWordLike).length <= 1
}

/** Where words start after a breaking space from `from` to `to`, not counting the line's first. */
function wordStarts(text: string, from: number, to: number): number[] {
  const starts: number[] = []
  for (let i = from + 1; i < to; i++) {
    if (BREAKING_SPACE.test(text[i - 1] ?? '') && !BREAKING_SPACE.test(text[i] ?? '')) starts.push(i)
  }
  return starts
}

/** How far a paragraph `room` narrower than its box moves along it to keep its alignment. */
function alignedShift(align: TextProps['align'], rtl: boolean, room: number): number {
  if (align === 'center') return room / 2
  return (align === 'end') !== rtl ? room : 0
}
