// Superscript and subscript (the `sups` and `subs` features): a piece keeps the feature where its
// font draws every letter and digit of it with its own superscript or subscript glyphs; otherwise it
// drops the feature and is drawn from the standard glyphs, at the font's superscript or subscript
// size and moved off the baseline by its offset (its OS/2 values), as FigCraft and Figma draw it.
// Each font of a piece decides for its own characters. The text drawn keeps its length, so offsets
// still match.
import type { CanvasKit, FontCollection, TextStyle as CkTextStyle } from '@dazbee/canvaskit'
import { letterSpacingPx, type TextProps } from '@dazbee/schema'

import { type FamilyFeatures, type FamilyScripts, scriptsOf } from './font-features.ts'
import type { StyledPiece } from './small-caps.ts'

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
type ScriptTag = 'sups' | 'subs'

const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u

/**
 * The pieces split where superscripts and subscripts are made up, each made-up stretch smaller and
 * with its baseline moved (`script`). `shape` shapes a piece's text with and without its feature: a
 * font keeps the feature for its run of the piece where it drew each letter and digit of it with a
 * glyph of its own; where the run holds none, where it changed some glyph or, changing none, where
 * `familyFeatures` lists the feature for the piece's family.
 */
export function madeUpScripts(
  shown: string,
  pieces: readonly StyledPiece[],
  shape: Shape,
  scripts: FamilyScripts | undefined,
  familyFeatures: FamilyFeatures | undefined,
): StyledPiece[] {
  const out: StyledPiece[] = []
  for (const piece of pieces) {
    const tag = scriptTag(piece.style)
    if (!tag) {
      out.push(piece)
      continue
    }
    const text = shown.slice(piece.start, piece.end)
    const hasFeature = familyFeatures?.get(piece.style.fontFamily)?.has(tag) === true
    const madeUp = madeUpAt(text, shape(piece.style, text), shape(withoutScripts(piece.style), text), hasFeature)
    const small = madeUpPiece(piece, tag, scripts)
    let from = 0
    for (let i = 1; i <= text.length; i++) {
      if (i < text.length && madeUp[i] === madeUp[from]) continue
      const start = piece.start + from
      const end = piece.start + i
      out.push(madeUp[from] ? { ...small, start, end } : { ...piece, start, end })
      from = i
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
 * in for the largest size, at that size. Null where any piece is not.
 */
export function scriptLineStyle(pieces: readonly StyledPiece[]): Style | null {
  let lines: Style | null = null
  for (const { style, script } of pieces) {
    if (!script) return null
    if (!lines || script.fontSize > lines.fontSize) lines = { ...style, fontSize: script.fontSize }
  }
  return lines
}

/** The feature a style draws its letters raised or lowered with, superscript first; null for neither. */
function scriptTag(style: Style): ScriptTag | null {
  if (style.features?.sups === true) return 'sups'
  if (style.features?.subs === true) return 'subs'
  return null
}

/**
 * For each UTF-16 unit of `text`, whether it is made up: its run's font drew a letter or digit of
 * it as without the feature, or changed no glyph of a run with no letter or digit and lacks the
 * feature. A unit no run draws, such as a line break, goes with the one before it.
 */
function madeUpAt(text: string, own: ShapedRun[], plain: ShapedRun[], hasFeature: boolean): boolean[] {
  const unitAt = utf16Offsets(text)
  const plainAt = new Map<number, string>()
  for (const run of plain) for (const [unit, ids] of clusters(run, unitAt)) plainAt.set(unit, ids)
  const at: (boolean | undefined)[] = Array.from({ length: text.length }, () => undefined)
  for (const run of own) {
    let changed = false
    let lacking = false
    let letters = false
    for (const [unit, ids] of clusters(run, unitAt)) {
      const same = plainAt.get(unit) === ids
      changed ||= !same
      if (LETTER_OR_DIGIT.test(String.fromCodePoint(text.codePointAt(unit) ?? 0))) {
        letters = true
        lacking ||= same
      }
    }
    const madeUp = lacking || (!changed && (letters || !hasFeature))
    const ends = Array.from(run.offsets, (offset) => unitAt[offset] ?? text.length)
    for (let i = Math.min(...ends); i < Math.max(...ends); i++) at[i] = madeUp
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

/** For each UTF-8 offset into `text`, and its end, the UTF-16 offset of the code point it falls in. */
function utf16Offsets(text: string): number[] {
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

/** The style without superscript and subscript, as the standard glyphs are shaped. */
function withoutScripts(style: Style): Style {
  const features = Object.fromEntries(Object.entries(style.features ?? {}).filter(([tag]) => !isScriptTag(tag)))
  return { ...style, features }
}

/** A piece's made-up superscript or subscript: smaller, the full size's letter spacing kept, and its baseline moved. */
function madeUpPiece(piece: StyledPiece, tag: ScriptTag, scripts: FamilyScripts | undefined): StyledPiece {
  const { style } = piece
  const placements = scriptsOf(scripts, style.fontFamily, style.fontWeight, style.fontStyle === 'italic')
  const { scale, shift } = tag === 'sups' ? placements.superscript : placements.subscript
  return {
    ...piece,
    style: {
      ...withoutScripts(style),
      fontSize: style.fontSize * scale,
      letterSpacing: { unit: 'px', value: letterSpacingPx(style.letterSpacing, style.fontSize) },
    },
    script: { fontSize: style.fontSize, baselineShift: (tag === 'sups' ? -shift : shift) * style.fontSize },
  }
}

/** Whether a feature tag is superscript or subscript. */
function isScriptTag(tag: string): tag is ScriptTag {
  return tag === 'sups' || tag === 'subs'
}

