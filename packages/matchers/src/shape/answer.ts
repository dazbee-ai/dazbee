// The shape matcher's answer for a piece: its graphics as unplaced layers, once those that change
// nothing are dropped, or why it stays a picture.

import type { CanvasKit } from '@dazbee/canvaskit'
import { type LooksSameScores, type MatchAnswer, type PictureWhy, UnplacedLayer } from '@dazbee/schema'

import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { type FloatPicture, toFloatPicture } from './parts/float-picture.ts'

/** A layer may go when the picture without it differs from the piece by at most this much more, of 255. */
const UNSEEN_BY = 0.25

/** The answer for graphics that look the same: the graphics as unplaced layers, with the rule's numbers. */
export function layersAnswer(layers: readonly ShapeLayer[], scores: LooksSameScores): MatchAnswer {
  return { kind: 'layers', layers: layers.map((layer) => UnplacedLayer.parse(layer)), scores, approximate: false }
}

/** The answer for a piece that stays a picture, with the rule's numbers when its graphics were judged. */
export function pictureAnswer(why: PictureWhy, scores?: LooksSameScores): MatchAnswer {
  return { kind: 'picture', why, ...(scores ? { scores } : {}) }
}

/**
 * The graphics without those that change nothing, as an inner patch of the colour under it: from the
 * top, each graphic goes when the piece drawn without it, at the fitting size, differs from the
 * piece by at most a quarter level more on average. One graphic always stays.
 */
export function withoutUnseen(
  ck: CanvasKit,
  fitted: FloatPicture,
  layers: readonly ShapeLayer[],
  pieceWidth: number,
  pieceHeight: number,
  scale: number,
): ShapeLayer[] {
  const difference = (drawn: readonly ShapeLayer[]) =>
    meanDifference(fitted, toFloatPicture(drawGraphics(ck, drawn, pieceWidth, pieceHeight, scale)))
  let kept = [...layers]
  let base = difference(kept)
  for (let i = kept.length - 1; i >= 0 && kept.length > 1; i--) {
    const without = kept.filter((_, j) => j !== i)
    const d = difference(without)
    if (d <= base + UNSEEN_BY) {
      kept = without
      base = Math.min(base, d)
    }
  }
  return kept
}

/** The mean absolute difference of two pictures' premultiplied colour and alpha, 0 to 255. */
export function meanDifference(a: FloatPicture, b: FloatPicture): number {
  let total = 0
  const n = Math.min(a.width * a.height, b.width * b.height)
  for (let i = 0; i < n; i++) {
    const alphaA = a.data[i * 4 + 3] ?? 0
    const alphaB = b.data[i * 4 + 3] ?? 0
    for (let c = 0; c < 3; c++) total += Math.abs((a.data[i * 4 + c] ?? 0) * alphaA - (b.data[i * 4 + c] ?? 0) * alphaB)
    total += Math.abs(alphaA - alphaB) * 255
  }
  return total / (n * 4)
}
