// The box a text layer takes as it grows with its words (#47), as typing keeps it and as a tab's
// follow-ups bring it up to date after crossing edits (D6): one function, so a follow-up writes the
// box typing would.
import { bindProps, type Layer, type TextProps, type Variables } from '@dazbee/schema'

type Size = { width: number; height: number }

/** The point of a text's box that stays where it is as the box is fitted: its top left or its centre. */
export type KeptPoint = 'topLeft' | 'center'

/**
 * Measures a text layer as it would draw: with `width` null, its natural width (each paragraph
 * on one line) and the height that gives; otherwise its height when laid out `width` wide.
 */
export type MeasureText = (props: TextProps, width: number | null) => Size

/**
 * The box a text layer that grows with its words takes, measured as it is drawn, in the family the
 * brand kit's `variables` give a bound font: with auto width, both sides measured with no line
 * wrapped; with auto height, its width and the height at that width; a curved text, in any box
 * mode, the size of its curve. A straight text that still holds the box it had before its curve
 * (`straightBox`) takes it back: a fixed box its width and height, an auto height box its width.
 * Undefined for a straight text of a fixed box and for any other layer.
 */
export function fittedText(layer: Layer | undefined, measure: MeasureText, variables?: Variables): Size | undefined {
  if (layer?.type !== 'text' || !hasBoxToFit(layer.props)) return undefined
  const props = bindProps(layer.type, layer.props, layer.bindings, variables)
  const auto = props.boxMode === 'autoWidth' || props.curve !== undefined
  const straight = props.curve ? undefined : props.straightBox
  const width = straight && !auto ? straight.width * props.style.fontSize : props.width
  if (straight && props.boxMode === 'fixed') return { width, height: straight.height * props.style.fontSize }
  const size = measure(props, auto ? null : width)
  return { width: auto ? size.width : width, height: size.height }
}

/** Whether a text's box is fitted: it follows its words or its curve, or has its straight box to take back; not a straight fixed box. */
export function hasBoxToFit(props: TextProps): boolean {
  return props.boxMode !== 'fixed' || props.curve !== undefined || props.straightBox !== undefined
}

/**
 * The straight box a fit that `resizes` a text writes: its box before, in multiples of its font
 * size, when a curve resizes a fixed or auto height text that holds none; null, taking it off, once
 * the text is straight; undefined where it stays as it is.
 */
export function straightBoxOnFit(props: TextProps, resizes: boolean): Size | null | undefined {
  if (!props.curve) return props.straightBox ? null : undefined
  if (props.boxMode === 'autoWidth' || props.straightBox || !resizes) return undefined
  const em = props.style.fontSize
  return { width: props.width / em, height: props.height / em }
}

/** Whether a width or height set on a text holding `straightBox`, `curved` after the change, takes it off: it does on a straight text. */
export function sizeEndsStraightBox(straightBox: unknown, curved: boolean): boolean {
  return straightBox !== undefined && !curved
}
