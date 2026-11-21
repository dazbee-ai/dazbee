// What the stage field is given to hold for the text being edited, and what the browser changed in
// it read as one edit, by comparing what the field holds with what it was given: an edit of the
// text, or while an input method composes, a composition.
import { type DesignStore, splitsPair, type TextAnchor } from '@dazbee/doc'

import { paragraphsOf } from '../pasted-text.ts'
import type { Composing, Composition } from './composition.ts'
import { graphemeEdge, type TextRange } from './text-edit.ts'

/**
 * What the stage field holds: its value, and its selection's start and end, which meet at a caret;
 * `backward` when the selection runs back from its end, its caret at its start.
 */
export interface FieldState {
  value: string
  start: number
  end: number
  backward?: boolean
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

/**
 * What the stage field was given, and its selection's two ends anchored in the text. Once the text's
 * selection moves and the field is not yet told, the ends stand at the text's selection, so what the
 * field changes at its own lands there, and `kept` is what it keeps holding once told, with its
 * selection at those ends; none when it must be given new text.
 */
export interface HeldField {
  given: FieldState
  start: TextAnchor
  end: TextAnchor
  kept?: FieldState | undefined
}

/**
 * A change the field made as an edit of the text: the range it replaces, the change itself, its text
 * with line breaks as paragraphs as it is written, and the field's selection in the text once it is,
 * `backward` when it runs back from its end.
 */
export interface FieldEdit {
  range: TextRange
  change: FieldChange
  typed: string
  selection: TextRange
  backward: boolean
}

/** A composition held while typing (`Composing`), with `span`, the range it replaces in what the field was given. */
export type HeldComposition = Composing & { span: TextRange }

/** What the field's reading asks of the store: anchors in a text, and where they are now. */
type Anchors = Pick<DesignStore, 'textAnchor' | 'anchorOffset'>

/** The longest selected range the field holds, in UTF-16 units; a longer one is held as nothing. */
const FIELD_MOST = 4_000
/** How much of the text on each side of the selected range the field holds at most, in UTF-16 units. */
const AROUND_MOST = 1_000
/** How near an edge of what the field holds its selection comes, in UTF-16 units, before it is given new text. */
const EDGE_LEAST = 100

/**
 * What the field holds for a text and its selected range: the range, selected, with up to 1,000
 * UTF-16 units of the text on each side of it, cut at grapheme edges; nothing for a range over
 * 4,000 units. `backward` says the range runs back from its end.
 */
export function fieldText(text: string, range: TextRange, backward = false): FieldState {
  if (range.end - range.start > FIELD_MOST) return { value: '', start: 0, end: 0 }
  const from = graphemeEdge(text, range.start - AROUND_MOST, true)
  const to = graphemeEdge(text, range.end + AROUND_MOST, false)
  const held = { value: text.slice(from, to), start: range.start - from, end: range.end - from }
  return backward ? { ...held, backward } : held
}

/**
 * What the field holding `held` keeps holding for the text's selected range `range`: the same value,
 * its selection at the range. `ends` are where `held`'s selection's two ends are in `text` now.
 * Null when it must be given new text: what it holds no longer matches the text at its place, the
 * range lies outside it or over 4,000 units, or an end of the range is within 100 units of an edge
 * of what it holds that is not the text's own start or end.
 */
export function keptField(
  text: string,
  held: FieldState,
  ends: TextRange,
  range: TextRange,
  backward = false,
): FieldState | null {
  const { value } = held
  const from = ends.start - held.start
  const to = ends.end + value.length - held.end
  const matches =
    from >= 0 &&
    to <= text.length &&
    text.slice(from, ends.start) === value.slice(0, held.start) &&
    text.slice(ends.start, ends.end) === value.slice(held.start, held.end) &&
    text.slice(ends.end, to) === value.slice(held.end)
  if (!matches || range.end - range.start > FIELD_MOST || range.start < from || range.end > to) return null
  if ((from > 0 && range.start - from < EDGE_LEAST) || (to < text.length && to - range.end < EDGE_LEAST)) return null
  const kept = { value, start: range.start - from, end: range.end - from }
  return backward ? { ...kept, backward } : kept
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
 * The field once it is told of the selected range of text `id` holding `text`: what `held` holds
 * kept, its selection at the range, or else the text around the range (`fieldText`).
 */
export function toldField(
  store: Anchors,
  id: string,
  held: HeldField | undefined,
  text: string,
  range: TextRange,
  backward: boolean,
): HeldField {
  const given = (held && keptHeld(store, held, text, range, backward)) ?? fieldText(text, range, backward)
  return heldField(store, id, given, range)
}

/**
 * The field once the selected range of text `id` holding `text` moves and the field is not yet
 * told: its selection's ends at the range, so what it changes at its own lands there, with what it
 * keeps holding once told.
 */
export function followedField(
  store: Anchors,
  id: string,
  held: HeldField,
  text: string,
  range: TextRange,
  backward: boolean,
): HeldField {
  return { ...heldField(store, id, held.given, range), kept: keptHeld(store, held, text, range, backward) ?? undefined }
}

/**
 * What the field holding `state` changed of what it was given: what no longer stands between the
 * longest common start and end of the two values, the start taken no further than the given
 * selection's start and the end no further back than its end, so the change sits where the caret
 * was, and covering `cover` of the given value when there is one; an empty change at the selection's
 * start when only the selection moved, or turned round. Null when the field holds what it was
 * given, its selection too, and there is nothing to cover.
 */
export function fieldChange(given: FieldState, state: FieldState, cover?: TextRange): FieldChange | null {
  const was = given.value
  const now = state.value
  if (was === now && !cover) {
    const turned = given.start < given.end && !given.backward !== !state.backward
    if (given.start === state.start && given.end === state.end && !turned) return null
    // Only the selection moved: nothing is replaced.
    return { start: given.start, end: given.start, text: '', caret: state.end }
  }
  // The common start stops at the given selection's start, and the common end at its end, or at
  // the range to cover's.
  const before = Math.min(was.length, now.length, given.start, cover?.start ?? given.start)
  let start = 0
  while (start < before && was.charCodeAt(start) === now.charCodeAt(start)) start++
  const after = Math.min(was.length - Math.max(given.end, cover?.end ?? given.end), now.length - start)
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
 * counts back from its start, one after it on from its end. With an input method's `data`, the
 * change covers all of it where the field holds it around its caret and it holds the change: the
 * whole of a word a phone keyboard re-opened. Null when nothing changed.
 */
export function fieldEdit(
  given: FieldState,
  ends: TextRange,
  state: FieldState,
  length: number,
  data?: string,
): FieldEdit | null {
  const plain = fieldChange(given, state)
  const cover = data ? dataCover(plain, state, data) : null
  const change = cover ? fieldChange(given, state, cover) : plain
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
  const selection = { start: written(state.start), end: written(state.end) }
  return { range, change, typed, selection, backward: !!state.backward && selection.end > selection.start }
}

/**
 * The change the field holding `state` made to what `held` was given, in a text `length` long, with
 * an input method's `data` (`fieldEdit`): read through the two ends of the composition when there is
 * one, as it is through the selection's, so another tab's edit inside what the field holds never
 * moves it. Null when nothing changed, or an end is gone.
 */
export function readField(
  store: Anchors,
  held: HeldField,
  composing: HeldComposition | undefined,
  state: FieldState,
  length: number,
  data?: string,
): FieldEdit | null {
  const ends = composing ? anchored(store, composing.start, composing.end) : anchored(store, held.start, held.end)
  const given = composing ? { value: held.given.value, ...composing.span } : held.given
  return ends && fieldEdit(given, ends, state, length, data)
}

/**
 * Whether a composition's commit read as `edit` cancelled it: it puts nothing in place of the
 * selected range the field was given, or changes nothing. One that deletes a word re-opened at a
 * caret deletes it.
 */
export function cancels(given: FieldState, { change }: FieldEdit): boolean {
  const inRange = given.start <= change.start && change.end <= given.end
  return change.text === '' && (change.start === change.end || inRange)
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

/**
 * The composition a change made while an input method composes (`compositionOf`), held in text
 * `id` while typing: the range it replaces as two ends anchored there, the end staying before what
 * another tab types right after it, and as its span in what the field was given.
 */
export function heldComposition(store: Anchors, id: string, edit: FieldEdit, data: string): HeldComposition {
  const { range, ...made } = compositionOf(edit, data)
  const span = { start: edit.change.start, end: edit.change.end }
  return { ...made, span, start: store.textAnchor(id, range.start), end: store.textAnchor(id, range.end, true) }
}

/** Whether the field holding `state` holds an input method's `data` around its caret: a word it re-opened there. */
export function holdsAround(state: FieldState, data: string): boolean {
  return data !== '' && dataCover(null, state, data) !== null
}

/**
 * Where `data` stands in what the field holds around its caret, holding all the change makes, as a
 * range of the value it was given: the occurrence ending nearest the caret. Null when there is none.
 */
function dataCover(change: FieldChange | null, state: FieldState, data: string): TextRange | null {
  const now = state.value
  const from = change ? change.start : state.end
  const to = change ? change.start + change.text.length : state.end
  let found: number | null = null
  for (let at = now.indexOf(data); at >= 0 && at <= from; at = now.indexOf(data, at + 1)) {
    const end = at + data.length
    const holds = end >= to && at <= state.end && state.end <= end
    if (holds && (found === null || Math.abs(end - state.end) < Math.abs(found + data.length - state.end))) found = at
  }
  if (found === null) return null
  const grown = found + data.length - to
  return { start: found, end: (change ? change.end : to) + grown }
}

/** What the field holding `held` keeps for the selected range of `text`, as `keptField` keeps it; null when it must be given new text. */
function keptHeld(store: Anchors, held: HeldField, text: string, range: TextRange, backward: boolean) {
  const ends = anchored(store, held.start, held.end)
  return ends && keptField(text, held.kept ?? held.given, ends, range, backward)
}

/** The range between two anchors in a text; null once either is gone. */
function anchored(store: Anchors, start: TextAnchor, end: TextAnchor): TextRange | null {
  const from = store.anchorOffset(start)
  const to = store.anchorOffset(end)
  return from === null || to === null ? null : { start: from, end: Math.max(from, to) }
}
