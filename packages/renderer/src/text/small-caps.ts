// Small caps drawn where the font has none, as FigCraft draws them: a style with the `smcp` feature
// on whose family lacks it draws its lower-case letters as capitals at 72% of its size, keeping the
// letter spacing of the full size. The text drawn keeps its length, so offsets still match.
import { letterSpacingPx, type TextProps } from '@dazbee/schema'

/** A stretch of a text's characters with the one style they are drawn in. */
export interface StyledPiece {
  start: number
  end: number
  style: TextProps['style']
}

/** The share of the size lower-case letters are drawn at as made-up small caps. */
export const SMALL_CAP_SCALE = 0.72

const LOWER = /\p{Ll}/u

/**
 * The pieces split where small caps are made up, and the text as drawn with those letters as
 * capitals. A piece's family lacks small caps when `familyFeatures` doesn't list `smcp` for it.
 */
export function madeUpSmallCaps(
  shown: string,
  pieces: readonly StyledPiece[],
  familyFeatures: ReadonlyMap<string, ReadonlySet<string>> | undefined,
): { shown: string; pieces: StyledPiece[] } {
  let out = ''
  let at = 0
  const split: StyledPiece[] = []
  for (const piece of pieces) {
    out += shown.slice(at, piece.start)
    const { style } = piece
    const own = familyFeatures?.get(style.fontFamily)?.has('smcp') === true
    if (style.features?.smcp !== true || own) {
      out += shown.slice(piece.start, piece.end)
      split.push(piece)
    } else {
      const features = Object.fromEntries(Object.entries(style.features).filter(([tag]) => tag !== 'smcp'))
      const full = { ...style, features }
      const small = {
        ...full,
        fontSize: style.fontSize * SMALL_CAP_SCALE,
        letterSpacing: { unit: 'px' as const, value: letterSpacingPx(style.letterSpacing, style.fontSize) },
      }
      let i = piece.start
      for (const ch of shown.slice(piece.start, piece.end)) {
        const upper = ch.toUpperCase()
        const lower = LOWER.test(ch) && upper.length === ch.length
        out += lower ? upper : ch
        const want = lower ? small : full
        const last = split.at(-1)
        if (last && last.end === i && last.style === want) last.end = i + ch.length
        else split.push({ start: i, end: i + ch.length, style: want })
        i += ch.length
      }
    }
    at = piece.end
  }
  return { shown: out + shown.slice(at), pieces: split }
}
