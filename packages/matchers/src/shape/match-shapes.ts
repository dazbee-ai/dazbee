// The shape matcher: a piece of flat drawing rebuilt as graphics a person can edit.
//
// The piece is cut into patches of one flat colour with sub-pixel outlines (`patches.ts`). The patches are stacked
// back to front, the largest outline first, and each becomes one graphic:
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
import {
  type LooksSameScores,
  type MatchAnswer,
  type MatchJob,
  type MatchKit,
  type Paint,
  type Piece,
  readImageHeader,
  type Rgb,
} from '@dazbee/schema'

import { ciede2000, srgbToLab } from '../looks-same/colour.ts'
import { farShare, LOOKS_SAME, shrunk } from '../looks-same/rule.ts'
import { layersAnswer, pictureAnswer } from './answer.ts'
import { snapToBrand } from './brand-snap.ts'
import { type Detail, detailOf, judgedScale } from './detail-check.ts'
import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { fitShape, type ShapeFit, shapeLayer } from './fit/fit-shapes.ts'
import { fitGradient, type GradientFit, gradientPaint, type InnerPixel } from './fit/gradient.ts'
import { type Point, tracedLoops } from './fit/trace.ts'
import { layerName, pathName } from './layer-names.ts'
import { hexColour } from './parts/colour.ts'
import { type FloatPicture, shrinkFloats, toFloatPicture } from './parts/float-picture.ts'
import { piecePixels } from './parts/piece-pixels.ts'
import { holds, type Loop, type Patch, splitPatches } from './patches.ts'
import { distanceTo, fitPrimitives, type Primitive, repeatsRound } from './primitives.ts'
import { shadowOf } from './shadow.ts'

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
  /** An outline is a primitive when its mean and 95th-percentile distance to it are within these: pixels, or a share of its shorter side when that is more. */
  meanPixels: 0.5,
  meanShare: 0.006,
  p95Pixels: 1.25,
  p95Share: 0.02,
  /** An ellipse is picked over a rectangle that is this many pixels closer or less. */
  roundWins: 0.05,
  /** And over a rectangle rounded into a circle that is this many pixels closer or less. */
  circleWins: 0.3,
  /** A ring is a shape's border when it is at most this share of the shape's shorter side wide. */
  borderShare: 0.25,
  /** A primitive may leave at most this share of its patch outside it, and hold at most this share of what isn't the patch or over it. */
  misfit: 0.02,
  /** A patch with more of its outline under other patches than this is traced as it shows. */
  mostFree: 0.6,
  /** Patches inside a hole close it when they fill at least this share of it. */
  closed: 0.9,
  /** A hole shows what lies under its patch when its colour is within this ΔE00 of that. */
  window: 5,
  /** Loose patches of one colour are one path when their alphas are within this of each other. */
  oneAlpha: 0.1,
  /** A primitive under this share of the piece is small; this many small ones of one colour, or more, are one path. */
  smallShare: 0.01,
  manySmall: 2,
  /** A graphic drawing under this share of the piece's pixels is small enough to go when nobody would miss it. */
  unseenShare: 0.005,
  /** A rectangle this thin, in pixels, and at least `lineLong` times as long is a line. */
  lineThin: 10,
  lineLong: 6,
  /** How far a traced path may stray from its outline, in piece pixels. */
  pathTolerance: 0.5,
  /** A patch is tried as a gradient when its colour spreads by this much (root mean square, of 255) and it holds this many pixels; about `gradientSamples` of them are read, and the gradient must be closer than the one colour by this mean ΔE00. */
  gradientSpread: 3,
  gradientPixels: 200,
  gradientSamples: 4000,
  gradientGain: 0.75,
  /** And a plane and a bowl over its pixels must explain this share of its change of colour. */
  gradientExplains: 0.3,
  /** A patch of this many pixels that repeats round its centre is fitted as a regular polygon or star: at most `regularSide` px on its long side, with this many drawings, and it is one when the shape covers it by this soft IoU. */
  regularPixels: 150,
  regularSide: 192,
  regularDraws: 80,
  regularHolds: 0.95,
  /** An outline holding at most this many pixels, or this share of its patch's largest, is a crumb. */
  crumbPixels: 6,
  crumbShare: 0.003,
  /** A fill under this alpha is see-through. */
  opaque: 0.97,
  /**
   * The rebuild may differ from the piece in a blob of at most this many pixels of the piece, and in a blob of
   * halo of at most `mostHalo`. In a piece judged enlarged the blob is counted in the enlarged pixels and may
   * hold this many times the enlargement to the power `enlargedBlob`: fewer of the piece's own pixels.
   */
  mostBlob: 12,
  mostHalo: 20,
  enlargedBlob: 1.5,
} as const

/**
 * The shape matcher's steps: the piece cut into patches, the patches made graphics, and the graphics judged by the
 * rule and the detail check; the last two are told again when the shapes are traced for a second try.
 */
export const SHAPE_STEPS = ['patches', 'graphics', 'judging'] as const
export type ShapeStep = (typeof SHAPE_STEPS)[number]

/** What a judged set of graphics scored. */
interface Judged {
  same: boolean
  scores: LooksSameScores
  detail: Detail
}

/** What the frame shows around a piece, which decides what of the piece a person sees. */
export interface Around {
  /** Per pixel of the piece, 1 where other layers of the frame cover it: nothing there is seen, so nothing there is matched or judged. */
  hidden?: Uint8Array
  /** The colour the frame shows behind the piece, which a see-through piece is judged over. */
  behind?: Rgb
}

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
 * picture, telling `step` as each step starts.
 */
export function matchShapesOf(
  ck: CanvasKit,
  piece: Pixels,
  colors: MatchKit['colors'],
  around: Around = {},
  step?: (step: ShapeStep) => void,
): MatchAnswer {
  step?.('patches')
  // The piece at the size it is judged at by the rule, which is the size it is cut into patches at too.
  const scale = Math.min(1, LOOKS_SAME.maxSide / Math.max(piece.width, piece.height))
  const small =
    scale < 1
      ? shrunk(piece, Math.max(1, Math.round(piece.width * scale)), Math.max(1, Math.round(piece.height * scale)))
      : piece
  // It is cut into patches at no more than 512 × 512 pixels, which leaves a long piece more of its long side.
  const cut = Math.min(1, Math.sqrt(SHAPES.workPixels / (piece.width * piece.height)))
  const worked = toFloatPicture(
    cut >= 1
      ? piece
      : cut <= scale
        ? small
        : shrunk(piece, Math.max(1, Math.round(piece.width * cut)), Math.max(1, Math.round(piece.height * cut))),
  )
  const hidden = hiddenAt(around.hidden, piece, worked)
  const seen: Seen = { ck, piece, small, hidden: hiddenAt(around.hidden, piece, small), around }
  const split = splitPatches(worked, hidden)
  if (!split) return pictureAnswer('tooManyParts')
  if (split.unexplained > SHAPES.mostUnexplained) return pictureAnswer('photo')
  const patches = split.patches.filter((r) => r.outline >= SHAPES.leastOutline)
  if (patches.length === 0) return pictureAnswer('looksDifferent')
  if (patches.length > SHAPES.mostPatches) return pictureAnswer('tooManyParts')
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
      if (shaped.has(patchOf[row + Math.min(width - 1, Math.floor(((x + 0.5) * width) / detail.width))]!)) onShape++
    }
  }
  return onShape >= SHAPES.onShapes * different
}

/** A piece as its rebuilds are judged: at its own size and at the rule's, with what other layers hide of it at that size. */
interface Seen {
  ck: CanvasKit
  piece: Pixels
  /** The piece at most 512 px on its long side; itself when it is no larger. */
  small: Pixels
  /** Per pixel of `small`, 1 where other layers cover the piece. */
  hidden: Uint8Array | undefined
  around: Around
}

/**
 * Judges graphics against their piece: the looks-the-same rule's far share, then no blob of difference in the
 * detail check. The graphics are drawn at the size they are judged at, never larger.
 */
function judge(seen: Seen, layers: readonly ShapeLayer[], variables?: Parameters<typeof drawGraphics>[5]): Judged {
  const { ck, piece, small, hidden, around } = seen
  const draw = (scale: number) => drawGraphics(ck, layers, piece.width, piece.height, scale, variables)
  let drawn = draw(small.width / piece.width)
  // A drawing that comes out another size than the rule's is made at the piece's own and shrunk.
  if (drawn.width !== small.width || drawn.height !== small.height) {
    drawn = shrunk(draw(1), small.width, small.height)
  }
  // What other layers hide is not seen: there the graphics are taken to draw what the piece shows.
  if (hidden) {
    const pixels = new Uint8Array(drawn.pixels)
    for (let i = 0; i < hidden.length; i++) if (hidden[i]) pixels.set(small.pixels.subarray(i * 4, i * 4 + 4), i * 4)
    drawn = { width: small.width, height: small.height, pixels }
  }
  const far = farShare(small, drawn)
  const scores = { far }
  // A rebuild the rule turns down needs no closer look.
  if (far > LOOKS_SAME.shape.far) return { same: false, scores, detail: NO_DETAIL }
  let detail: Detail
  if (judgedScale(piece) <= 1) detail = detailOf(small, drawn, around.behind)
  else {
    // A small piece is enlarged, and its graphics drawn again at that size, sharp; where it is hidden the piece
    // takes what they draw.
    let shown = piece
    if (hidden) {
      const pixels = new Uint8Array(piece.pixels)
      for (let i = 0; i < hidden.length; i++) if (hidden[i]) pixels.set(drawn.pixels.subarray(i * 4, i * 4 + 4), i * 4)
      shown = { width: piece.width, height: piece.height, pixels }
    }
    detail = detailOf(shown, draw, around.behind)
  }
  // An enlarged piece is allowed a smaller blob of its own pixels: enlarging shows what was too small to see.
  const size = detail.width / piece.width
  const blob = SHAPES.mostBlob * size ** (size > 1 ? SHAPES.enlargedBlob : 2)
  return { same: detail.blob <= blob && detail.halo <= SHAPES.mostHalo * size ** 2, scores, detail }
}

/** The detail check of a rebuild that wasn't looked at closely. */
const NO_DETAIL: Detail = { seen: 0, blob: 0, blobs: 0, width: 1, height: 1, different: new Uint8Array(1), halo: 0 }

/**
 * The graphics without the small ones nobody would miss, judged again, or null when every small one is seen.
 * Graphics drawing under a share of the piece's pixels are small; they go all at once when the piece then still
 * looks the same, and else by halves, each half that can go.
 */
function withoutUnseen(
  seen: Seen,
  layers: readonly ShapeLayer[],
  pixels: readonly number[],
  variables: Parameters<typeof drawGraphics>[5],
): { layers: ShapeLayer[]; judged: Judged } | null {
  const all = pixels.reduce((sum, count) => sum + count, 0)
  const small = layers.map((_, i) => i).filter((i) => pixels[i]! < SHAPES.unseenShare * all)
  if (small.length === 0 || small.length === layers.length) return null
  const without = (gone: readonly number[]) => {
    const kept = layers.filter((_, i) => !gone.includes(i))
    const judged = judge(seen, kept, variables)
    return judged.same ? { layers: kept, judged } : null
  }
  const whole = without(small)
  if (whole || small.length === 1) return whole
  const half = small.length >> 1
  const first = without(small.slice(0, half))
  const second = without(small.slice(half))
  return first && second ? (without(small) ?? first) : (first ?? second)
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
      out[y * piece.width + x] = (bits[at >> 3]! >> (7 - (at & 7))) & 1
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
        hidden[from * piece.width + Math.min(piece.width - 1, Math.floor(((x + 0.5) * piece.width) / small.width))]!
  }
  return out
}

/** A patch as it is stacked: what lies under it, which holes stay, and the shape it is when it is one. */
interface Stacked {
  patch: Patch
  /** The patch whose closed hole it lies in, when it lies in one. */
  parent: Patch | null
  /** It shows what is under the patch around it: no graphic of its own. */
  seenThrough: boolean
  /** Its outlines as a path keeps them: the outer ones and the holes that stay. */
  outer: Loop[]
  holes: Loop[]
  /** Whether a hole of it is closed over other patches, or it stands for other patches of its colour too. */
  closes: boolean
  /** Another patch of its colour stands for it: a surface cut in pieces by what lies on it, found whole. */
  absorbed: boolean
  primitive: { shape: Primitive; stroke: number } | null
  /** Its fill as a gradient, in worked pixels, when it shades as one. */
  gradient?: GradientFit | null
  /** The regular polygon or star it is, in worked pixels, when it is one. */
  regular?: ShapeFit | null
  /** It is the border of the shape that fills its hole: that shape, and the border's width in worked pixels. */
  border?: { filler: Stacked; width: number }
}

/** The patches back to front, each with its place among the others worked out. */
function stack(patches: readonly Patch[], patchOf: Int32Array, width: number, height: number): Stacked[] {
  const order = [...patches].sort((a, b) => b.outline - a.outline || b.area - a.area)
  const rank = new Int32Array(Math.max(0, ...patches.map((r) => r.id)) + 1).fill(-1)
  order.forEach((r, i) => (rank[r.id] = i))
  const stacked: Stacked[] = order.map((patch) => ({
    patch,
    parent: null,
    seenThrough: false,
    outer: patch.loops.filter((loop) => loop.area > 0),
    holes: patch.loops.filter((loop) => loop.area < 0),
    closes: false,
    absorbed: false,
    primitive: null,
  }))
  // Each patch's parent: the smallest patch with a hole that holds it.
  const boxes = stacked.map((s) => s.holes.map(boxOf))
  for (let i = 0; i < stacked.length; i++) {
    const { patch } = stacked[i]!
    const px = patch.seed[0] + 0.5
    const py = patch.seed[1] + 0.5
    for (let j = i - 1; j >= 0; j--) {
      const candidate = stacked[j]!
      const b = candidate.patch.box
      if (px < b.x0 || px > b.x1 + 1 || py < b.y0 || py > b.y1 + 1) continue
      const holding = candidate.holes.some((hole, k) => {
        const hb = boxes[j]![k]!
        return px >= hb.x0 && px <= hb.x1 && py >= hb.y0 && py <= hb.y1 && holds(hole.points, px, py)
      })
      if (holding) {
        stacked[i]!.parent = candidate.patch
        break
      }
    }
  }
  const of = new Map(stacked.map((s) => [s.patch.id, s]))
  const lab = new Map(stacked.map((s) => [s.patch.id, srgbToLab(...s.patch.rgb)]))
  // From the back: a patch the colour of what lies under the patch around it is that patch's hole.
  for (const s of stacked) {
    const around = s.parent ? of.get(s.parent.id)! : null
    if (!around || around.seenThrough) continue
    const under = around.parent
    if (under && ciede2000(lab.get(s.patch.id)!, lab.get(under.id)!) <= SHAPES.window) s.seenThrough = true
  }
  const closed = new Map<Stacked, { hole: Loop; inside: Stacked[] }[]>()
  for (const [j, s] of stacked.entries()) {
    // A hole stays when smaller patches don't fill it, or it holds a patch seen through; else they close it.
    const kept: Loop[] = []
    for (const [k, hole] of s.holes.entries()) {
      const hb = boxes[j]![k]!
      const inside = stacked.filter(
        (other) =>
          other.parent === s.patch &&
          other.patch.seed[0] + 0.5 >= hb.x0 &&
          other.patch.seed[0] + 0.5 <= hb.x1 &&
          holds(hole.points, other.patch.seed[0] + 0.5, other.patch.seed[1] + 0.5),
      )
      const covered = inside.reduce((sum, other) => sum + other.patch.outline, 0)
      if (covered < SHAPES.closed * -hole.area || inside.some((other) => other.seenThrough)) kept.push(hole)
      else {
        s.closes = true
        closed.set(s, [...(closed.get(s) ?? []), { hole, inside }])
      }
    }
    s.holes = kept
  }
  for (const s of stacked) if (!s.seenThrough) s.primitive = primitiveOf(s, rank, patchOf, width, height)
  // A ring whose one hole one shape of its own kind fills, evenly inside it, is that shape's border: the two are
  // one graphic, filled with the inner shape's colour and stroked with the ring's.
  for (const s of stacked) {
    const holes = closed.get(s)
    if (!s.primitive || s.primitive.stroke || s.holes.length || holes?.length !== 1) continue
    const { hole, inside } = holes[0]!
    const filler = inside.length === 1 ? inside[0]! : null
    if (!filler?.primitive || filler.primitive.stroke || filler.primitive.shape.kind !== s.primitive.shape.kind)
      continue
    const outer = s.primitive.shape
    const inner = fitPrimitives(hole.points)
      .filter((p) => p.kind === outer.kind && close(p))
      .sort(closest)[0]
    if (!inner) continue
    const across = (outer.width - inner.width) / 2
    const down = (outer.height - inner.height) / 2
    const stroke = (across + down) / 2
    const even = Math.max(1, 0.2 * stroke)
    if (Math.abs(across - down) > even || Math.hypot(outer.cx - inner.cx, outer.cy - inner.cy) > even) continue
    if (stroke > SHAPES.borderShare * Math.min(outer.width, outer.height)) continue
    s.border = { filler, width: stroke }
    filler.absorbed = true
  }
  // Patchs of one colour that smaller patches cut apart are one surface when one primitive holds them all: the
  // largest of them stands for it, under what lies on it.
  const surfaces = new Map<string, Stacked[]>()
  for (const s of stacked) {
    if (s.seenThrough) continue
    const key = `${s.parent?.id ?? -1} ${s.patch.colour} ${Math.round(s.patch.alpha * 10)}`
    const list = surfaces.get(key)
    if (list) list.push(s)
    else surfaces.set(key, [s])
  }
  for (const members of surfaces.values()) {
    if (members.length < 2 || members.some((m) => m.holes.length > 0)) continue
    const first = members[0]!
    const shape = shapeOf(
      members.flatMap((m) => m.outer),
      new Set(members.map((m) => m.patch.id)),
      members.reduce((sum, m) => sum + m.patch.area, 0),
      rank[first.patch.id]!,
      rank,
      patchOf,
      width,
      height,
    )
    if (!shape) continue
    first.primitive = { shape, stroke: 0 }
    first.closes = true
    for (const m of members.slice(1)) m.absorbed = true
  }
  return stacked
}

function boxOf(loop: Loop) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let k = 0; k < loop.points.length; k += 2) {
    const x = loop.points[k]!
    const y = loop.points[k + 1]!
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }
  return { x0, y0, x1, y1 }
}

/** Whether an outline keeps close enough to a primitive to be one. */
function close(p: Primitive): boolean {
  const least = Math.min(p.width, p.height)
  return (
    p.mean <= Math.max(SHAPES.meanPixels, SHAPES.meanShare * least) &&
    p.p95 <= Math.max(SHAPES.p95Pixels, SHAPES.p95Share * least)
  )
}

/** Orders primitives by how close their outline keeps to them; an ellipse wins a tie, as a circle is one. */
function closest(a: Primitive, b: Primitive): number {
  // A rectangle rounded all the way and as wide as it is tall is a circle drawn the long way round.
  const round = (p: Primitive) =>
    p.kind === 'rect' &&
    Math.abs(p.width - p.height) <= 0.03 * Math.max(p.width, p.height) &&
    Math.min(...p.corners) >= 0.9 * (Math.min(p.width, p.height) / 2)
  const tie = (p: Primitive, other: Primitive) =>
    p.kind === 'ellipse' ? (round(other) ? SHAPES.circleWins : SHAPES.roundWins) : 0
  return a.mean - tie(a, b) - (b.mean - tie(b, a))
}

/**
 * The primitive that outlines of patches `ids`, of `area` pixels in all, keep to, which holds those patches and
 * little else, or null. A
 * point of an outline is free, and not counted, where a patch smaller than the one ranked `own` lies on the other
 * side of it: the shape may run under that patch.
 */
function shapeOf(
  outlines: readonly Loop[],
  ids: ReadonlySet<number>,
  area: number,
  own: number,
  rank: Int32Array,
  patchOf: Int32Array,
  width: number,
  height: number,
  hollow?: Loop,
): Primitive | null {
  let count = 0
  for (const outline of outlines) count += outline.points.length / 2
  const points = new Float32Array(count * 2)
  const free = new Uint8Array(count)
  let at = 0
  let freed = 0
  for (const outline of outlines) {
    points.set(outline.points, at * 2)
    for (let k = 0; k < outline.points.length / 2; k++, at++) {
      const x = outline.points[k * 2]!
      const y = outline.points[k * 2 + 1]!
      for (const [dx, dy] of [
        [-0.5, -0.5],
        [0.5, -0.5],
        [-0.5, 0.5],
        [0.5, 0.5],
      ] as const) {
        const xx = Math.floor(x + dx)
        const yy = Math.floor(y + dy)
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
        const other = patchOf[yy * width + xx]!
        if (other >= 0 && !ids.has(other) && rank[other]! > own) free[at] = 1
      }
      freed += free[at]!
    }
  }
  if (freed > SHAPES.mostFree * count) return null
  const shape = fitPrimitives(points, freed ? free : undefined)
    .filter(close)
    .sort(closest)[0]
  if (!shape) return null
  // It must hold the patches, and what else it covers must lie under smaller patches.
  const reach = Math.hypot(shape.width, shape.height) / 2
  const x0 = Math.max(0, Math.floor(shape.cx - reach))
  const y0 = Math.max(0, Math.floor(shape.cy - reach))
  const x1 = Math.min(width - 1, Math.ceil(shape.cx + reach))
  const y1 = Math.min(height - 1, Math.ceil(shape.cy + reach))
  const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0 + 1) * (y1 - y0 + 1)) / 10_000)))
  let inside = 0
  let wrong = 0
  let held = 0
  for (let y = y0; y <= y1; y += step)
    for (let x = x0; x <= x1; x += step) {
      const other = patchOf[y * width + x]!
      const d = distanceTo(shape, x + 0.5, y + 0.5)
      if (d < 1 && ids.has(other)) held++
      if (d < -1) {
        // What a kept hole shows is no part of the shape.
        if (hollow && !ids.has(other) && holds(hollow.points, x + 0.5, y + 0.5)) continue
        inside++
        if (!ids.has(other) && (other < 0 || rank[other]! < own)) wrong++
      }
    }
  return held * step * step >= (1 - SHAPES.misfit) * area && wrong <= SHAPES.misfit * inside ? shape : null
}

/** The primitive a stacked patch is, with its stroke's width when it is an outline, or null when it is none. */
function primitiveOf(
  s: Stacked,
  rank: Int32Array,
  patchOf: Int32Array,
  width: number,
  height: number,
): Stacked['primitive'] {
  // Crumbs, the specks of outline a noisy edge leaves beside a shape or in it, make it no less of a shape.
  const largest = Math.max(0, ...s.outer.map((loop) => loop.area))
  const crumb = Math.max(SHAPES.crumbPixels, SHAPES.crumbShare * largest)
  const outer = s.outer.filter((loop) => loop.area > crumb)
  const holes = s.holes.filter((loop) => -loop.area > crumb)
  if (outer.length !== 1 || holes.length > 1) return null
  const shape = shapeOf(
    outer,
    new Set([s.patch.id]),
    s.patch.area,
    rank[s.patch.id]!,
    rank,
    patchOf,
    width,
    height,
    holes[0],
  )
  if (!shape) return null
  if (holes.length === 0) return { shape, stroke: 0 }
  // One hole of the same shape, evenly inside the outline, makes it an outline stroke.
  const inner = fitPrimitives(holes[0]!.points)
    .filter((p) => p.kind === shape.kind && close(p))
    .sort(closest)[0]
  if (!inner) return null
  const across = (shape.width - inner.width) / 2
  const down = (shape.height - inner.height) / 2
  const stroke = (across + down) / 2
  const even = Math.max(1, 0.2 * stroke)
  if (Math.abs(across - down) > even || Math.hypot(shape.cx - inner.cx, shape.cy - inner.cy) > even) return null
  return { shape, stroke }
}

/**
 * The graphics of stacked patches, back to front, in piece pixels (`grow` piece pixels to a worked one). With
 * `shapes` a patch that is a primitive is drawn as one; without, every patch is traced.
 */
function graphicsOf(
  stacked: readonly Stacked[],
  shapes: boolean,
  grow: number,
): { layers: ShapeLayer[]; pixels: number[] } {
  const layers: { at: number; layer: ShapeLayer; pixels: number }[] = []
  // Loose patches close no hole over others, so patches of one colour can be drawn together as one path wherever
  // the frontmost of them goes.
  const loose: { at: number; s: Stacked }[] = []
  let covered = 0
  stacked.forEach((s, at) => {
    if (s.seenThrough || s.absorbed) return
    covered += s.patch.area
    if (!s.closes && !(shapes && s.regular)) loose.push({ at, s })
    else if (shapes && s.primitive) layers.push({ at, layer: primitiveLayer(s, grow), pixels: s.patch.area })
    else if (shapes && s.regular) layers.push({ at, layer: regularLayer(s, grow), pixels: s.patch.area })
    else {
      const layer = pathOf([s], grow)
      if (layer) layers.push({ at, layer, pixels: s.patch.area })
    }
  })
  const grouped = new Uint8Array(loose.length)
  for (let i = 0; i < loose.length; i++) {
    if (grouped[i]) continue
    const members = [loose[i]!]
    for (let j = i + 1; j < loose.length; j++) {
      if (grouped[j] || loose[j]!.s.parent !== loose[i]!.s.parent) continue
      if (Math.abs(loose[j]!.s.patch.alpha - loose[i]!.s.patch.alpha) > SHAPES.oneAlpha) continue
      if (loose[j]!.s.patch.colour !== loose[i]!.s.patch.colour) continue
      grouped[j] = 1
      members.push(loose[j]!)
    }
    // Of one colour's patches, a primitive stands as a shape of its own when it is larger than every traced one;
    // with none traced, small primitives stand alone only while they are few (a row of dots is one path).
    const traced = members.filter((m) => !shapes || !m.s.primitive)
    const primitives = members.filter((m) => shapes && m.s.primitive)
    const largest = Math.max(0, ...traced.map((m) => m.s.patch.outline))
    const small = primitives.filter((m) => m.s.patch.outline < SHAPES.smallShare * covered)
    const alone = traced.length
      ? primitives.filter((m) => m.s.patch.outline >= largest)
      : small.length >= SHAPES.manySmall
        ? primitives.filter((m) => !small.includes(m))
        : primitives
    for (const m of alone) layers.push({ at: m.at, layer: primitiveLayer(m.s, grow), pixels: m.s.patch.area })
    const together = members.filter((m) => !alone.includes(m))
    if (together.length === 0) continue
    const layer = pathOf(
      together.map((m) => m.s),
      grow,
    )
    if (layer)
      layers.push({
        at: Math.max(...together.map((m) => m.at)),
        layer,
        pixels: together.reduce((sum, m) => sum + m.s.patch.area, 0),
      })
  }
  layers.sort((a, b) => a.at - b.at)
  return { layers: layers.map(({ layer }) => layer), pixels: layers.map((entry) => entry.pixels) }
}

/**
 * The regular polygon or star a stacked patch is, or null: a patch that is no rectangle or ellipse, has no hole
 * and repeats round its centre is fitted by drawing, at a small size, and is one when the shape
 * drawn covers it well.
 */
function regularOf(ck: CanvasKit, s: Stacked, patchOf: Int32Array, width: number): ShapeFit | null {
  if (s.seenThrough || s.primitive || s.outer.length !== 1 || s.holes.length > 0) return null
  if (s.patch.area < SHAPES.regularPixels || !repeatsRound(s.outer[0]!.points)) return null
  const { x0, y0, x1, y1 } = s.patch.box
  const scale = Math.min(1, SHAPES.regularSide / Math.max(x1 - x0 + 1, y1 - y0 + 1))
  const pad = 3
  const w = Math.ceil((x1 - x0 + 1) * scale) + 2 * pad
  const h = Math.ceil((y1 - y0 + 1) * scale) + 2 * pad
  const mask = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const xx = Math.floor(x0 + (x - pad + 0.5) / scale)
      const yy = Math.floor(y0 + (y - pad + 0.5) / scale)
      if (xx < x0 || yy < y0 || xx > x1 || yy > y1) continue
      if (patchOf[yy * width + xx] === s.patch.id) mask[y * w + x] = 1
    }
  const fitted = fitShape(
    ck,
    {
      width: w,
      height: h,
      mask,
      scale,
      pieceWidth: w / scale,
      pieceHeight: h / scale,
      offsetX: x0 - pad / scale,
      offsetY: y0 - pad / scale,
    },
    { draws: SHAPES.regularDraws, kinds: ['polygon', 'star'] },
  )
  return fitted.iou >= SHAPES.regularHolds ? fitted.fit : null
}

/**
 * A patch's fill as a gradient, when its colour changes across it as a gradient's does and one is clearly closer
 * to its inner pixels than its one colour is; null when not. A patch too even or too small is not read, and
 * neither is one whose colour's change is grain: where a plane and a bowl over its pixels (the least-squares fit
 * of each channel on x, y and x² + y²) explain too little of the change.
 */
export function gradientOf(
  patch: Patch,
  picture: FloatPicture,
  patchOf: Int32Array,
  hidden?: Uint8Array,
): GradientFit | null {
  if (patch.spread < SHAPES.gradientSpread || patch.area < SHAPES.gradientPixels) return null
  const { width, data } = picture
  const step = Math.max(1, Math.floor(Math.sqrt(patch.area / SHAPES.gradientSamples)))
  const pixels: InnerPixel[] = []
  for (let y = patch.box.y0 + (step >> 1); y <= patch.box.y1; y += step)
    for (let x = patch.box.x0 + (step >> 1); x <= patch.box.x1; x += step) {
      const i = y * width + x
      if (patchOf[i] !== patch.id || hidden?.[i]) continue
      // An inner pixel: its neighbours are the patch's too, so it is no mix with another colour.
      if (patchOf[i - 1] !== patch.id || patchOf[i + 1] !== patch.id) continue
      if (patchOf[i - width] !== patch.id || patchOf[i + width] !== patch.id) continue
      pixels.push({ x: x + 0.5, y: y + 0.5, rgb: [data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!] })
    }
  if (pixels.length < 30 || explainedBySurface(pixels, patch) < SHAPES.gradientExplains) return null
  const flat = srgbToLab(...patch.rgb)
  let error = 0
  for (const p of pixels) error += ciede2000(flat, srgbToLab(...p.rgb))
  const gradient = fitGradient(pixels, 1)
  return gradient && gradient.error <= error / pixels.length - SHAPES.gradientGain ? gradient : null
}

/**
 * The share of the pixels' change of colour that a plane and a bowl explain: each channel fitted by least squares
 * on 1, x, y and x² + y², with x and y from the patch's box's centre in units of its longer side.
 */
function explainedBySurface(pixels: readonly InnerPixel[], patch: Patch): number {
  const cx = (patch.box.x0 + patch.box.x1 + 1) / 2
  const cy = (patch.box.y0 + patch.box.y1 + 1) / 2
  const unit = Math.max(patch.box.x1 - patch.box.x0 + 1, patch.box.y1 - patch.box.y0 + 1)
  // The normal equations: A (4 × 4, symmetric) and one right side a channel.
  const a = new Float64Array(16)
  const b = [new Float64Array(4), new Float64Array(4), new Float64Array(4)]
  const mean = [0, 0, 0]
  const basis = new Float64Array(4)
  for (const p of pixels) {
    const x = (p.x - cx) / unit
    const y = (p.y - cy) / unit
    basis[0] = 1
    basis[1] = x
    basis[2] = y
    basis[3] = x * x + y * y
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) a[r * 4 + c] = a[r * 4 + c]! + basis[r]! * basis[c]!
      for (let k = 0; k < 3; k++) b[k]![r] = b[k]![r]! + basis[r]! * p.rgb[k]!
    }
    for (let k = 0; k < 3; k++) mean[k] = mean[k]! + p.rgb[k]!
  }
  let total = 0
  let explained = 0
  for (let k = 0; k < 3; k++) {
    const m = mean[k]! / pixels.length
    const weights = solved(a, b[k]!)
    if (!weights) return 0
    // The squares the fit explains are its weights times the right side, less the mean's.
    let fitted = 0
    for (let r = 0; r < 4; r++) fitted += weights[r]! * b[k]![r]!
    let squares = 0
    for (const p of pixels) squares += p.rgb[k]! ** 2
    total += squares - pixels.length * m * m
    explained += fitted - pixels.length * m * m
  }
  return total > 1e-9 ? Math.max(0, explained / total) : 0
}

/** The solution of a 4 × 4 system by elimination with pivoting, or null when it has none. */
function solved(matrix: Float64Array, right: Float64Array): Float64Array | null {
  const m = Float64Array.from(matrix)
  const x = Float64Array.from(right)
  for (let col = 0; col < 4; col++) {
    let pivot = col
    for (let row = col + 1; row < 4; row++) if (Math.abs(m[row * 4 + col]!) > Math.abs(m[pivot * 4 + col]!)) pivot = row
    if (Math.abs(m[pivot * 4 + col]!) < 1e-12) return null
    if (pivot !== col) {
      for (let c = 0; c < 4; c++) [m[col * 4 + c], m[pivot * 4 + c]] = [m[pivot * 4 + c]!, m[col * 4 + c]!]
      ;[x[col], x[pivot]] = [x[pivot]!, x[col]!]
    }
    for (let row = col + 1; row < 4; row++) {
      const factor = m[row * 4 + col]! / m[col * 4 + col]!
      for (let c = col; c < 4; c++) m[row * 4 + c] = m[row * 4 + c]! - factor * m[col * 4 + c]!
      x[row] = x[row]! - factor * x[col]!
    }
  }
  for (let row = 3; row >= 0; row--) {
    for (let c = row + 1; c < 4; c++) x[row] = x[row]! - m[row * 4 + c]! * x[c]!
    x[row] = x[row]! / m[row * 4 + row]!
  }
  return x
}

/** A patch's flat paint: its colour, see-through by its alpha when that is under 0.97. */
function paintOf(rgb: readonly [number, number, number], alpha: number): Paint {
  const color = hexColour(rgb[0], rgb[1], rgb[2])
  return alpha < SHAPES.opaque
    ? { type: 'solid', color, opacity: Math.round(alpha * 1000) / 1000 }
    : { type: 'solid', color }
}

/** A patch's regular polygon or star as a graphic, in piece pixels. */
function regularLayer(s: Stacked, grow: number): ShapeLayer {
  const fit = s.regular!
  const grown: ShapeFit = {
    ...fit,
    cx: fit.cx * grow,
    cy: fit.cy * grow,
    width: fit.width * grow,
    height: fit.height * grow,
    radius: fit.radius * grow,
  }
  return shapeLayer(grown, paintOf(s.patch.rgb, s.patch.alpha), layerName(s.patch.rgb, grown, false))
}

/** A stacked patch's gradient as the paint of a graphic with this box, in piece pixels, or null when it has none. */
function gradientFill(
  s: Stacked,
  box: { x: number; y: number; width: number; height: number },
  grow: number,
): Paint | null {
  if (!s.gradient) return null
  const { from, to } = s.gradient
  const paint = gradientPaint(
    { ...s.gradient, from: [from[0] * grow, from[1] * grow], to: [to[0] * grow, to[1] * grow] },
    box,
  )
  return s.patch.alpha < SHAPES.opaque ? { ...paint, opacity: Math.round(s.patch.alpha * 1000) / 1000 } : paint
}

/** Patchs of one colour as one path: their outer outlines and kept holes, traced. */
function pathOf(members: readonly Stacked[], grow: number): ShapeLayer | null {
  const loops: Point[][] = []
  let area = 0
  const rgb: [number, number, number] = [0, 0, 0]
  let alpha = 0
  for (const { patch, outer, holes } of members) {
    for (const loop of [...outer, ...holes]) {
      if (Math.abs(loop.area) < 1) continue
      const points: Point[] = []
      for (let k = 0; k < loop.points.length; k += 2) points.push([loop.points[k]! * grow, loop.points[k + 1]! * grow])
      loops.push(points)
    }
    area += patch.area
    for (let c = 0; c < 3; c++) rgb[c] = rgb[c]! + patch.rgb[c]! * patch.area
    alpha += patch.alpha * patch.area
  }
  const traced = tracedLoops(loops, SHAPES.pathTolerance)
  if (!traced || area === 0) return null
  const colour: [number, number, number] = [rgb[0] / area, rgb[1] / area, rgb[2] / area]
  const { box } = traced
  return {
    type: 'graphic',
    name: pathName(colour),
    props: {
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      rotation: 0,
      shape: { kind: 'path', d: traced.d, fillRule: 'evenodd', drawnIn: { width: box.width, height: box.height } },
      fills: [(members.length === 1 ? gradientFill(members[0]!, box, grow) : null) ?? paintOf(colour, alpha / area)],
      strokes: [],
    },
  }
}

/** A patch's primitive as a graphic: a line when it is long and thin, an outline stroke when it has one, else filled. */
function primitiveLayer(s: Stacked, grow: number): ShapeLayer {
  const { shape, stroke } = s.primitive!
  const flat = paintOf(s.patch.rgb, s.patch.alpha)
  const width = shape.width * grow
  const height = shape.height * grow
  const corners = shape.corners.map((r) => Math.round(r * grow * 100) / 100) as [number, number, number, number]
  const oneRadius = corners.every((r) => r === corners[0])
  const named: ShapeFit = {
    kind: shape.kind,
    cx: shape.cx * grow,
    cy: shape.cy * grow,
    width,
    height,
    rotation: shape.rotation,
    radius: Math.max(...corners),
    count: 0,
    innerRadius: 0.5,
    stroke: stroke * grow,
    strokeOnly: stroke > 0,
  }
  const box = { x: named.cx - width / 2, y: named.cy - height / 2, width, height, rotation: shape.rotation }
  const paint = shape.rotation === 0 && !stroke ? (gradientFill(s, box, grow) ?? flat) : flat
  const thin = Math.min(width, height)
  const long = Math.max(width, height)
  if (
    shape.kind === 'rect' &&
    !stroke &&
    thin <= SHAPES.lineThin &&
    long >= SHAPES.lineLong * thin &&
    named.radius === 0
  ) {
    const along = width >= height
    return {
      type: 'graphic',
      name: layerName(s.patch.rgb, { ...named, kind: 'line' }, false),
      props: {
        x: named.cx - long / 2,
        y: named.cy - thin / 2,
        width: long,
        height: thin,
        rotation: along ? shape.rotation : shape.rotation + 90,
        shape: { kind: 'line', start: 'none', end: 'none' },
        fills: [],
        strokes: [{ paint, width: thin, align: 'center', cap: 'butt' }],
      },
    }
  }
  return {
    type: 'graphic',
    name: layerName(s.patch.rgb, named, false),
    props: {
      ...box,
      shape:
        shape.kind === 'ellipse'
          ? { kind: 'ellipse' }
          : oneRadius
            ? { kind: 'rect', cornerRadius: corners[0] }
            : { kind: 'rect', cornerRadius: 0, corners },
      fills: s.border ? [paintOf(s.border.filler.patch.rgb, s.border.filler.patch.alpha)] : stroke ? [] : [paint],
      strokes: s.border
        ? [{ paint: flat, width: s.border.width * grow, align: 'inside' }]
        : stroke
          ? [{ paint, width: stroke * grow, align: 'inside' }]
          : [],
    },
  }
}
