// The shape matcher's answer for a piece: its graphics as unplaced layers, or why it stays a picture.

import { type LooksSameScores, type MatchAnswer, type PictureWhy, UnplacedLayer } from '@dazbee/schema'

import type { ShapeLayer } from './draw-layers.ts'

/** The answer for graphics that look the same: the graphics as unplaced layers, with the rule's numbers. */
export function layersAnswer(layers: readonly ShapeLayer[], scores: LooksSameScores): MatchAnswer {
  return { kind: 'layers', layers: layers.map((layer) => UnplacedLayer.parse(layer)), scores, approximate: false }
}

/** The answer for a piece that stays a picture, with the rule's numbers when its graphics were judged. */
export function pictureAnswer(why: PictureWhy, scores?: LooksSameScores): MatchAnswer {
  return { kind: 'picture', why, ...(scores ? { scores } : {}) }
}
