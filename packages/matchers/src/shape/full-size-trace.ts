// Full-size tracing, the full pass's last try: when its shapes don't look the same, every part is
// traced as a path instead, following the piece's own edge where a clean shape sits a pixel off it
// (an AI-made pill, a badge). A piece shrunk to be fitted and at most 768 px on its long side is
// split by colour again at its full size first, so the paths follow its edge pixel for pixel. The
// paths get gradients, the drop shadow and the brand snap as the shapes do, and are judged.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Pixels } from '@dazbee/renderer'
import type { LooksSameScores, MatchKit } from '@dazbee/schema'

import { looksSame } from '../looks-same/rule.ts'
import { snapToBrand } from './brand-snap.ts'
import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { flatPaint, type PreparedPiece, splitOptions } from './first-pass.ts'
import { windowOf } from './fit/fit-window.ts'
import { GRADIENT_SPREAD, withGradient } from './fit/gradient.ts'
import { withShadow } from './fit/shadow.ts'
import { pathLayer, tracePath } from './fit/trace.ts'
import { pathName } from './layer-names.ts'
import type { FloatPicture } from './parts/float-picture.ts'
import { joinGradientBands, MOST_PARTS_FOR_BANDS } from './parts/gradient-bands.ts'
import { type MarkedPart, markedParts } from './parts/marks.ts'
import { backToFront } from './parts/stacking.ts'

/** A piece is split again at its full size only when its long side is at most this many pixels. */
const LONGEST_RESPLIT = 768
/** How far, in piece pixels, a path traced at full size may stray from its part's edge; at the fitting size. */
const FULL_SIZE_TOLERANCE = 0.35
const FITTING_TOLERANCE = 0.5
/** Pixels a window reaches past its part's box. */
const WINDOW_PAD = 3

/**
 * Every part of a piece traced as a path in its colour, or its gradient, with the drop shadow and
 * the brand snap; the graphics and the rule's numbers when they look the same as the piece and number
 * between one and `maxLayers`, else null. `parts` are the full pass's, at the fitting size, used
 * when the piece isn't split again.
 */
export function tracedAtFullSize(
  ck: CanvasKit,
  piece: Pixels,
  prepared: PreparedPiece,
  parts: readonly MarkedPart[],
  colors: MatchKit['colors'],
  maxLayers: number,
): { layers: ShapeLayer[]; scores: LooksSameScores } | null {
  const { full, fitted, scale } = prepared
  const resplit = scale < 1 && Math.max(full.width, full.height) <= LONGEST_RESPLIT ? fullSizeParts(full) : null
  const picture: FloatPicture = resplit ? full : fitted
  const at = resplit ? 1 : scale
  const traced: ShapeLayer[] = []
  for (const part of resplit ?? parts) {
    const window = windowOf(part.filled, picture.width, picture.height, at, part.box, WINDOW_PAD)
    const path = tracePath(window, at === 1 ? FULL_SIZE_TOLERANCE : FITTING_TOLERANCE)
    if (!path) continue
    const layer = pathLayer(path, window, flatPaint(part), pathName(part.rgb))
    traced.push(
      part.spread > GRADIENT_SPREAD
        ? (withGradient(ck, picture, part, layer, at, full.width, full.height) ?? layer)
        : layer,
    )
  }
  if (traced.length === 0 || traced.length > maxLayers) return null
  const shadowed = withShadow(ck, fitted, traced, full.width, full.height, scale)
  const { layers, variables } = snapToBrand(ck, piece, shadowed, colors)
  const judged = looksSame('shape', piece, drawGraphics(ck, layers, full.width, full.height, 1, variables))
  return judged.same ? { layers, scores: judged.scores } : null
}

/**
 * The piece's parts split by colour at its full size, marks grouped, specks left out and bands of
 * one gradient joined, back to front; null when the split finds too many parts or none.
 */
function fullSizeParts(full: FloatPicture): MarkedPart[] | null {
  let covered = 0
  for (let i = 0; i < full.width * full.height; i++) if ((full.data[i * 4 + 3] ?? 0) >= 0.5) covered++
  const marked = markedParts(full, splitOptions(0.5, covered), covered)
  if (marked.split.tooMany || marked.split.parts.length === 0) return null
  let parts = marked.parts
  if (parts.length <= MOST_PARTS_FOR_BANDS) parts = joinGradientBands(full, parts, 1)
  return backToFront(parts)
}
