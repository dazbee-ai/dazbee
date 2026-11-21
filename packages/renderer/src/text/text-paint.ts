// How each pass of a text paints its characters: the fill pass in their colour or their gradient,
// placed in the text layer's box; an outline pass over or under the letters with each outline's
// stroke; and a lines pass for each gradient whose runs are underlined or struck through, as
// SkParagraph paints those lines in one colour only. The paragraph builder takes a piece's paint
// with its style, and the passes are laid out alike, so their glyphs fall on one another.
import type { CanvasKit, Image, Paint as CkPaint, ParagraphBuilder, TextStyle as CkTextStyle } from '@dazbee/canvaskit'
import type { GradientPaint, Rect, TextProps } from '@dazbee/schema'

import { color } from '../color.ts'
import { paintFor } from '../draw/paint.ts'

/**
 * Which pass a paragraph of a text draws: its fill; its outlines over the letters or under them; or
 * the underline and strikethrough of the runs painted with one gradient, by its key (`gradientKey`),
 * which the drawing fills with that gradient.
 */
export type TextPass = { kind: 'fill' } | { kind: 'outline'; under: boolean } | { kind: 'lines'; gradient: string }

type Style = Pick<TextProps['style'], 'color' | 'gradient' | 'outline' | 'underline' | 'strikethrough'>

/** What a gradient is drawn with: it reads no image. */
const NO_IMAGES: ReadonlyMap<string, Image> = new Map()

/** The gradient a style paints its characters with: its own, while it shows; null without one. */
export function shownGradient(style: Pick<Style, 'gradient'>): GradientPaint | null {
  return style.gradient && style.gradient.visible !== false ? style.gradient : null
}

/** A gradient's key: equal for gradients that paint alike. */
export const gradientKey = (gradient: GradientPaint) => JSON.stringify(gradient)

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
 * Pushes one piece's style onto the builder, painted for the pass: in the fill pass in its gradient
 * across the layer's `box` where it has one, else in its colour; in an outline pass with the stroke
 * of an outline drawn there, an outline under the letters twice as wide; in a lines pass with its
 * characters clear. The caller pops it.
 */
export function pushPainted(
  ck: CanvasKit,
  builder: ParagraphBuilder,
  ckStyle: CkTextStyle,
  style: Style,
  pass: TextPass,
  box: Rect,
) {
  const gradient = shownGradient(style)
  if (pass.kind === 'fill' && !gradient) {
    builder.pushStyle(ckStyle)
    return
  }
  const clear = new ck.Paint()
  clear.setColor(ck.TRANSPARENT)
  const front =
    (pass.kind === 'fill' && gradient && paintFor(ck, gradient, box, { images: NO_IMAGES })) || new ck.Paint()
  front.setAntiAlias(true)
  if (pass.kind === 'outline') strokeFor(ck, front, style, pass.under)
  else if (pass.kind === 'lines') front.setColor(ck.TRANSPARENT)
  builder.pushPaintStyle(ckStyle, front, clear)
  front.delete()
  clear.delete()
}

/** Makes `paint` the stroke of the style's outline when it is drawn in this outline pass, else clear. */
function strokeFor(ck: CanvasKit, paint: CkPaint, style: Style, under: boolean) {
  const { outline } = style
  if (!outline || outline.width <= 0 || (outline.under ?? false) !== under) {
    paint.setColor(ck.TRANSPARENT)
    return
  }
  paint.setStyle(ck.PaintStyle.Stroke)
  paint.setStrokeWidth(under ? outline.width * 2 : outline.width)
  paint.setStrokeJoin(ck.StrokeJoin.Round)
  paint.setColor(color(ck, outline.color))
}
