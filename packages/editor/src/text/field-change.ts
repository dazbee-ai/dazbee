// What the stage field is given to hold for the text being edited, and what the browser changed in
// it read as one edit, by comparing what the field holds with what it was given: an edit of the
// text, or while an input method composes, a composition.
import { type DesignStore, splitsPair, type TextAnchor } from '@dazbee/doc'

import { paragraphsOf } from '../pasted-text.ts'
import type { Composition } from './composition.ts'
import type { TextRange } from './text-edit.ts'

/** What the stage field holds: its value, and its selection's start and end, which meet at a caret. */
export interface FieldState {
  value: string
  start: number
  end: number
}

/**
 * One change to what the field was given, in its offsets: `start`–`end` of the given value became
 * `text`, and the field's caret then stands at `caret` in the value it holds.
 */
export interface FieldChange {
  start: number
  end: number
  text: string
  caret: number
}

/** What the stage field was given, and its selection's two ends anchored in the text. */
export interface HeldField {
  given: FieldState
  start: TextAnchor
  end: TextAnchor
}

/**
 * A change the field made as an edit of the text: the range it replaces, the change itself, its text
 * with line breaks as paragraphs as it is written, and the field's selection in the text once it is.
 */
export interface FieldEdit {
  range: TextRange
  change: FieldChange
  typed: string
  selection: TextRange
}

/** The longest selected range the field holds, in UTF-16 units; a longer one is held as nothing. */
const FIELD_MOST = 4_000

/** What the field holds for a text and its selected range: the selected text alone, all selected; nothing at a caret. */
export function fieldText(text: string, range: TextRange): FieldState {
  if (range.end - range.start > FIELD_MOST) return { value: '', start: 0, end: 0 }
  const value = text.slice(range.start, range.end)
  return { value, start: 0, end: value.length }
}

/**
 * The field taken to hold `given`, its selection's two ends anchored at `range` in text `id`; the end
 * stays before what another tab types right after it.
 */
export function heldField(
  store: Pick<DesignStore, 'textAnchor'>,
  id: string,
  given: FieldState,
  range: TextRange,
): HeldField {
  return { given, start: store.textAnchor(id, range.start), end: store.textAnchor(id, range.end, true) }
}

/**
 * What the field holding `state` changed of what it was given: what no longer stands between the
 * longest common start and end of the two values, the start taken no further than the given
 * selection's start and the end no further back than its end, so the change sits where the caret
 * was; an empty change at the selection's start when only the selection moved. Null when the field
 * holds what it was given, its selection too.
 */
export function fieldChange(given: FieldState, state: FieldState): FieldChange | null {
  const was = given.value
  const now = state.value
  if (was === now && given.start === state.start && given.end === state.end) return null
  // Only the selection moved: nothing is replaced.
  if (was === now) return { start: given.start, end: given.start, text: '', caret: state.end }
  // The common start stops at the given selection's start, and the common end at its end.
  const before = Math.min(was.length, now.length, given.start)
  let start = 0
  while (start < before && was.charCodeAt(start) === now.charCodeAt(start)) start++
  const after = Math.min(was.length - given.end, now.length - start)
  let sameEnd = 0
  while (sameEnd < after && was.charCodeAt(was.length - 1 - sameEnd) === now.charCodeAt(now.length - 1 - sameEnd))
    sameEnd++
  // An edge never falls between the two UTF-16 units of one character.
  if (splitsPair(was, start) || splitsPair(now, start)) start--
  if (splitsPair(was, was.length - sameEnd) || splitsPair(now, now.length - sameEnd)) sameEnd--
  const end = was.length - sameEnd
  return { start, end, text: now.slice(start, now.length - (was.length - end)), caret: state.end }
}

/**
 * The change the field holding `state` made to what it was given, in a text `length` long whose
 * offsets `ends` are where the given selection's two ends are: an offset before the selection
 * counts back from its start, one after it on from its end. Null when nothing changed.
 */
export function fieldEdit(given: FieldState, ends: TextRange, state: FieldState, length: number): FieldEdit | null {
  const change = fieldChange(given, state)
  if (!change) return null
  // A change starts no later than the given selection and ends no earlier.
  const before = (offset: number) => Math.max(0, ends.start - (given.start - offset))
  const after = (offset: number) => ends.end + offset - given.end
  const start = Math.min(before(change.start), length)
  const range = { start, end: Math.min(Math.max(start, after(change.end)), length) }
  const typed = paragraphsOf(change.text)
  /** An offset in what the field holds now, in the text once the change is written. */
  const written = (offset: number) => {
    if (offset < change.start) return before(offset)
    if (offset <= change.start + change.text.length)
      return range.start + paragraphsOf(change.text.slice(0, offset - change.start)).length
    return after(offset - change.text.length + change.end - change.start) + typed.length - (range.end - range.start)
  }
  return { range, change, typed, selection: { start: written(state.start), end: written(state.end) } }
}

/**
 * The composition a change made while an input method composes: the range it replaces, its text,
 * the part being composed (the input event's `data` where it stands around the field's caret, else
 * the whole change) and the input method's cursor, at the field's caret.
 */
export function compositionOf({ range, change }: FieldEdit, data: string): Composition {
  const { text } = change
  const cursor = Math.min(Math.max(change.caret - change.start, 0), text.length)
  let part = { start: 0, end: text.length }
  for (let at = data === '' ? -1 : text.indexOf(data); at >= 0; at = text.indexOf(data, at + 1)) {
    if (at <= cursor && cursor <= at + data.length) {
      part = { start: at, end: at + data.length }
      break
    }
  }
  return { range, text, part, cursor }
}
