// Raised characters: a piece's raise as the pixels it moves its glyphs off their line's baseline,
// set on the pieces before superscripts, subscripts and small caps are made up, so it is a share of
// the size the characters are set at and moves a made-up superscript with its own move.
import type { StyledPiece } from './types.ts'

/** A piece with the pixels its style's raise moves it (`raiseShift`); the same piece without a raise. */
export function withRaise(piece: StyledPiece): StyledPiece {
  const raise = piece.style.raise ?? 0
  return raise === 0 ? piece : { ...piece, raiseShift: (-raise / 100) * piece.style.fontSize }
}

/** The pixels a piece's glyphs move off their line's baseline, down for a positive value: its made-up superscript's or subscript's, and its raise. */
export function baselineShift(piece: Pick<StyledPiece, 'superSub' | 'raiseShift'>): number {
  return (piece.superSub?.baselineShift ?? 0) + (piece.raiseShift ?? 0)
}
