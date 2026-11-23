// The types the text modules share.
import type { TextProps } from '@dazbee/schema'

/** A stretch of a text's characters with the one style they are drawn in. */
export interface StyledPiece {
  start: number
  end: number
  style: TextProps['style']
  /**
   * Set on a made-up superscript or subscript: the size its letters stand in for, which its lines
   * keep, and the pixels its baseline moves, down for a positive value.
   */
  superSub?: { fontSize: number; baselineShift: number }
  /** Set on raised or lowered characters: the pixels their raise moves their glyphs, down for a positive value. */
  raised?: number
}
