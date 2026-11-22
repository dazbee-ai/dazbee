// The text matcher's answer for a piece: one text layer in Dazbee's units, in the piece's pixels,
// bound to the brand kit where it took the kit's font, colour or text style, and approximate when it
// doesn't look the same.

import {
  BINDABLE_PROPERTIES,
  type Bindings,
  type LooksSameScores,
  type MatchAnswer,
  type TextLook as StyleLook,
  UnplacedLayer,
} from '@dazbee/schema'

import { type Placed, textLayerProps, type TextLook } from './draw-text.ts'

/** The most characters of the words a text layer's name takes. */
const NAME_LENGTH = 40

/**
 * The answer for words set in `look` at `place`: one text layer named after its first line, with its
 * bindings, the rule's numbers and whether it is approximate, as it doesn't look the same. A layer
 * bound to a kit text style holds the style's look as its binding writes it.
 */
export function textAnswer(
  words: string,
  look: TextLook,
  place: Placed,
  scores: LooksSameScores,
  approximate: boolean,
  bindings: Bindings = {},
  styleLook?: StyleLook,
): MatchAnswer {
  const props: Readonly<Record<string, unknown>> = { ...textLayerProps(words, look, place) }
  const layer = UnplacedLayer.parse({
    type: 'text',
    name: [...(words.split('\n').find((line) => line.trim()) ?? words).trim()].slice(0, NAME_LENGTH).join(''),
    props: styleLook ? BINDABLE_PROPERTIES.textStyle.write(props, styleLook) : props,
    ...(Object.keys(bindings).length > 0 ? { bindings } : {}),
  })
  return { kind: 'layers', layers: [layer], scores, approximate }
}
