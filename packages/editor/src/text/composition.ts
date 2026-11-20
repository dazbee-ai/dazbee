// What a composition computes: the text layer as it is drawn while an input method composes in it,
// with the composed text in place of the range it replaces, the edits its commit writes, and where
// the part being composed and the input method's cursor are in the composed text.
import { applyTextOp, fittedText, type MeasureText, replaceRangeOps, round, type TextOp } from '@dazbee/doc'
import type { Layer, Variables } from '@dazbee/schema'

import { paragraphsOf } from '../pasted-text.ts'
import type { TextRange } from './text-edit.ts'

/** A composition in a text: the range it replaces, the text it puts there, the part being composed and the cursor in it. */
export interface Composition {
  range: TextRange
  text: string
  /** The part of `text` the input method composes now, which is underlined. */
  part: TextRange
  /** The input method's cursor in `text`. */
  cursor: number
}

/** A text layer as a composition draws it, and what its commit writes. */
export interface Composed {
  /** The layer with the commit applied, its box fitted to its words when it grows with them. */
  layer: Layer
  /** The edits the commit writes, in order. */
  ops: TextOp[]
  /** The part being composed, in the composed layer's text. */
  part: TextRange
  /** The input method's cursor, in the composed layer's text. */
  cursor: number
}

/**
 * A text layer as it is drawn while `composition` is composed in it: the text edits its commit
 * writes (`replaceRangeOps`, line breaks as paragraphs) applied to it, so the composed text takes the
 * run of the first character it replaces, and a text that grows with its words fitted to them as
 * `text.fit` keeps it. Null for a layer that is not a text.
 */
export function composedText(
  layer: Layer,
  { range, text, part, cursor }: Composition,
  measure: MeasureText,
  variables?: Variables,
): Composed | null {
  if (layer.type !== 'text') return null
  const { props } = layer
  const start = Math.min(range.start, props.text.length)
  const end = Math.min(Math.max(range.end, start), props.text.length)
  // Each piece is made paragraphs on its own, so the offsets inside the text still match.
  const typed = (to: number) => start + paragraphsOf(text.slice(0, to)).length
  const inserted = paragraphsOf(text)
  const ops = replaceRangeOps(props.text, start, end, inserted)
  const value = ops.reduce(applyTextOp, { text: props.text, runs: props.runs })
  const edited: Layer = { ...layer, props: { ...props, text: value.text, runs: value.runs } }
  const size = fittedText(edited, measure, variables)
  const composed: Layer = size
    ? { ...edited, props: { ...edited.props, width: round(size.width), height: round(size.height) } }
    : edited
  return {
    layer: composed,
    ops,
    part: { start: typed(part.start), end: typed(part.end) },
    cursor: typed(cursor),
  }
}
