// Superscript and subscript (the `sups` and `subs` features): a piece keeps the feature where its
// font draws every letter and digit of it with its own superscript or subscript glyphs; otherwise it
// drops the feature and is drawn from the standard glyphs, at the font's superscript or subscript
// size and moved off the baseline by its offset (its OS/2 values).
// Each font of a piece decides for its own characters. The text drawn keeps its length, so offsets
// still match.
import type { CanvasKit, FontCollection, TextStyle as CkTextStyle } from '@dazbee/canvaskit'
import { letterSpacingPx, type TextProps } from '@dazbee/schema'

import { type FamilyFeatures, type FamilySuperSubs, superSubsOf } from './font-features.ts'
import type { StyledPiece } from './types.ts'

/**
 * A run of glyphs of one font, as shaping gives it: each glyph's id and, for each glyph and one past
 * the last, the UTF-8 offset in the text shaped where the glyph's cluster starts.
 */
export interface ShapedRun {
  glyphs: ArrayLike<number>
  offsets: ArrayLike<number>
}

/** The runs of `text` shaped in `style`, as drawing shapes it. */
export type Shape = (style: TextProps['style'], text: string) => ShapedRun[]

type Style = TextProps['style']
type SuperSubTag = 'sups' | 'subs'

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

/**
 * The pieces split where superscripts and subscripts are made up, each made-up stretch smaller and
 * with its baseline moved (`superSub`). Pieces side by side that differ only in paint are decided
 * together, so a letter and a mark on it go alike. `shape` shapes their text with and without the
 * feature: a font keeps the feature for its run of it where it drew each letter and digit of it with a
 * glyph of its own; where the run holds none, where it changed some glyph or, changing none, where
 * `familyFeatures` lists the feature for the family.
 */
export function madeUpSuperSubs(
  shown: string,
  pieces: readonly StyledPiece[],
  shape: Shape,
  superSubs: FamilySuperSubs | undefined,
  familyFeatures: FamilyFeatures | undefined,
): StyledPiece[] {
  const out: StyledPiece[] = []
  for (const group of shapedAlike(pieces)) {
    const [first] = group
    const tag = first && superSubTag(first.style)
    if (!first || !tag) {
      out.push(...group)
      continue
    }
    const start = first.start
    const text = shown.slice(start, group.at(-1)?.end ?? start)
    const hasFeature = familyFeatures?.get(first.style.fontFamily)?.has(tag) === true
    const madeUp = madeUpAt(text, shape(first.style, text), shape(withoutSuperSubs(first.style), text), hasFeature)
    for (const piece of group) {
      const small = madeUpPiece(piece, tag, superSubs)
      let from = piece.start
      for (let i = piece.start + 1; i <= piece.end; i++) {
        if (i < piece.end && madeUp[i - start] === madeUp[from - start]) continue
        out.push(madeUp[from - start] ? { ...small, start: from, end: i } : { ...piece, start: from, end: i })
        from = i
      }
    }
  }
  return out
}

/**
 * Shapes a text alone in a style, as drawing shapes it: in a paragraph of CanvasKit's in the text's
 * direction, its style from `ckStyle`, on one line per line break.
 */
export function paragraphShape(
  ck: CanvasKit,
  fonts: FontCollection,
  rtl: boolean,
  ckStyle: (style: Style) => CkTextStyle,
): Shape {
  return (style, text) => {
    const builder = ck.ParagraphBuilder.MakeFromFontCollection(
      new ck.ParagraphStyle({
        textDirection: rtl ? ck.TextDirection.RTL : ck.TextDirection.LTR,
        textStyle: ckStyle(style),
      }),
      fonts,
    )
    builder.addText(text)
    const paragraph = builder.build()
    builder.delete()
    paragraph.layout(Number.POSITIVE_INFINITY)
    const runs = paragraph
      .getShapedLines()
      .flatMap((line) => line.runs.map((run) => ({ glyphs: [...run.glyphs], offsets: [...run.offsets] })))
    paragraph.delete()
    return runs
  }
}

/**
 * The style a paragraph's lines keep, as tall as its letters would be at the size they stand in
 * for, where every piece of it is a made-up superscript or subscript: the style of the one standing
 * in for the largest size, at that size. Undefined where any piece is not, or there is none.
 */
export function superSubLineStyle(pieces: readonly StyledPiece[]): Style | undefined {
  let lines: Style | undefined
  for (const { style, superSub } of pieces) {
    if (!superSub) return undefined
    if (!lines || superSub.fontSize > lines.fontSize) lines = { ...style, fontSize: superSub.fontSize }
  }
  return lines
}

/** The style without superscript and subscript, as the standard glyphs are shaped and list markers drawn. */
export function withoutSuperSubs(style: Style): Style {
  const features = Object.fromEntries(Object.entries(style.features ?? {}).filter(([tag]) => !isSuperSubTag(tag)))
  return { ...style, features }
}

/** For each UTF-8 offset into `text`, and its end, the UTF-16 offset of the code point it falls in. */
export function utf16Offsets(text: string): number[] {
  const at: number[] = []
  let unit = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    const bytes = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4
    for (let b = 0; b < bytes; b++) at.push(unit)
    unit += ch.length
  }
  at.push(unit)
  return at
}

/**
 * The pieces in groups to decide together: side by side, raised or lowered alike, and shaped alike,
 * differing at most in paint. A piece neither raised nor lowered is a group of its own.
 */
function shapedAlike(pieces: readonly StyledPiece[]): StyledPiece[][] {
  const groups: StyledPiece[][] = []
  for (const piece of pieces) {
    const group = groups.at(-1)
    const last = group?.at(-1)
    const tag = superSubTag(piece.style)
    if (
      group &&
      last &&
      tag &&
      last.end === piece.start &&
      superSubTag(last.style) === tag &&
      shapeKey(last.style) === shapeKey(piece.style)
    )
      group.push(piece)
    else groups.push([piece])
  }
  return groups
}

/** What of a style its glyphs are shaped by. */
function shapeKey(style: Style): string {
  const { fontFamily, fontSize, fontWeight, fontStyle, letterSpacing, features } = style
  return JSON.stringify([fontFamily, fontSize, fontWeight, fontStyle, letterSpacing, features])
}

/** The feature a style draws its letters raised or lowered with, superscript first; null for neither. */
function superSubTag(style: Style): SuperSubTag | null {
  if (style.features?.sups === true) return 'sups'
  if (style.features?.subs === true) return 'subs'
  return null
}

/**
 * For each UTF-16 unit of `text`, whether it is made up: its run's font drew a letter or digit of
 * it as without the feature, or changed no glyph of a run with no letter or digit and lacks the
 * feature. Each cluster's first unit takes its run's answer, and every other unit the one before it,
 * so the rest of a cluster, and a line break no run draws, go with what precedes them.
 */
function madeUpAt(text: string, own: ShapedRun[], plain: ShapedRun[], hasFeature: boolean): boolean[] {
  const unitAt = utf16Offsets(text)
  const plainAt = new Map<number, string>()
  for (const run of plain) for (const [unit, ids] of clusters(run, unitAt)) plainAt.set(unit, ids)
  const at: (boolean | undefined)[] = Array.from({ length: text.length }, () => undefined)
  for (const run of own) {
    const starts = clusters(run, unitAt)
    let changed = false
    let lacking = false
    let letters = false
    for (const [unit, ids] of starts) {
      const same = plainAt.get(unit) === ids
      changed ||= !same
      if (LETTER_OR_DIGIT.test(String.fromCodePoint(text.codePointAt(unit) ?? 0))) {
        letters = true
        lacking ||= same
      }
    }
    const madeUp = lacking || (!changed && (letters || !hasFeature))
    for (const unit of starts.keys()) at[unit] = madeUp
  }
  let last = at.find((value) => value !== undefined) ?? true
  return at.map((value) => (last = value ?? last))
}

/** Each cluster of a run: the UTF-16 offset it starts at, and its glyph ids. */
function clusters(run: ShapedRun, unitAt: readonly number[]): Map<number, string> {
  const out = new Map<number, string>()
  for (let i = 0; i < run.glyphs.length; i++) {
    const unit = unitAt[run.offsets[i] ?? 0] ?? 0
    const had = out.get(unit)
    out.set(unit, had === undefined ? `${run.glyphs[i]}` : `${had},${run.glyphs[i]}`)
  }
  return out
}

/** A piece's made-up superscript or subscript: smaller, the full size's letter spacing kept, and its baseline moved. */
function madeUpPiece(piece: StyledPiece, tag: SuperSubTag, superSubs: FamilySuperSubs | undefined): StyledPiece {
  const { style } = piece
  const placements = superSubsOf(superSubs, style.fontFamily, style.fontWeight, style.fontStyle === 'italic')
  const { scale, shift } = tag === 'sups' ? placements.superscript : placements.subscript
  return {
    ...piece,
    style: {
      ...withoutSuperSubs(style),
      fontSize: style.fontSize * scale,
      letterSpacing: { unit: 'px', value: letterSpacingPx(style.letterSpacing, style.fontSize) },
    },
    superSub: { fontSize: style.fontSize, baselineShift: (tag === 'sups' ? -shift : shift) * style.fontSize },
  }
}

/** Whether a feature tag is superscript or subscript. */
function isSuperSubTag(tag: string): tag is SuperSubTag {
  return tag === 'sups' || tag === 'subs'
}
