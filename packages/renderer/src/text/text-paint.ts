// How each pass of a text paints its characters: the fill pass in their colour or their gradient,
// placed in the text layer's box; an outline pass over or under the letters with each outline's
// stroke; and a lines pass for each gradient whose runs are underlined or struck through, as
// SkParagraph paints those lines in one colour only. The paragraph builder takes a piece's paint
// with its style, and the passes are laid out alike, so their glyphs fall on one another; a placed
// text's letters are drawn with the same paints (`passPaint`).
import type { CanvasKit, Image, Paint as CkPaint, ParagraphBuilder, TextStyle as CkTextStyle } from '@dazbee/canvaskit'
import { type GradientPaint, type Rect, shownGradient, type TextProps } from '@dazbee/schema'

import { color } from '../color.ts'
import { paintFor } from '../draw/paint.ts'

/**
 * Which pass a paragraph of a text draws: its fill; its outlines over the letters or under them; or
 * the underline and strikethrough of the runs painted with one gradient, by its key (`gradientKey`),
 * which the drawing fills with that gradient.
 */
export type TextPass = { kind: 'fill' } | { kind: 'outline'; under: boolean } | { kind: 'lines'; gradient: string }

type Style = Pick<TextProps['style'], 'color' | 'gradient' | 'outline' | 'underline' | 'strikethrough'>

/** A gradient's key: equal for gradients that paint alike. */
export const gradientKey = (gradient: GradientPaint) => JSON.stringify(gradient)

/** What a gradient is drawn with: it reads no image. */
const NO_IMAGES: ReadonlyMap<string, Image> = new Map()

/** The gradients whose characters have an underline or strikethrough, which a lines pass each paints, by key. */
export function linedGradients(styles: readonly Style[]): Map<string, GradientPaint> {
  const lined = new Map<string, GradientPaint>()
  for (const style of styles) {
    const gradient = shownGradient(style)
    if (gradient && (style.underline || style.strikethrough)) lined.set(gradientKey(gradient), gradient)
  }
  return lined
}

/**
 * Whether a style's underline and strikethrough are drawn in this pass: in the fill pass when its
 * characters are coloured, in its gradient's lines pass when they are painted with one, never in an
 * outline pass.
 */
export function drawsLines(style: Style, pass: TextPass): boolean {
  const gradient = shownGradient(style)
  if (pass.kind === 'fill') return gradient === null
  return pass.kind === 'lines' && gradient !== null && gradientKey(gradient) === pass.gradient
}

/** The colour a style's lines are drawn in for this pass: opaque in a lines pass, which its gradient fills. */
export function linesColour(style: Style, pass: TextPass): string {
  return pass.kind === 'lines' ? '#000000FF' : style.color
}

/**
 * The paint a style's characters get in a pass: in the fill pass its gradient across the layer's
 * `box` where it has one, else its colour; in an outline pass the stroke of an outline drawn there,
 * an outline under the letters twice as wide; null where the pass draws none of its characters (an
 * outline pass without such an outline, and a lines pass). The caller deletes it.
 */
export function passPaint(ck: CanvasKit, style: Style, pass: TextPass, box: Rect): CkPaint | null {
  if (pass.kind === 'lines') return null
  if (pass.kind === 'outline') {
    const { outline } = style
    if (!outline || outline.width <= 0 || (outline.under ?? false) !== pass.under) return null
  }
  const gradient = shownGradient(style)
  const paint =
    (pass.kind === 'fill' && gradient && paintFor(ck, gradient, box, { images: NO_IMAGES })) || new ck.Paint()
  paint.setAntiAlias(true)
  if (pass.kind === 'outline') strokeFor(ck, paint, style, pass.under)
  else if (!gradient) paint.setColor(color(ck, style.color))
  return paint
}

/**
 * Pushes one piece's style onto the builder, its characters painted for the pass (`passPaint`): a
 * coloured fill pass with the style alone, and clear in a pass that draws none of them. The caller
 * pops it.
 */
export function pushPainted(
  ck: CanvasKit,
  builder: ParagraphBuilder,
  ckStyle: CkTextStyle,
  style: Style,
  pass: TextPass,
  box: Rect,
) {
  if (pass.kind === 'fill' && !shownGradient(style)) {
    builder.pushStyle(ckStyle)
    return
  }
  const clear = new ck.Paint()
  clear.setColor(ck.TRANSPARENT)
  const characters = passPaint(ck, style, pass, box) ?? clearCharacters(ck)
  builder.pushPaintStyle(ckStyle, characters, clear)
  characters.delete()
  clear.delete()
}

/** Makes `paint` the stroke of the style's outline, drawn over the letters or under them. */
function strokeFor(ck: CanvasKit, paint: CkPaint, style: Style, under: boolean) {
  const width = style.outline?.width ?? 0
  paint.setStyle(ck.PaintStyle.Stroke)
  paint.setStrokeWidth(under ? width * 2 : width)
  paint.setStrokeJoin(ck.StrokeJoin.Round)
  paint.setColor(color(ck, style.outline?.color ?? style.color))
}

/** Characters a pass doesn't draw: clear. */
function clearCharacters(ck: CanvasKit): CkPaint {
  const paint = new ck.Paint()
  paint.setAntiAlias(true)
  paint.setColor(ck.TRANSPARENT)
  return paint
}
