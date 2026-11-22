// The shape matcher: the ladder of its two passes. The first pass's answer is kept when it looks the
// same in at most two graphics; otherwise the full pass runs too, and the answer that looks the same
// in fewer graphics wins, the first pass's on a tie. Each pass's answer goes through the photo guard
// first, so a photo picked as shapes stays a picture. When neither pass makes graphics, the first
// pass's reason is given, unless either pass found a photo: the guard, or the full pass's scene check.
// Who is told is told each step as it starts.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Pixels } from '@dazbee/renderer'
import type { MatchAnswer, MatchJob, MatchKit, Piece } from '@dazbee/schema'

import { firstPassOf } from './first-pass.ts'
import { fullPassOf } from './full-pass.ts'
import { piecePixels } from './parts/piece-pixels.ts'
import { guardedAnswer } from './photo-guard.ts'

/**
 * The shape matcher's steps: the piece split by colour, the first pass fitting its parts, the full
 * pass, and a pass's graphics judged by the rule and the photo guard, after each pass that makes them.
 */
export const SHAPE_STEPS = ['colourSplit', 'firstPass', 'fullPass', 'judging'] as const
export type ShapeStep = (typeof SHAPE_STEPS)[number]

/** The most graphics a first pass's answer may hold and still be kept without running the full pass. */
const FIRST_PASS_ENOUGH = 2

/** Rebuilds a job's shape piece as graphics that look the same in as few graphics as the passes find, or says why it stays a picture. */
export function matchShapes(ck: CanvasKit, job: MatchJob, piece: Piece, step?: (step: ShapeStep) => void): MatchAnswer {
  return matchShapesOf(ck, piecePixels(ck, job.picture, piece.rect), job.kit.colors, step)
}

/** Rebuilds a piece's pixels as graphics that look the same in as few graphics as the passes find, or says why they stay a picture. */
export function matchShapesOf(
  ck: CanvasKit,
  piece: Pixels,
  colors: MatchKit['colors'],
  step?: (step: ShapeStep) => void,
): MatchAnswer {
  const first = guardedAnswer(ck, piece, firstPassOf(ck, piece, colors, step))
  if (first.kind === 'layers' && first.layers.length <= FIRST_PASS_ENOUGH) return first
  const full = guardedAnswer(ck, piece, fullPassOf(ck, piece, colors, step))
  if (full.kind !== 'layers') return first.kind === 'picture' && full.why === 'photo' ? full : first
  return first.kind !== 'layers' || full.layers.length < first.layers.length ? full : first
}
