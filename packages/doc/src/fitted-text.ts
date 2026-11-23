// The box a text layer takes as it grows with its words (#47), as typing keeps it and as a tab's
// follow-ups bring it up to date after crossing edits (D6): one function, so a follow-up writes the
// box typing would.
import { bindProps, type Layer, type TextProps, type Variables } from '@dazbee/schema'

type Size = { width: number; height: number }

/**
 * Measures a text layer as it would draw: with `width` null, its natural width (each paragraph
 * on one line) and the height that gives; otherwise its height when laid out `width` wide.
 */
export type MeasureText = (props: TextProps, width: number | null) => Size

/**
 * The box a text layer that grows with its words takes, measured as it is drawn, in the family the
 * brand kit's `variables` give a bound font: with auto width, both sides measured with no line
 * wrapped; with auto height, its width and the height at that width; a curved text, in any box
 * mode, the size of its curve. Undefined for a straight text of a fixed box and for any other layer.
 */
export function fittedText(layer: Layer | undefined, measure: MeasureText, variables?: Variables): Size | undefined {
  if (layer?.type !== 'text' || (layer.props.boxMode === 'fixed' && !layer.props.curve)) return undefined
  const props = bindProps(layer.type, layer.props, layer.bindings, variables)
  const auto = props.boxMode === 'autoWidth' || props.curve !== undefined
  const size = measure(props, auto ? null : props.width)
  return { width: auto ? size.width : props.width, height: size.height }
}
