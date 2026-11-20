// A text layer's text and runs as plain data, and one edit applied to them: what the store writes
// for `text.edit`; the edits that replace a range; and the matches of a text found whatever their
// case, and the edits that replace them.
import { type RunStyle, type TextRun, withRunStyle } from '@dazbee/schema'

import { sameValue } from './same-value.ts'

/** A text layer's characters and the runs styling them, as its props hold them. */
export interface TextValue {
  text: string
  runs: TextRun[]
}

/** One edit of a text: offsets and lengths count UTF-16 units. */
export type TextOp =
  | { kind: 'insert'; at: number; text: string }
  | { kind: 'delete'; at: number; length: number }
  | { kind: 'style'; at: number; length: number; style: RunStyle }

/** What each half of a surrogate pair an edit cuts in two becomes, so a text stays valid UTF-16. */
const REPLACEMENT = '\uFFFD'

/**
 * The text and runs after one edit. Inserted text takes the style of the character before it, and
 * none at the start; a style sets its keys over what each character in its range has, its features
 * tag by tag (`withRunStyle`). Adjacent
 * characters with the same style come back as one run, and unstyled ones in none. An offset or a
 * range past the end stops at the end. An edit that starts or ends inside a surrogate pair turns
 * both its halves into U+FFFD first, keeping their style.
 */
export function applyTextOp(value: TextValue, op: TextOp): TextValue {
  const at = Math.min(op.at, value.text.length)
  const text = cutPairs(value.text, op.kind === 'insert' ? [at] : [at, at + op.length])
  const styles = stylesOf(text, value.runs)
  if (op.kind === 'insert') {
    const style = at > 0 ? styles[at - 1] : undefined
    // Joined, not spread into `splice`: a pasted text can be millions of characters.
    const inserted = styles
      .slice(0, at)
      .concat(new Array<RunStyle | undefined>(op.text.length).fill(style), styles.slice(at))
    return { text: text.slice(0, at) + op.text + text.slice(at), runs: runsOf(inserted) }
  }
  const end = Math.min(at + op.length, text.length)
  if (op.kind === 'delete') {
    styles.splice(at, end - at)
    return { text: text.slice(0, at) + text.slice(end), runs: runsOf(styles) }
  }
  for (let i = at; i < end; i++) styles[i] = withRunStyle<RunStyle>(styles[i] ?? {}, op.style)
  return { text, runs: runsOf(styles) }
}

/**
 * Where each match of `find` starts in `text`, matched whatever its case, one after another without
 * overlapping, as FigCraft's find and replace finds them; none for nothing to find. A match never
 * starts or ends inside a character written as two UTF-16 units.
 */
export function matchesIn(text: string, find: string): number[] {
  const needle = find.toLowerCase()
  const at: number[] = []
  if (find.length === 0) return at
  for (let i = 0; i + find.length <= text.length;) {
    const end = i + find.length
    if (!splitsPair(text, i) && !splitsPair(text, end) && text.slice(i, end).toLowerCase() === needle) {
      at.push(i)
      i = end
    } else i++
  }
  return at
}

/**
 * The edits, in order, that replace `start`–`end` of `text` with `insert`, so the new text takes the
 * style of the first character it replaces: it goes in after that character (two UTF-16 units for one
 * above U+FFFF), then the rest of the range and that character go. With an empty range it is inserted
 * there, taking the style of the character before; with nothing to insert the range is deleted.
 */
export function replaceRangeOps(text: string, start: number, end: number, insert: string): TextOp[] {
  if (end <= start) return insert ? [{ kind: 'insert', at: start, text: insert }] : []
  if (!insert) return [{ kind: 'delete', at: start, length: end - start }]
  const first = Math.min(isFirstHalf(text.charCodeAt(start)) ? 2 : 1, end - start)
  const rest = end - start - first
  return [
    { kind: 'insert', at: start + first, text: insert },
    ...(rest > 0 ? [{ kind: 'delete' as const, at: start + first + insert.length, length: rest }] : []),
    { kind: 'delete', at: start, length: first },
  ]
}

/**
 * The edits that replace every match of `find` in `text` (`matchesIn`) with `replace`, last first so
 * each offset holds as the edits apply in order; each replacement takes the style of its match's
 * first character (`replaceRangeOps`).
 */
export function replaceOps(text: string, find: string, replace: string): TextOp[] {
  return matchesIn(text, find)
    .reverse()
    .flatMap((at) => replaceRangeOps(text, at, at + find.length, replace))
}

/** The text with each surrogate pair that one of `edges` falls inside turned into two U+FFFD. */
function cutPairs(text: string, edges: readonly number[]): string {
  let cut = text
  for (const edge of edges) {
    if (edge > 0 && edge < cut.length && isFirstHalf(cut.charCodeAt(edge - 1)))
      cut = cut.slice(0, edge - 1) + REPLACEMENT + REPLACEMENT + cut.slice(edge + 1)
  }
  return cut
}

/** Each character's style, undefined where no run styles it. */
function stylesOf(text: string, runs: readonly TextRun[]): (RunStyle | undefined)[] {
  const styles = new Array<RunStyle | undefined>(text.length).fill(undefined)
  for (const { start, end, style } of runs) {
    for (let i = start; i < Math.min(end, text.length); i++) styles[i] = withRunStyle<RunStyle>(styles[i] ?? {}, style)
  }
  return styles
}

/** The runs giving each character its style: one per stretch of equal styles, none where there is no style. */
function runsOf(styles: readonly (RunStyle | undefined)[]): TextRun[] {
  const runs: TextRun[] = []
  styles.forEach((style, i) => {
    const last = runs.at(-1)
    if (last && last.end === i && sameValue(last.style, style)) last.end = i + 1
    else if (style && Object.keys(style).length > 0) runs.push({ start: i, end: i + 1, style })
  })
  return runs
}

/** Whether `at` falls between the two UTF-16 units of one character, such as an emoji. */
export function splitsPair(text: string, at: number): boolean {
  if (at <= 0 || at >= text.length) return false
  const after = text.charCodeAt(at)
  return isFirstHalf(text.charCodeAt(at - 1)) && after >= 0xdc00 && after <= 0xdfff
}

/** Whether a UTF-16 unit is the first of the two a character above U+FFFF is written as. */
function isFirstHalf(unit: number): boolean {
  return unit >= 0xd800 && unit <= 0xdbff
}
