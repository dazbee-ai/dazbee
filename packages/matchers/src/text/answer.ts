// The text matcher's answer for a piece that looks the same: one text layer in Dazbee's units, in the
// piece's pixels.

import { type LooksSameScores, type MatchAnswer, UnplacedLayer } from '@dazbee/schema'

import { type Placed, textLayerProps, type TextLook } from './light/draw-text.ts'

/** The most characters of the words a text layer's name takes. */
const NAME_LENGTH = 40

/**
 * The answer for words that look the same set in `look` at `place`: one text layer named after its
 * first line, with the rule's numbers.
 */
export function textAnswer(words: string, look: TextLook, place: Placed, scores: LooksSameScores): MatchAnswer {
  const layer = UnplacedLayer.parse({
    type: 'text',
    name: [...(words.split('\n').find((line) => line.trim()) ?? words).trim()].slice(0, NAME_LENGTH).join(''),
    props: textLayerProps(words, look, place),
  })
  return { kind: 'layers', layers: [layer], scores }
}
