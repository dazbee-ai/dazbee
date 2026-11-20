// What the stage field is given to hold for the text being edited, and what the browser changed in
// it read as one edit, by comparing what the field holds with what it was given.
import { splitsPair } from '@dazbee/doc'

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

/** The longest selected range the field holds, in UTF-16 units; a longer one is held as nothing. */
export const FIELD_MOST = 4_000

/** What the field holds for a text and its selected range: the selected text alone, all selected; nothing at a caret. */
export function fieldText(text: string, range: TextRange): FieldState {
  if (range.end - range.start > FIELD_MOST) return { value: '', start: 0, end: 0 }
  const value = text.slice(range.start, range.end)
  return { value, start: 0, end: value.length }
}

/**
 * What the field holding `state` changed of what it was given: what no longer stands between the
 * longest common start and end of the two values, the start taken no further than the given
 * selection's start and the end no further back than its end, so the change sits where the caret
 * was. Null when the field holds what it was given, its selection too.
 */
export function fieldChange(given: FieldState, state: FieldState): FieldChange | null {
  const was = given.value
  const now = state.value
  if (was === now && given.start === state.start && given.end === state.end) return null
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
