// A text's sizes scaled: shrink to fit draws its style at a scale, a corner drag on the stage
// writes its sizes scaled by the box's factor, and a layer laid out to fit (commands/fit.ts) has
// its style's sizes scaled with its box.
import { type LetterSpacing, type TextProps, TILE_SCALE } from '@dazbee/schema'

import { round } from './geometry.ts'

/** What scaling a text changes; line height is a multiple of the size, so it stays. */
export type ScaledText = Pick<TextProps, 'style' | 'runs'> &
  Partial<Pick<TextProps, 'paragraphSpacing' | 'shrinkToFit'>>

type Style = TextProps['style']
type Run = TextProps['runs'][number]
/** The sizes a style may hold. */
type Sized = {
  fontSize?: number | undefined
  letterSpacing?: LetterSpacing | undefined
  outline?: Style['outline'] | undefined
}
/** The image a style may hold, whose tiles may have a size. */
type Tiled = { image?: { fit?: string | undefined; tileScale?: number | undefined } | undefined }

/**
 * Every size in a style scaled: its font size, letter spacing in pixels and outline width. Letter
 * spacing as a percentage of the font size follows that size as it is.
 */
export function scaled<T extends Sized>(style: T, scale: number, round: (n: number) => number = (n) => n): T {
  if (scale === 1) return style
  const out = { ...style }
  if (out.fontSize !== undefined) out.fontSize = round(out.fontSize * scale)
  if (out.letterSpacing?.unit === 'px')
    out.letterSpacing = { unit: 'px', value: round(out.letterSpacing.value * scale) }
  if (out.outline) out.outline = { ...out.outline, width: round(out.outline.width * scale) }
  return out
}

/**
 * A style's image that tiles at a tile scale, its tiles scaled by `factor` to hundredths, inside
 * `TILE_SCALE`, as a shape's tiled fill is; the same style for any other.
 */
export function scaledTiles<T extends Tiled>(style: T, factor: number): T {
  const { image } = style
  if (factor === 1 || image?.fit !== 'tile' || image.tileScale === undefined) return style
  const tileScale = Math.min(TILE_SCALE.max, Math.max(TILE_SCALE.min, round(image.tileScale * factor)))
  return { ...style, image: { ...image, tileScale } }
}

/**
 * A text's sizes scaled by `factor`, as a corner drag scales them: the style's and each run's,
 * paragraph spacing and shrink to fit's smallest and largest sizes, each to the nearest 0.1, and
 * its tiled images' tiles (`scaledTiles`).
 */
export function scaleText(props: ScaledText, factor: number): ScaledText {
  const out: ScaledText = {
    style: scaledTiles(scaled(props.style, factor, tenth), factor),
    runs: props.runs.map((run): Run => ({ ...run, style: scaledTiles(scaled(run.style, factor, tenth), factor) })),
  }
  if (props.paragraphSpacing !== undefined) out.paragraphSpacing = tenth(props.paragraphSpacing * factor)
  if (props.shrinkToFit)
    out.shrinkToFit = { min: tenth(props.shrinkToFit.min * factor), max: tenth(props.shrinkToFit.max * factor) }
  return out
}

/** The smallest font size the text has anywhere: its own, a run's, or shrink to fit's smallest. */
export function smallestSize(props: ScaledText): number {
  return Math.min(
    props.style.fontSize,
    ...props.runs.flatMap((run) => (run.style.fontSize === undefined ? [] : [run.style.fontSize])),
    props.shrinkToFit?.min ?? Infinity,
  )
}

function tenth(n: number) {
  return Math.round(n * 10) / 10
}
