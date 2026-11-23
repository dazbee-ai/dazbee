// How each pass of a text paints its characters: the fill pass in their colour or their gradient,
// placed in the text layer's box; an outline pass over or under the letters with each outline's
// stroke; a lines pass for each gradient whose runs are underlined or struck through, as
// SkParagraph paints those lines in one colour only; and an image pass for each image fill, whose
// letters and lines are drawn opaque for a see-through image to fill, so a paragraph never holds an
// image: its characters are clear in the fill pass. The paragraph builder takes a piece's paint
// with its style, and the passes are laid out alike, so their glyphs fall on one another; a placed
// text's letters are drawn with the same paints (`passPaint`).
import type { CanvasKit, Image, Paint as CkPaint, ParagraphBuilder, TextStyle as CkTextStyle } from '@dazbee/canvaskit'
import {
  type GradientPaint,
  type Rect,
  shownGradient,
  shownImage,
  type TextImagePaint,
  type TextProps,
} from '@dazbee/schema'

import { color } from '../color.ts'
import { paintFor } from '../draw/paint.ts'

/**
 * Which pass a paragraph of a text draws: its fill; its outlines over the letters or under them;
 * the underline and strikethrough of the runs painted with one gradient, by its key (`gradientKey`),
 * which the drawing fills with that gradient; or the characters painted with one image, and their
 * lines, by its key (`imageKey`), which the drawing fills with that image.
 */
export type TextPass =
  | { kind: 'fill' }
  | { kind: 'outline'; under: boolean }
  | { kind: 'lines'; gradient: string }
  | { kind: 'image'; image: string }

type Style = Pick<TextProps['style'], 'color' | 'gradient' | 'image' | 'outline' | 'underline' | 'strikethrough'>

/** A gradient's key: equal for gradients that paint alike. */
export const gradientKey = (gradient: GradientPaint) => JSON.stringify(gradient)

/** An image fill's key: equal for image fills that paint alike. */
export const imageKey = (image: TextImagePaint) => JSON.stringify(image)

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

/** The image fills a text's characters are painted with, by key. */
export function paintedImages(styles: readonly Style[]): Map<string, TextImagePaint> {
  const painted = new Map<string, TextImagePaint>()
  for (const style of styles) {
    const image = shownImage(style)
    if (image) painted.set(imageKey(image), image)
  }
  return painted
}

/**
 * Whether a style's underline and strikethrough are drawn in this pass: in the fill pass when its
 * characters are coloured, in its gradient's lines pass when they are painted with one, in its
 * image's pass when they are painted with one, never in an outline pass.
 */
export function drawsLines(style: Style, pass: TextPass): boolean {
  if (pass.kind === 'image') return paintsWith(style, pass)
  if (shownImage(style)) return false
  const gradient = shownGradient(style)
  if (pass.kind === 'fill') return gradient === null
  return pass.kind === 'lines' && gradient !== null && gradientKey(gradient) === pass.gradient
}

/** The colour a style's lines are drawn in for this pass: opaque in a lines or image pass, which its paint fills. */
export function linesColour(style: Style, pass: TextPass): string {
  return pass.kind === 'lines' || pass.kind === 'image' ? '#000000FF' : style.color
}

/**
 * The paint a style's characters get in a pass: in the fill pass its gradient across the layer's
 * `box` where it has one, else its colour; in an outline pass the stroke of an outline drawn there,
 * an outline under the letters twice as wide; opaque in its image's pass; null where the pass draws
 * none of its characters (an outline pass without such an outline, a lines pass, the fill pass of
 * characters painted with an image, and another image's pass). The caller deletes it.
 */
export function passPaint(ck: CanvasKit, style: Style, pass: TextPass, box: Rect): CkPaint | null {
  if (pass.kind === 'lines') return null
  if (pass.kind === 'image') return paintsWith(style, pass) ? opaqueLetters(ck) : null
  if (pass.kind === 'fill' && shownImage(style)) return null
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
  if (pass.kind === 'fill' && !shownGradient(style) && !shownImage(style)) {
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

/** Whether a style's characters are painted with the image an image pass fills. */
function paintsWith(style: Style, pass: Extract<TextPass, { kind: 'image' }>): boolean {
  const image = shownImage(style)
  return image !== null && imageKey(image) === pass.image
}

/** Characters an image pass draws: opaque, for the image to fill. */
function opaqueLetters(ck: CanvasKit): CkPaint {
  const paint = new ck.Paint()
  paint.setAntiAlias(true)
  paint.setColor(ck.BLACK)
  return paint
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
