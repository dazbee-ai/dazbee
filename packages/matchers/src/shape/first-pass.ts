// The shape matcher's first pass: a piece rebuilt as rectangles (with a radius, so pills and squares
// too), ellipses and lines, filled or stroked in flat colours. The piece is split by colour at
// 256 px on its long side, its parts stacked back to front and each fitted with a shape; graphics
// that change nothing are dropped, colours near the brand kit's snap to them, and the graphics,
// drawn at the piece's full size, are judged by the looks-the-same rule.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Pixels } from '@dazbee/renderer'
import type { MatchAnswer, MatchJob, MatchKit, Paint, Piece } from '@dazbee/schema'

import { looksSame } from '../looks-same/rule.ts'
import { layersAnswer, pictureAnswer, withoutUnseen } from './answer.ts'
import { snapToBrand } from './brand-snap.ts'
import { hexColour } from './colour.ts'
import { splitColours } from './colour-split.ts'
import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { fitShape, type ShapeKind, shapeLayer } from './fit-shapes.ts'
import { windowOf } from './fit-window.ts'
import { type FloatPicture, shrinkFloats, toFloatPicture } from './float-picture.ts'
import { layerName } from './layer-names.ts'
import { piecePixels } from './piece-pixels.ts'
import { isRing, ringWidth } from './rings.ts'
import { coveredAbove, type StackedPart, stackParts, sum } from './stacking.ts'

/** The first pass's settings. */
export const FIRST_PASS = {
  /** The longest side, in pixels, a piece is split and fitted at; it is judged at its full size. */
  fitSide: 256,
  /** The most colours k-means starts from. */
  colours: 10,
  /** Colours closer than this ΔE00 are one. */
  mergeDeltaE: 7,
  /** Specks under this share of the covered pixels fold into their neighbours. */
  speckShare: 0.0004,
  /** Drawings refining the leading shape kind; the next two get a quarter each. */
  draws: 40,
  kinds: ['rect', 'ellipse', 'line'] as readonly ShapeKind[],
  /** The most graphics an answer may hold. */
  maxLayers: 8,
  /** The most parts a piece may be split into before it is too detailed. */
  maxParts: 40,
} as const

/** Pixels of the fitting size a window reaches past its part's box. */
const WINDOW_PAD = 3
/** A part is a background when it touches the piece's edge and fills this share of it. */
const BACKGROUND_SHARE = 0.9
/** A part's alpha under this makes its fill see-through. */
const SEE_THROUGH = 0.97

/** Rebuilds a job's shape piece as graphics that look the same, or says why it stays a picture. */
export function firstPass(ck: CanvasKit, job: MatchJob, piece: Piece): MatchAnswer {
  return firstPassOf(ck, piecePixels(ck, job.picture, piece.rect), job.kit.colors)
}

/** Rebuilds a piece's pixels as graphics that look the same, or says why they stay a picture. */
export function firstPassOf(ck: CanvasKit, piece: Pixels, colors: MatchKit['colors']): MatchAnswer {
  const full = toFloatPicture(piece)
  const scale = Math.min(1, FIRST_PASS.fitSide / Math.max(full.width, full.height))
  const width = Math.ceil(full.width * scale - 1e-9)
  const height = Math.ceil(full.height * scale - 1e-9)
  const fitted = scale < 1 ? shrinkFloats(full, width, height) : full
  const cut = coverageCut(fitted)
  let covered = 0
  for (let i = 0; i < width * height; i++) if ((fitted.data[i * 4 + 3] ?? 0) >= cut) covered++
  if (covered < 4) return pictureAnswer('looksDifferent')
  const split = splitColours(fitted, {
    mergeDeltaE: FIRST_PASS.mergeDeltaE,
    k: FIRST_PASS.colours,
    minArea: Math.max(4, FIRST_PASS.speckShare * covered),
    cut,
    maxParts: FIRST_PASS.maxParts * 2,
  })
  if (split.tooMany) return pictureAnswer('tooManyParts')
  const parts = split.parts.filter((part) => sum(part.mask) >= Math.max(2, covered * 0.0005))
  // More parts than graphics allowed, with room for dropping some, is a picture before any fitting.
  if (parts.length > FIRST_PASS.maxParts || parts.length > FIRST_PASS.maxLayers * 1.5) {
    return pictureAnswer('tooManyParts')
  }
  const stacked = stackParts(parts, fitted)
  const graphics = stacked.map((part, i) =>
    graphicOf(ck, part, fitted, scale, coveredAbove(stacked, i, width * height), split.labels),
  )
  const kept = withoutUnseen(ck, fitted, graphics, full.width, full.height, scale)
  const { layers, variables } = snapToBrand(ck, piece, kept, colors)
  if (layers.length > FIRST_PASS.maxLayers) return pictureAnswer('tooManyParts')
  const judged = looksSame('shape', piece, drawGraphics(ck, layers, full.width, full.height, 1, variables))
  return judged.same ? layersAnswer(layers, judged.scores) : pictureAnswer('looksDifferent', judged.scores)
}

/**
 * The alpha from which a pixel is covered: half the alpha of the piece's most opaque pixels (its
 * 99.5th percentile), between 0.08 and 0.5, as faint thin strokes in a resampled piece never reach 0.5.
 */
function coverageCut(fitted: FloatPicture): number {
  const n = fitted.width * fitted.height
  const alphas = new Float32Array(n)
  for (let i = 0; i < n; i++) alphas[i] = fitted.data[i * 4 + 3] ?? 0
  alphas.sort()
  return Math.max(0.08, Math.min(0.5, 0.5 * (alphas[Math.floor(alphas.length * 0.995)] ?? 0)))
}

/**
 * A part's graphic: its best shape in its flat colour, filled, or stroked inside its outer edge
 * when it is a ring. A filled shape may reach under the parts over it at no cost.
 */
function graphicOf(
  ck: CanvasKit,
  part: StackedPart,
  fitted: FloatPicture,
  scale: number,
  above: Float32Array,
  labels: Int32Array,
): ShapeLayer {
  const { width, height } = fitted
  const ring = isRing(part, labels)
  const window = windowOf(
    ring ? part.outer : part.filled,
    width,
    height,
    scale,
    part.box,
    WINDOW_PAD,
    ring ? undefined : above,
  )
  const fit = ring
    ? fitShape(
        ck,
        window,
        { draws: FIRST_PASS.draws, kinds: FIRST_PASS.kinds.filter((kind) => kind !== 'line') },
        {
          target: windowOf(part.mask, width, height, scale, part.box, WINDOW_PAD),
          stroke: ringWidth(part, width, height) / scale,
        },
      ).fit
    : fitShape(ck, window, { draws: FIRST_PASS.draws, kinds: FIRST_PASS.kinds }).fit
  const background = part.touchesEdge && sum(part.filled) >= width * height * BACKGROUND_SHARE
  const layer = shapeLayer(fit, flatPaint(part), layerName(part.rgb, fit, background))
  return background ? { ...layer, role: 'background' } : layer
}

/** A part's flat colour, see-through by its alpha when it is under 0.97. */
function flatPaint(part: StackedPart): Paint {
  const color = hexColour(...part.rgb)
  return part.alpha < SEE_THROUGH
    ? { type: 'solid', color, opacity: Math.round(part.alpha * 1000) / 1000 }
    : { type: 'solid', color }
}
