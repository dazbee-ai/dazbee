// A text's sizes scaled: shrink to fit draws its style at a scale, a corner drag on the stage
// writes its sizes scaled by the box's factor, and a layer laid out to fit (commands/fit.ts) has
// its style's sizes scaled with its box.
import type { LetterSpacing, TextProps } from '@dazbee/schema'

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
 * A text's sizes scaled by `factor`, as a corner drag scales them: the style's and each run's,
 * paragraph spacing and shrink to fit's smallest and largest sizes, each to the nearest 0.1.
 */
export function scaleText(props: ScaledText, factor: number): ScaledText {
  const out: ScaledText = {
    style: scaled(props.style, factor, tenth),
    runs: props.runs.map((run): Run => ({ ...run, style: scaled(run.style, factor, tenth) })),
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
