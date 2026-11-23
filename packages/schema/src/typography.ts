// A text's typographic settings: the fields of its character style, letter spacing in pixels or as
// a share of the font size, and the OpenType features turned on or off; with how a run's style sits
// over the base style.
import { z } from 'zod'

import { GradientPaint, TextImagePaint } from './paint.ts'
import { Color } from './primitives.ts'

/** A style's paint: its colour, or a gradient or an image over it. */
type Painted = {
  color?: string | undefined
  gradient?: GradientPaint | undefined
  image?: TextImagePaint | undefined
}

/** An OpenType feature tag: four printable ASCII characters, such as `liga`. */
const FEATURE_TAG = /^[\x20-\x7E]{4}$/

/**
 * The room added after each character: in pixels, or as a percentage of the font size it is set
 * at, which grows and shrinks with that size.
 */
export const LetterSpacing = z.object({
  unit: z.enum(['px', 'percent']),
  value: z.number(),
})
export type LetterSpacing = z.infer<typeof LetterSpacing>

/** OpenType features by tag, each turned on (true) or off (false); a tag left out is as the font has it. */
export const Features = z.record(
  z.string().regex(FEATURE_TAG, 'a feature tag is four printable ASCII characters'),
  z.boolean(),
)
export type Features = z.infer<typeof Features>

/** Letter spacing of none, as a percentage so it follows the size: what a text without its own has. */
export const NO_LETTER_SPACING: LetterSpacing = { unit: 'percent', value: 0 }

/** The most characters are raised or lowered, as a percentage of the font size they are set at. */
export const RAISE_MOST = 100

/** The fields of a text's character style, as the base style and a run's style take them. */
export const textStyleFields = {
  fontFamily: z.string().min(1),
  fontWeight: z.number().int().min(100).max(900),
  fontStyle: z.enum(['normal', 'italic']),
  fontSize: z.number().positive(),
  color: Color,
  /** The room after each character: pixels, or a percentage of the font size the characters are set at. */
  letterSpacing: LetterSpacing,
  /** A multiple of the font size; omitted means the font's own line height. */
  lineHeight: z.number().positive(),
  underline: z.boolean(),
  strikethrough: z.boolean(),
  /** Drawn in another case, as CSS text-transform does; the text itself is kept as typed. */
  textCase: z.enum(['none', 'upper', 'lower', 'title']),
  /**
   * A line along the glyphs' edges: centred on them and drawn over the fill, or with `under` drawn
   * under it at twice its width, so it reaches `width` past the letters and leaves their shape whole.
   * Width 0 is none.
   */
  outline: z.object({ width: z.number().min(0), color: Color, under: z.boolean().optional() }),
  /** OpenType features turned on or off by tag; a run's set theirs over the base style's, tag by tag. */
  features: Features,
  /**
   * A gradient the characters are painted with in place of `color`, placed in the text layer's box,
   * so a run's is the part of the box's gradient its characters cover. A hidden one shows the colour.
   */
  gradient: GradientPaint,
  /**
   * An image the characters are painted with in place of `color`, placed in the text layer's box to
   * fill it, fit inside it or tile it, so a run's is the part of the box's image its characters
   * cover. A style holds a gradient or an image, never both. A hidden one shows the colour.
   */
  image: TextImagePaint,
  /**
   * Each letter's own turn, in degrees clockwise about the middle of its advance on its baseline,
   * which moves the text's letters one by one (ADR-0021); 0 or left out is none.
   */
  turn: z.number().min(-180).max(180),
  /**
   * How far the characters are raised off their line's baseline, as a percentage of the font size
   * they are set at, up positive and down negative, over a superscript's or subscript's own move;
   * 0 or left out is none.
   */
  raise: z.number().min(-RAISE_MOST).max(RAISE_MOST),
}

/** Letter spacing in pixels at `fontSize`, the size the characters are set at. */
export function letterSpacingPx(spacing: LetterSpacing, fontSize: number): number {
  return spacing.unit === 'px' ? spacing.value : (fontSize * spacing.value) / 100
}

/** The gradient a style paints its characters with: its own while it shows; null without one. */
export function shownGradient(style: { readonly gradient?: GradientPaint | undefined }): GradientPaint | null {
  return style.gradient && style.gradient.visible !== false ? style.gradient : null
}

/** The image a style paints its characters with: its own while it shows; null without one. */
export function shownImage(style: { readonly image?: TextImagePaint | undefined }): TextImagePaint | null {
  return style.image && style.image.visible !== false ? style.image : null
}

/** A style painted in a colour: its gradient and image taken off, so the colour shows. */
export function inColour<T extends Painted>(style: T, color: string): T {
  const out = { ...style, color }
  delete out.gradient
  delete out.image
  return out
}

/**
 * A style with a run's style over it: each key the run sets replaces the style's, except its
 * features, which it sets tag by tag over the style's, and its colour, gradient and image, which are
 * one paint: a run that sets one of them takes the style's others off, so it shows.
 */
export function withRunStyle<T extends Painted & { features?: Features | undefined }>(
  style: T,
  run: { readonly [K in keyof T]?: T[K] | undefined },
): T {
  const out = { ...style, ...run }
  if (style.features && run.features) out.features = { ...style.features, ...run.features }
  if (run.image !== undefined) delete out.gradient
  else if (run.gradient !== undefined) delete out.image
  else if (run.color !== undefined) {
    delete out.gradient
    delete out.image
  }
  return out
}
