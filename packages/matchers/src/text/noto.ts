// The faces a text piece is set in when no face of the catalog draws its characters, or none of
// those that do could be fitted or loaded: the Noto family Dazbee ships for the piece's script, in
// each of its shipped faces. Such text is always approximate.

import { FONT_FACES } from '@dazbee/fonts'

import { type TextDrawer, type TextLook } from './draw-text.ts'
import { fontKey } from './font-key.ts'
import { BASE_LINE_HEIGHT, type Fitted, placeByInk } from './light/fit.ts'
import type { PieceReading } from './read-piece.ts'
import { type Script, scriptOf } from './scripts.ts'
import type { Candidate } from './shortlist.ts'

/** The shipped Noto family each script is set in. */
const NOTO_FAMILIES: Readonly<Record<Script, string>> = {
  latin: 'Noto Sans',
  arabic: 'Noto Naskh Arabic',
  devanagari: 'Noto Sans Devanagari',
}
/** A plain fit is drawn in black; the piece's colours are put on when it is finished. */
const PLAIN_COLOUR = '#000000FF'

/** The shipped Noto faces of the words' script, lightest first, as candidates. */
export function notoCandidates(words: string): Candidate[] {
  const family = NOTO_FAMILIES[scriptOf(words)]
  return FONT_FACES.filter((face) => face.family === family).map(({ weight, style }) => ({
    key: fontKey({ family, weight, style }),
    family,
    weight,
    style,
  }))
}

/**
 * A face set at the piece's line height with no letter spacing and placed by its ink centre, for
 * when fitting can't size it; null when it draws no ink.
 */
export function plainFit(drawer: TextDrawer, reading: PieceReading, words: string, face: Candidate): Fitted | null {
  const lines = words.split('\n')
  const look: TextLook = {
    family: face.family,
    weight: face.weight,
    style: face.style,
    size: Math.max(1, reading.box.h / lines.length),
    spacing: 0,
    ...(lines.length > 1 ? { lineHeight: BASE_LINE_HEIGHT } : {}),
    align: reading.align,
    color: PLAIN_COLOUR,
    ...(reading.outline ? { outline: { width: reading.outline.width, color: PLAIN_COLOUR } } : {}),
  }
  const placed = placeByInk(drawer, reading, words, face, look)
  return placed ? { ...placed, lineGaps: lines.map(() => 0) } : null
}
