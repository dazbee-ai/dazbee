// One correction of a fitted candidate from its placed draw, a Newton step: the size by how much
// taller the piece's lines are than the drawn ones, letter spacing by the width still missing, line
// height by the pitch still missing. It is kept when the drawn ink overlaps the piece's better.

import type { PieceReading } from '../read-piece.ts'
import type { TextDrawer } from './draw-text.ts'
import { centre, clamp, type Fitted, LINE_HEIGHT_RANGE, middle, placeByInk, sizeFits, SPACING_RANGE } from './fit.ts'

/** The fit corrected once from its placed draw, or the fit itself when the correction overlaps no better. */
export function correct(drawer: TextDrawer, reading: PieceReading, words: string, fit: Fitted): Fitted {
  const count = words.split('\n').length
  const ratio = middle(reading.lines.map((line, i) => line.h / Math.max(1, fit.lines[i]?.h ?? 0)))
  const size = fit.look.size * ratio
  let room = 0
  let gaps = 0
  reading.lines.forEach((line, i) => {
    const places = fit.lineGaps[i] ?? 0
    if (places <= 0) return
    room += line.w - (fit.lines[i]?.w ?? 0) * ratio
    gaps += places
  })
  const spacing =
    gaps > 0
      ? clamp(fit.look.spacing + ((room / gaps) * 100) / size, SPACING_RANGE.min, SPACING_RANGE.max)
      : fit.look.spacing
  let lineHeight = fit.look.lineHeight
  if (count > 1 && lineHeight) {
    let sum = 0
    for (let i = 0; i + 1 < count; i++)
      sum +=
        centre(reading.lines[i + 1]) -
        centre(reading.lines[i]) -
        (centre(fit.lines[i + 1]) - centre(fit.lines[i])) * ratio
    lineHeight = clamp(lineHeight + sum / (count - 1) / size, LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max)
  }
  if (!sizeFits(reading, count, size)) return fit
  const look = { ...fit.look, size, spacing, ...(lineHeight ? { lineHeight } : {}) }
  const tried = placeByInk(drawer, reading, words, fit.face, look)
  return tried && tried.overlap > fit.overlap ? { ...tried, lineGaps: fit.lineGaps } : fit
}
