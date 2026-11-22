// The shape matcher's full pass: the first pass's colour split and stacking, with polygons and stars
// among the shapes and more drawings to fit them, parts no shape holds traced as paths, bands of one
// gradient joined and fills fitted as gradients, many small marks of one colour drawn as one path,
// marks along the edge of their box drawn as one dashed stroke, and a soft dark fringe fitted as a
// drop shadow. Where a traced path stands in for a shape that came close, the shape takes its place
// back when the piece still looks the same. When the graphics don't look the same, every part is
// traced at full size instead. Paths over much of the piece are a photo or a painted scene, which
// stays a picture.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Pixels } from '@dazbee/renderer'
import type { LooksSameScores, MatchAnswer, MatchJob, MatchKit, Piece } from '@dazbee/schema'

import { looksSame } from '../looks-same/rule.ts'
import { layersAnswer, pictureAnswer, withoutUnseen } from './answer.ts'
import { snapToBrand } from './brand-snap.ts'
import { dashedStroke } from './dashes.ts'
import { coverage, drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { FIRST_PASS, flatPaint, partShape, preparePiece, splitOptions } from './first-pass.ts'
import { type ShapeKind, softIoU } from './fit-shapes.ts'
import { tracedAtFullSize } from './full-size-trace.ts'
import { GRADIENT_SPREAD, withGradient } from './gradient.ts'
import { pathName } from './layer-names.ts'
import { type FloatPicture, toFloatPicture } from './parts/float-picture.ts'
import { joinGradientBands, MOST_PARTS_FOR_BANDS } from './parts/gradient-bands.ts'
import { type MarkedPart, markedParts } from './parts/marks.ts'
import { piecePixels } from './parts/piece-pixels.ts'
import { backToFront, coveredAbove } from './parts/stacking.ts'
import { isShadowLike, withShadow } from './shadow.ts'
import { pathLayer, tracePath } from './trace.ts'

/** The full pass's settings; the rest are the first pass's. */
export const FULL_PASS = {
  /** Drawings refining the leading shape kind; the next two get a quarter each. */
  draws: 80,
  kinds: ['rect', 'ellipse', 'line', 'polygon', 'star'] as readonly ShapeKind[],
  /** The most graphics an answer may hold. */
  maxLayers: 16,
  /** A shape holding its part below this soft IoU gives way to a traced path when the path holds it better. */
  shapeHolds: 0.965,
  /** A shape this close to its part may take a traced path's place back. */
  shapeTakesBack: 0.95,
  /** How far, in piece pixels, a traced path may stray from its part's edge. */
  pathTolerance: 0.6,
} as const

/** A traced path must hold its part better than the shape by this soft IoU; a ring's by more, as rings are thin. */
const PATH_BETTER_BY = 0.02
const RING_PATH_BETTER_BY = 0.05
/** Four or more paths covering this share of the piece are a photo or a painted scene. */
const SCENE_PATHS = 4
const SCENE_COVER = 0.3
/** So are ten or more graphics of which six or more are paths: more than a designer would make. */
const SCENE_LAYERS = 10
const SCENE_MANY_PATHS = 6

/** Rebuilds a job's shape piece with every kind of shape, paint and shadow, or says why it stays a picture. */
export function fullPass(ck: CanvasKit, job: MatchJob, piece: Piece): MatchAnswer {
  return fullPassOf(ck, piecePixels(ck, job.picture, piece.rect), job.kit.colors)
}

/** Rebuilds a piece's pixels with every kind of shape, paint and shadow, or says why they stay a picture. */
export function fullPassOf(ck: CanvasKit, piece: Pixels, colors: MatchKit['colors']): MatchAnswer {
  const prepared = preparePiece(piece)
  const { full, scale, fitted, cut, covered } = prepared
  const { width, height } = fitted
  if (covered < 4) return pictureAnswer('looksDifferent')
  const marked = markedParts(fitted, splitOptions(cut, covered), covered)
  const { split } = marked
  if (split.tooMany) return pictureAnswer('tooManyParts')
  let parts = marked.parts
  if (parts.length > FIRST_PASS.maxParts) return pictureAnswer('tooManyParts')
  if (parts.length <= MOST_PARTS_FOR_BANDS) parts = joinGradientBands(fitted, parts, scale)
  // More parts than graphics allowed, with room for dropping some, is a picture before any fitting.
  if (parts.length > FULL_PASS.maxLayers * 1.5) return pictureAnswer('tooManyParts')
  const stacked = backToFront(parts)
  const shadowLike = stacked.filter((part) => isShadowLike(part, stacked))
  const shapes = stacked.filter((part) => !shadowLike.includes(part))
  const graphicOf = (part: MarkedPart, above?: Float32Array, labels?: Int32Array) =>
    fullGraphic(ck, part, fitted, scale, full.width, full.height, above, labels)
  const graphics = shapes.map((part, i) => graphicOf(part, coveredAbove(shapes, i, width * height), split.labels))
  let layers: readonly ShapeLayer[] = withoutUnseen(ck, fitted, graphics, full.width, full.height, scale)
  let traceable = shapes
  const shadowed = withShadow(ck, fitted, layers, full.width, full.height, scale)
  if (shadowed !== layers) layers = shadowed
  else if (shadowLike.length) {
    // No shadow fits: the fringe goes back as graphics of its own, behind the rest.
    layers = [...shadowLike.map((part) => graphicOf(part)), ...layers]
    traceable = [...shadowLike, ...shapes]
  }
  const snapped = snapToBrand(ck, piece, layers, colors)
  if (snapped.layers.length > FULL_PASS.maxLayers) return pictureAnswer('tooManyParts')
  const judge = (drawn: readonly ShapeLayer[]) =>
    looksSame('shape', piece, drawGraphics(ck, drawn, full.width, full.height, 1, snapped.variables))
  const judged = judge(snapped.layers)
  const answer = judged.same
    ? withShapesTakenBack(snapped.layers, judged.scores, judge)
    : tracedAtFullSize(ck, piece, prepared, traceable, colors, FULL_PASS.maxLayers)
  if (!answer) return pictureAnswer('looksDifferent', judged.scores)
  if (isScene(ck, answer.layers, full.width, full.height, scale)) return pictureAnswer('photo', answer.scores)
  return layersAnswer(answer.layers.map(withoutEditable), answer.scores)
}

/**
 * A part's graphic: marks along the edge of their box as one dashed stroke; else its best shape, or
 * a traced path when no shape holds it within IoU 0.965 and the path holds it clearly better, its
 * fill a gradient where one fits. A path keeps the shape that came within IoU 0.95 as its editable
 * stand-in.
 */
function fullGraphic(
  ck: CanvasKit,
  part: MarkedPart,
  fitted: FloatPicture,
  scale: number,
  pieceWidth: number,
  pieceHeight: number,
  above?: Float32Array,
  labels?: Int32Array,
): ShapeLayer {
  const dashed = dashedStroke(ck, part, fitted, scale, FULL_PASS)
  if (dashed) return dashed
  const shape = partShape(ck, part, fitted, scale, FULL_PASS, above, labels)
  let layer = shape.layer
  const { iou } = shape.fitted
  const traced = iou < FULL_PASS.shapeHolds ? tracePath(shape.target, FULL_PASS.pathTolerance) : null
  if (traced) {
    const { target } = shape
    const path = pathLayer(traced, target, flatPaint(part), pathName(part.rgb))
    const drawn = coverage(
      ck,
      { ...path, props: { ...path.props, x: path.props.x - target.offsetX, y: path.props.y - target.offsetY } },
      target.pieceWidth,
      target.pieceHeight,
      target.scale,
      target.width,
      target.height,
    )
    if (softIoU(drawn, target.mask) > iou + (shape.ring ? RING_PATH_BETTER_BY : PATH_BETTER_BY)) {
      layer = {
        ...path,
        ...(shape.background ? { role: 'background' as const } : {}),
        ...(iou >= FULL_PASS.shapeTakesBack ? { editable: shape.layer } : {}),
      }
    }
  }
  if (part.spread > GRADIENT_SPREAD && !shape.ring) {
    layer = withGradient(ck, fitted, part, layer, scale, pieceWidth, pieceHeight) ?? layer
  }
  return layer
}

/**
 * The graphics with each traced path's editable shape put in its place, with the path's paint,
 * binding and shadow, one at a time from the back, wherever the piece still looks the same.
 */
function withShapesTakenBack(
  layers: readonly ShapeLayer[],
  scores: LooksSameScores,
  judge: (drawn: readonly ShapeLayer[]) => { same: boolean; scores: LooksSameScores },
): { layers: readonly ShapeLayer[]; scores: LooksSameScores } {
  let best = { layers, scores }
  for (let i = 0; i < best.layers.length; i++) {
    const path = best.layers[i]
    const shape = path?.editable
    if (!path || !shape) continue
    const swapped: ShapeLayer = {
      ...shape,
      ...(path.bindings ? { bindings: path.bindings } : {}),
      props: {
        ...shape.props,
        ...(shape.props.fills.length ? { fills: path.props.fills } : {}),
        ...(path.props.effects ? { effects: path.props.effects } : {}),
      },
    }
    const tried = best.layers.map((layer, j) => (j === i ? swapped : layer))
    const judged = judge(tried)
    if (judged.same) best = { layers: tried, scores: judged.scores }
  }
  return best
}

/** Whether the graphics are a photo or a painted scene: many free paths over much of the piece. */
function isScene(
  ck: CanvasKit,
  layers: readonly ShapeLayer[],
  pieceWidth: number,
  pieceHeight: number,
  scale: number,
): boolean {
  const paths = layers.filter((layer) => layer.props.shape.kind === 'path')
  if (paths.length < SCENE_PATHS) return false
  const drawn = toFloatPicture(drawGraphics(ck, paths, pieceWidth, pieceHeight, scale))
  let cover = 0
  for (let i = 0; i < drawn.width * drawn.height; i++) cover += drawn.data[i * 4 + 3] ?? 0
  const share = cover / (drawn.width * drawn.height)
  return share >= SCENE_COVER || (layers.length >= SCENE_LAYERS && paths.length >= SCENE_MANY_PATHS)
}

/** A graphic without its editable stand-in, as answered. */
function withoutEditable(layer: ShapeLayer): ShapeLayer {
  if (!layer.editable) return layer
  const answered = { ...layer }
  delete answered.editable
  return answered
}
