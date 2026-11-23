// Hybrid's finer fit of the one face Light picked: its size, letter spacing, line height, place across
// and down, outline width (not the line of hollow letters) and a curved text's amount, each moved up by
// a step and then down, the first move whose drawn ink overlaps the piece's better kept; 3 rounds over
// the 7 settings, every step halved after each round. A move never spaces the letters so tight they run
// into each other.
// It is bounded by its rounds and reads no clock, so a slow device gets a fast one's answer.

import type { TextDrawer, TextLook } from './draw-text.ts'
import { CURVE_AMOUNTS } from './effects/curve.ts'
import {
  BASE_LINE_HEIGHT,
  type Drawing,
  drawOver,
  type Fitted,
  type Nudge,
  placeDrawing,
  placeDrawn,
  shaped,
} from './light/fit.ts'
import { spacedApart } from './light/letters-apart.ts'
import type { PieceReading } from './read-piece.ts'

/** A setting the finer fit moves. */
type Setting = 'size' | 'spacing' | 'lineHeight' | 'dx' | 'dy' | 'outline' | 'amount'

/** How many times the finer fit goes over its settings. */
const ROUNDS = 3
/**
 * Each setting's first step, in the order the settings are tried: the size by a share of itself,
 * letter spacing in points of %, line height in multiples of the size, the place and the outline in
 * pixels, a curve's amount in its points.
 */
const FIRST_STEPS: Readonly<Record<Setting, number>> = {
  size: 0.03,
  spacing: 2,
  lineHeight: 0.05,
  dx: 1,
  dy: 1,
  outline: 0.5,
  amount: 4,
}
/** A move is kept when the drawn ink overlaps the piece's by more than this better. */
const BETTER_BY = 1e-4

/**
 * The fit moved setting by setting while its drawn ink overlaps the piece's better, its letter shape
 * kept as it was; the fit itself, the same object, when no move helps.
 */
export function finerFit(drawer: TextDrawer, reading: PieceReading, words: string, start: Fitted): Fitted {
  let best = start
  let nudge: Nudge = { dx: 0, dy: 0 }
  // The best look's drawing, once drawn: a move of the place alone moves it rather than drawing it again.
  let drawing: Drawing | undefined
  const steps: Record<Setting, number> = { ...FIRST_STEPS }
  const settings = Object.keys(FIRST_STEPS) as Setting[]
  const lined = words.includes('\n')
  for (let round = 0; round < ROUNDS; round++) {
    for (const setting of settings) {
      if (setting === 'lineHeight' && !lined) continue
      // Hollow letters' line keeps the width read: a wider one would only fill the letters out.
      if (setting === 'outline' && (!best.look.outline || reading.fill === null)) continue
      if (setting === 'amount' && !best.look.curve) continue
      for (const sign of [1, -1]) {
        // A wider outline can run letters into each other too, so every move is spaced apart.
        const look = spacedApart(drawer, words, moved(best.look, setting, sign * steps[setting]))
        // Spacing kept apart back where it was draws what the fit draws, so it overlaps no better.
        if (setting === 'spacing' && look.spacing === best.look.spacing) continue
        const place: Nudge = {
          dx: nudge.dx + (setting === 'dx' ? sign * steps.dx : 0),
          dy: nudge.dy + (setting === 'dy' ? sign * steps.dy : 0),
        }
        const placeOnly = (setting === 'dx' || setting === 'dy') && look.spacing === best.look.spacing
        if (placeOnly) drawing ??= drawOver(drawer, reading, words, look) ?? undefined
        const placing = placeOnly
          ? drawing && placeDrawing(reading, best.face, drawing, place)
          : placeDrawn(drawer, reading, words, best.face, look, place)
        if (placing && placing.fit.overlap > best.overlap + BETTER_BY) {
          best = { ...shaped(reading, placing, best.shape), lineGaps: start.lineGaps }
          nudge = place
          drawing = placing.drawing
          break
        }
      }
    }
    for (const setting of settings) steps[setting] /= 2
  }
  return best
}

/** The look with one of its settings moved by `by`; a move of the place leaves the look as it is. */
function moved(look: TextLook, setting: Setting, by: number): TextLook {
  switch (setting) {
    case 'size':
      return { ...look, size: look.size * (1 + by) }
    case 'spacing':
      return { ...look, spacing: look.spacing + by }
    case 'lineHeight':
      return { ...look, lineHeight: (look.lineHeight ?? BASE_LINE_HEIGHT) + by }
    case 'outline':
      return look.outline
        ? { ...look, outline: { ...look.outline, width: Math.max(0, look.outline.width + by) } }
        : look
    case 'amount':
      return look.curve
        ? {
            ...look,
            curve: {
              ...look.curve,
              amount: Math.min(CURVE_AMOUNTS.max, Math.max(CURVE_AMOUNTS.min, look.curve.amount + by)),
            },
          }
        : look
    default:
      return { ...look }
  }
}
