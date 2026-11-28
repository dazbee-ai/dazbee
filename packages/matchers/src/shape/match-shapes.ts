// The shape matcher: a piece of flat drawing rebuilt as graphics a person can edit.
//
// The piece is cut into patches of one flat colour with sub-pixel outlines (`patches.ts`). The patches are stacked
// back to front, the largest outline first (`stacking.ts`), and each becomes one graphic (`graphics.ts`):
// - a rectangle (with corner radii), an ellipse or a line when its outline keeps to one (`primitives.ts`), found
//   whole where smaller patches lie over part of it; a patch with one see-through hole of the same shape is that
//   shape as an outline stroke;
// - else a path traced along its outline. A hole that shows what lies under the patch stays a hole, and the
//   patch seen through it is no graphic of its own; a hole other patches fill is closed, as they lie on top.
// Loose patches of one colour that are no shape of their own (an icon's strokes, a row of dots, a skyline) are one
// path together. The graphics are then judged against the piece by the looks-the-same rule and the detail check
// (`detail-check.ts`); when the shapes fail, every patch is traced as it is and judged again.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Pixels } from '@dazbee/renderer'
import { type MatchAnswer, type MatchJob, type MatchKit, type Piece, readImageHeader, type Rgb } from '@dazbee/schema'

import { LOOKS_SAME, shrunk } from '../looks-same/rule.ts'
import { layersAnswer, pictureAnswer } from './answer.ts'
import { snapToBrand } from './brand-snap.ts'
import type { Detail } from './detail-check.ts'
import { drawGraphics } from './draw-layers.ts'
import { graphicsOf, regularOf } from './graphics.ts'
import { judge, type Judged, type Seen, withoutUnseen } from './judging.ts'
import { type FloatPicture, shrinkFloats, toFloatPicture } from './parts/float-picture.ts'
import { piecePixels } from './parts/piece-pixels.ts'
import { gradientOf } from './patch-gradient.ts'
import { type Split, splitPatches } from './patches.ts'
import { shadowOf } from './shadow.ts'
import { busyShare, SHRINK_LOSS, shrunkWithLoss } from './shrink-loss.ts'
import { stack, type Stacked } from './stacking.ts'

/** What the frame shows around a piece, which decides what of the piece a person sees. */
export interface Around {
  /** Per pixel of the piece, 1 where other layers of the frame cover it: nothing there is seen, so nothing there is matched or judged. */
  hidden?: Uint8Array
  /** The colour the frame shows behind the piece, which a see-through piece is judged over. */
  behind?: Rgb
}

/** The settings of the match. */
export const SHAPES = {
  /** The most pixels a piece is cut into patches at: a larger piece is shrunk to them. */
  workPixels: 512 * 512,
  /** The longest side a shadow is fitted at. */
  shadowSide: 160,
  /** A shadow is looked for only in a rebuild with at most this share of far pixels: more is no shadow missing. */
  shadowFar: 0.2,
  /** A piece with more of its pixels unexplained by flat colours than this is shaded or textured: a picture. */
  mostUnexplained: 0.2,
  /** The most patches a piece may have, and the most graphics an answer may hold. */
  mostPatches: 120,
  mostLayers: 24,
  /** The shapes are traced for a second try when at least this share of the pixels seen as different are theirs. */
  onShapes: 0.3,
  /** A patch whose outline encloses less than this many pixels is no graphic. */
  leastOutline: 2,
} as const

/**
 * The shape matcher's steps: the piece cut into patches, the patches made graphics, and the graphics judged by the
 * rule and the detail check; the last two are told again when the shapes are traced for a second try, and all
 * three when the piece is cut again without the colour behind it.
 */
export const SHAPE_STEPS = ['patches', 'graphics', 'judging'] as const
export type ShapeStep = (typeof SHAPE_STEPS)[number]

/** Rebuilds a job's shape piece as graphics that look the same, or says why it stays a picture. */
export function matchShapes(ck: CanvasKit, job: MatchJob, piece: Piece, step?: (step: ShapeStep) => void): MatchAnswer {
  const picture = piecePixels(ck, job.picture, piece.rect)
  const hidden = job.hidden === undefined ? undefined : hiddenOf(job.hidden, job.picture, piece.rect, picture)
  const behind = job.backgrounds?.[0]
  return matchShapesOf(
    ck,
    picture,
    job.kit.colors,
    { ...(hidden ? { hidden } : {}), ...(behind ? { behind } : {}) },
    step,
  )
}

/**
 * Rebuilds a piece's pixels as graphics that look the same in the frame `around` it, or says why they stay a
 * picture, telling `step` as each step starts. The judge keeps what it reads of a piece for the piece object: a
 * caller that matches another picture gives another object, never the same one with its pixels changed in place.
 */
export function matchShapesOf(
  ck: CanvasKit,
  piece: Pixels,
  colors: MatchKit['colors'],
  around: Around = {},
  step?: (step: ShapeStep) => void,
): MatchAnswer {
  step?.('patches')
  const { small, cutAt, spread } = sized(piece)
  const hidden = hiddenAt(around.hidden, piece, cutAt)
  // A pattern the shrink turned into one flat tone is no flat drawing, whatever the shrunk picture shows.
  if (spread && busyShare(cutAt, spread, hidden) > SHRINK_LOSS.mostBusy) return pictureAnswer('tooManyParts')
  const worked = toFloatPicture(cutAt)
  const seen: Seen = { ck, piece, small, hidden: hiddenAt(around.hidden, piece, small), behind: around.behind }
  // Edge pixels mixed with the colour behind the piece are one reading of its edges, right for a cut-out that kept a
  // rim of its ground and wrong for one whose own edge is such a mix. When that reading was made and its rebuild
  // looks different, the piece is cut again without it.
  const first = rebuilt(ck, piece, colors, worked, hidden, seen, around.behind, step)
  if (first.answer.kind === 'layers' || !first.rim) return first.answer
  step?.('patches')
  const second = rebuilt(ck, piece, colors, worked, hidden, seen, undefined, step)
  return second.answer.kind === 'layers' ? second.answer : first.answer
}

/**
 * The answer for a piece cut with `behind` as the colour its edge pixels may be mixed with, or with none, and
 * whether any edge pixel was read as such a mix.
 */
function rebuilt(
  ck: CanvasKit,
  piece: Pixels,
  colors: MatchKit['colors'],
  worked: FloatPicture,
  hidden: Uint8Array | undefined,
  seen: Seen,
  behind: Rgb | undefined,
  step?: (step: ShapeStep) => void,
): { answer: MatchAnswer; rim: boolean } {
  const split = splitPatches(worked, hidden, {
    most: { patches: SHAPES.mostPatches, outline: SHAPES.leastOutline },
    ...(behind ? { behind } : {}),
  })
  if (!split) return { answer: pictureAnswer('tooManyParts'), rim: false }
  const answer = graphicsAnswer(ck, piece, colors, worked, hidden, seen, split, step)
  return { answer, rim: split.rim }
}

/** The answer for a piece from the patches it was cut into. */
function graphicsAnswer(
  ck: CanvasKit,
  piece: Pixels,
  colors: MatchKit['colors'],
  worked: FloatPicture,
  hidden: Uint8Array | undefined,
  seen: Seen,
  split: Split,
  step?: (step: ShapeStep) => void,
): MatchAnswer {
  if (split.unexplained > SHAPES.mostUnexplained) return pictureAnswer('photo')
  if (split.tooMany) return pictureAnswer('tooManyParts')
  const patches = split.patches.filter((r) => r.outline >= SHAPES.leastOutline)
  // A piece with nothing to draw has no rebuild that looks the same.
  if (patches.length === 0) return pictureAnswer('looksDifferent')
  step?.('graphics')
  const stacked = stack(patches, split.patchOf, split.width, split.height)
  for (const s of stacked) s.gradient = gradientOf(s.patch, worked, split.patchOf, hidden)
  for (const s of stacked) s.regular = regularOf(ck, s, split.patchOf, split.width)
  let last: Judged | null = null
  for (const shapes of [true, false]) {
    if (!shapes && !stacked.some((s) => s.primitive || s.regular)) break
    if (!shapes) step?.('graphics')
    const { layers, pixels } = graphicsOf(stacked, shapes, piece.width / worked.width)
    if (layers.length === 0 || layers.length > SHAPES.mostLayers) {
      if (!shapes) return pictureAnswer('tooManyParts')
      continue
    }
    let snapped = snapToBrand(ck, piece, layers, colors)
    step?.('judging')
    let judged = judge(seen, snapped.layers, snapped.variables)
    if (!judged.same && judged.scores.far <= SHAPES.shadowFar) {
      // A soft fringe the graphics leave uncovered is a drop shadow or a glow, when the piece looks the same with one.
      // It is fitted at a small size.
      const shadowScale = Math.min(1, SHAPES.shadowSide / Math.max(piece.width, piece.height))
      const made = toFloatPicture(
        drawGraphics(ck, snapped.layers, piece.width, piece.height, shadowScale, snapped.variables),
      )
      const shadow = shadowOf(shrinkFloats(worked, made.width, made.height), made, shadowScale)
      if (shadow) {
        // The graphic at the back casts it, as the shadow of all of them lies behind them.
        const shadowed = snapped.layers.map((layer, i) =>
          i === 0 ? { ...layer, props: { ...layer.props, effects: [shadow] } } : layer,
        )
        const again = judge(seen, shadowed, snapped.variables)
        if (again.same) {
          snapped = { ...snapped, layers: shadowed }
          judged = again
        }
      }
    }
    last = judged
    if (judged.same && snapped.layers.length === pixels.length) {
      const fewer = withoutUnseen(seen, snapped.layers, pixels, snapped.variables)
      if (fewer) {
        snapped = { ...snapped, layers: fewer.layers }
        judged = fewer.judged
      }
    }
    if (judged.same) return layersAnswer(snapped.layers, judged.scores)
    // Tracing the shapes helps only where the difference lies on them.
    if (shapes && !onShapes(judged.detail, stacked, split.patchOf, split.width, split.height)) break
  }
  return last ? pictureAnswer('looksDifferent', last.scores) : pictureAnswer('tooManyParts')
}

/**
 * A piece at the size the rule judges it at, at most 512 px a side, and at the size it is cut into patches at, no
 * more than 512 × 512 pixels, which leaves a long piece more of its long side; with what the shrink to that size
 * loses, when the piece is shrunk to be cut.
 */
function sized(piece: Pixels): { small: Pixels; cutAt: Pixels; spread: Float32Array | null } {
  const at = (scale: number) =>
    [Math.max(1, Math.round(piece.width * scale)), Math.max(1, Math.round(piece.height * scale))] as const
  const scale = Math.min(1, LOOKS_SAME.maxSide / Math.max(piece.width, piece.height))
  const cut = Math.min(1, Math.sqrt(SHAPES.workPixels / (piece.width * piece.height)))
  if (cut >= 1) return { small: scale < 1 ? shrunk(piece, ...at(scale)) : piece, cutAt: piece, spread: null }
  // A piece no longer than the rule's size is cut at that size.
  if (cut <= scale) {
    const lossy = shrunkWithLoss(piece, ...at(scale))
    return { small: lossy.shrunk, cutAt: lossy.shrunk, spread: lossy.spread }
  }
  const lossy = shrunkWithLoss(piece, ...at(cut))
  return { small: scale < 1 ? shrunk(piece, ...at(scale)) : piece, cutAt: lossy.shrunk, spread: lossy.spread }
}

/**
 * What a job says is hidden of the pixels `piece` read under a piece's rect: the job's one bit a pixel of its
 * picture, as one byte a pixel of the piece. None when the job's bits are not the picture's size.
 */
function hiddenOf(hidden: string, picture: string, rect: Piece['rect'], piece: Pixels): Uint8Array | undefined {
  const size = readImageHeader(Uint8Array.from(atob(picture.slice(0, 44)), (char) => char.charCodeAt(0)))
  const bits = Uint8Array.from(atob(hidden), (char) => char.charCodeAt(0))
  if (!size || bits.length !== Math.ceil((size.width * size.height) / 8)) return undefined
  const x0 = Math.min(size.width - 1, Math.floor(rect.x))
  const y0 = Math.min(size.height - 1, Math.floor(rect.y))
  const out = new Uint8Array(piece.width * piece.height)
  for (let y = 0; y < piece.height; y++)
    for (let x = 0; x < piece.width; x++) {
      const at = (y0 + y) * size.width + x0 + x
      out[y * piece.width + x] = ((bits[at >> 3] ?? 0) >> (7 - (at & 7))) & 1
    }
  return out
}

/** The hidden pixels of a piece at a smaller size: a pixel there is hidden when its centre is; none when every pixel is. */
function hiddenAt(
  hidden: Uint8Array | undefined,
  piece: Pixels,
  small: { width: number; height: number },
): Uint8Array | undefined {
  if (!hidden || !hidden.includes(0)) return undefined
  if (small.width === piece.width && small.height === piece.height) return hidden
  const out = new Uint8Array(small.width * small.height)
  for (let y = 0; y < small.height; y++) {
    const from = Math.min(piece.height - 1, Math.floor(((y + 0.5) * piece.height) / small.height))
    for (let x = 0; x < small.width; x++)
      out[y * small.width + x] =
        hidden[from * piece.width + Math.min(piece.width - 1, Math.floor(((x + 0.5) * piece.width) / small.width))] ?? 0
  }
  return out
}

/**
 * Whether the differences the detail check saw lie on patches drawn as shapes: at least a share of the pixels seen
 * as different are such a patch's, or the check was not made.
 */
function onShapes(
  detail: Detail,
  stacked: readonly Stacked[],
  patchOf: Int32Array,
  width: number,
  height: number,
): boolean {
  if (detail.width <= 1) return true
  const shaped = new Set<number>()
  for (const s of stacked) if (s.primitive || s.regular || s.absorbed) shaped.add(s.patch.id)
  let different = 0
  let onShape = 0
  for (let y = 0; y < detail.height; y++) {
    const row = Math.min(height - 1, Math.floor(((y + 0.5) * height) / detail.height)) * width
    for (let x = 0; x < detail.width; x++) {
      if (!detail.different[y * detail.width + x]) continue
      different++
      if (shaped.has(patchOf[row + Math.min(width - 1, Math.floor(((x + 0.5) * width) / detail.width))] ?? 0)) onShape++
    }
  }
  return onShape >= SHAPES.onShapes * different
}
