// Laid out to fit: a layer copied from a frame of one size into a frame of another, every size it
// holds scaled with its box, and a text's scale raised to keep its letters readable.
import {
  type Constraints,
  LayerLimits,
  type LetterSpacing,
  type Rect,
  smallestLetters,
  type TextProps,
  TILE_SCALE,
} from '@dazbee/schema'

import { LEFT_TOP } from '../constraints.ts'
import { round } from '../geometry.ts'
import { scaled } from '../text-scale.ts'

export interface Size {
  width: number
  height: number
}
/** The sizes a text's style holds. */
interface TextStyleLike {
  fontSize: number
  letterSpacing?: LetterSpacing
  outline?: { width: number; color: string }
}
/** The parts of a text layer's props that hold sizes. */
interface TextLike {
  style?: TextStyleLike
  runs?: { style: Partial<TextStyleLike> }[]
  shrinkToFit?: { min: number; max: number }
  paragraphSpacing?: number
}
/** The part of a box's props that lays out its children. */
interface BoxLike {
  layout?: {
    gap: number
    lineGap?: number | undefined
    padding: { top: number; right: number; bottom: number; left: number }
  }
}
/** A layer's shape: a path's box it was drawn in, and the corners of a rect, polygon or star. */
interface ShapeLike {
  kind: string
  drawnIn?: Size
  cornerRadius?: number
  corners?: number[]
}
/** A paint, of which an image that tiles has a size. */
interface PaintLike {
  type: string
  fit?: string
  tileScale?: number
}
interface StrokeLike {
  paint: PaintLike
  width: number
  dashes?: number[]
  dashOffset?: number
}
/** A shadow, glow or blur: whichever of these sizes its type has. */
interface EffectLike {
  type: string
  x?: number
  y?: number
  blur?: number
  spread?: number
  radius?: number
}
/** The parts of a layer's props that hold sizes other than its box and its text. */
interface LookLike {
  shape?: ShapeLike
  cornerRadius?: number | number[]
  fills?: PaintLike[]
  strokes?: StrokeLike[]
  effects?: EffectLike[]
}

/** The side of a box a raised text grows from, along one axis. */
type Side = 'start' | 'end' | 'centre'

/** The most room, as a share of the frame's width, a raised text keeps from each of the frame's sides. */
const EDGE_ROOM = 1 / 10
/** The side each constraint keeps a raised text to as it grows. */
const KEPT_SIDE: Record<Constraints['horizontal'] | Constraints['vertical'], Side> = {
  left: 'start',
  top: 'start',
  right: 'end',
  bottom: 'end',
  center: 'centre',
  leftRight: 'centre',
  topBottom: 'centre',
  scale: 'centre',
}
/** The smallest font size a scaled text gets, so rounding never leaves it at 0. */
const MIN_FONT_SIZE = 0.01
/** The thinnest a scaled stroke gets, so rounding never leaves it at 0, which the schema refuses. */
const MIN_STROKE_WIDTH = 0.01
/** The shortest a stroke's longest dash gets when every dash would round to 0. */
const MIN_DASH = 0.01

/**
 * A layer's props laid out to fit a frame of `fit.to` from one of `fit.from`. `root` is the box, as it
 * was, of the copied root the layer is under (its own box for a root), whose centre leads it. Every
 * size the layer holds scales by the smaller ratio (`scaledSizes`).
 */
export function fitted<P extends Readonly<Record<string, unknown>>>(
  props: P,
  root: Rect,
  fit: { from: Size; to: Size },
): P {
  const { sx, sy } = ratios(fit)
  const s = smallerRatio(fit)
  const box = props as unknown as Rect
  const c = { x: root.x + root.width / 2, y: root.y + root.height / 2 }
  const d = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const centre = { x: c.x * sx + (d.x - c.x) * s, y: c.y * sy + (d.y - c.y) * s }
  const width = box.width * s
  const height = box.height * s
  return {
    ...scaledSizes(props, s),
    x: round(centre.x - width / 2),
    y: round(centre.y - height / 2),
    width: round(width),
    height: round(height),
  }
}

/**
 * The factor a frame of `from` is scaled by to fit one of `to`, keeping its shape: the smaller of
 * its two sides' ratios (`ratios`).
 */
export function smallerRatio(fit: { from: Size; to: Size }): number {
  const { sx, sy } = ratios(fit)
  return Math.min(sx, sy)
}

/**
 * The factor a text is scaled by in place of `s` so its smallest letters, at the least its shrink to
 * fit draws them, are at least `readable` once each of its sizes is rounded to hundredths: `s` for a
 * text they already are at that scale, and for one of only spaces.
 */
export function readableScale(props: TextProps, s: number, readable: number): number {
  const smallest = drawnSmallest(props)
  if (smallest === undefined || smallest * s >= readable) return s
  // Each size rounds on its own, so the least a shrink to fit draws a smaller run at may land a hair under; a hundredth more makes up for it.
  let target = Math.ceil(readable * 100) / 100
  while ((drawnSmallest(scaledSizes(props, target / smallest)) ?? readable) < readable) target += 0.01
  return target / smallest
}

/**
 * The box of a text whose sizes were raised `raise` times past the scale that gave it `scaled`, from
 * `props`, the box the rule placed it in, in a frame of `size`: `raise` times `scaled` along each
 * side, so its lines break where they did, or the placed box where that is larger. Its width is held
 * inside the frame, keeping from each side the room the placed box has on its nearer one, at most
 * EDGE_ROOM of the frame's width. A text held narrower than it wanted wraps into more lines, so its
 * box mode becomes auto height, and it is fitted to its words after; until then its height grows as
 * many times as the width it wanted is that width, rounded up. It grows from the side its
 * constraints keep to, from its centre for one kept to both, centred or scaled, and is moved back
 * inside the frame, at its top or left edge where it is taller or wider than the frame.
 */
export function readableBox(
  props: Rect & { constraints?: Constraints | undefined },
  scaled: Rect,
  raise: number,
  size: Size,
): Rect & { boxMode?: 'autoHeight' } {
  const { horizontal, vertical } = props.constraints ?? LEFT_TOP
  const margin = Math.max(0, Math.min(props.x, size.width - props.x - props.width, size.width * EDGE_ROOM))
  const wanted = Math.max(props.width, scaled.width * raise)
  const width = Math.max(props.width, Math.min(wanted, size.width - 2 * margin))
  const lines = wanted > width ? Math.ceil(wanted / width) : 1
  const height = Math.max(props.height, scaled.height * raise * lines)
  const x = grownFrom(KEPT_SIDE[horizontal], { at: props.x, was: props.width, to: width, room: size.width })
  const y = grownFrom(KEPT_SIDE[vertical], { at: props.y, was: props.height, to: height, room: size.height })
  const box = { x: round(x) + 0, y: round(y) + 0, width: round(width), height: round(height) }
  return lines > 1 ? { ...box, boxMode: 'autoHeight' } : box
}

/**
 * A layer's props with every size it holds scaled by `s`, as a uniform scale of the layer scales
 * them, each to hundredths; its box (x, y, width and height) is left for the caller to place. The
 * sizes: font sizes, letter spacing and outline width in a text's style and in each run that sets
 * them, paragraph spacing and shrink to fit's bounds; an auto layout box's gaps and paddings; the
 * least and most width and height; each stroke's width, dashes and dash offset; every corner
 * radius; each shadow's offset, blur and spread, each glow's blur and spread and each blur's
 * radius; and a tiled image's tile scale, kept inside `TILE_SCALE`. A path drawn at its own size is
 * given its box as the box it was drawn in, so its drawing scales with the box. Line height, a
 * multiple of the font size, stays. Each size keeps its schema's floor: a font size and a stroke
 * width stay above 0, and a stroke's dashes keep one length above 0. At a factor of 1 nothing
 * changes but a path's box it was drawn in.
 */
export function scaledSizes<P extends Readonly<Record<string, unknown>>>(props: P, s: number): P {
  if (s === 1) return { ...props, ...shaped(props as LookLike, s) }
  return {
    ...props,
    ...textSizes(props as TextLike, s),
    ...layout(props as BoxLike, s),
    ...limits(props as LayerLimits, s),
    ...look(props as LookLike, s),
  }
}

/**
 * Each side's ratio from `from` to `to`. A side 0 long in `from` or in `to` has no ratio of its own
 * and takes the other side's; with neither side having one, each is 1.
 */
function ratios({ from, to }: { from: Size; to: Size }): { sx: number; sy: number } {
  const x = from.width === 0 || to.width === 0 ? undefined : to.width / from.width
  const y = from.height === 0 || to.height === 0 ? undefined : to.height / from.height
  return { sx: x ?? y ?? 1, sy: y ?? x ?? 1 }
}

/**
 * A layer's shape: the corners of a rect, polygon or star scaled, and a path drawn at its own size
 * given its box as the box it was drawn in, so its drawing scales with the box; nothing for a layer
 * with neither.
 */
function shaped(props: LookLike & Partial<Size>, s: number): Partial<LookLike> {
  const was = props.shape
  if (!was) return {}
  const shape = { ...was }
  if (was.kind === 'path' && !was.drawnIn) shape.drawnIn = { width: props.width ?? 0, height: props.height ?? 0 }
  else if (s === 1 || (was.cornerRadius === undefined && !was.corners)) return {}
  if (was.cornerRadius !== undefined) shape.cornerRadius = length(was.cornerRadius, s)
  if (was.corners) shape.corners = was.corners.map((n) => length(n, s))
  return { shape }
}

/**
 * A text's font sizes, letter spacing and outline width, in its style and each run that sets them
 * (`scaled`, as a corner drag scales them), its paragraph spacing and its shrink-to-fit bounds;
 * nothing for other layers.
 */
function textSizes(text: TextLike, s: number): Partial<TextLike> {
  if (!text.style) return {}
  const size = (n: number) => Math.max(MIN_FONT_SIZE, scaledBy(n, s))
  const sized = <T extends Partial<TextStyleLike>>(style: T): T => {
    const out = scaled(style, s, (n) => round(n) + 0)
    return out.fontSize === undefined ? out : { ...out, fontSize: Math.max(MIN_FONT_SIZE, out.fontSize) }
  }
  const out: Partial<TextLike> = { style: sized(text.style) }
  if (text.runs) out.runs = text.runs.map((run) => ({ ...run, style: sized(run.style) }))
  if (text.shrinkToFit) out.shrinkToFit = { min: size(text.shrinkToFit.min), max: size(text.shrinkToFit.max) }
  if (text.paragraphSpacing !== undefined) out.paragraphSpacing = length(text.paragraphSpacing, s)
  return out
}

/** An auto layout box's gaps and paddings, scaled with its size so its children stay inside; nothing for other layers. */
function layout({ layout: was }: BoxLike, s: number): Partial<BoxLike> {
  if (!was) return {}
  const { top, right, bottom, left } = was.padding
  const by = (n: number) => scaledBy(n, s)
  const padding = { top: by(top), right: by(right), bottom: by(bottom), left: by(left) }
  const lineGap = was.lineGap === undefined ? {} : { lineGap: by(was.lineGap) }
  return { layout: { ...was, gap: by(was.gap), ...lineGap, padding } }
}

/** The least and most width and height a layer sets, scaled with its size; none it doesn't set. */
function limits(props: LayerLimits, s: number): LayerLimits {
  return Object.fromEntries(
    LayerLimits.keyof().options.flatMap((key) => (props[key] === undefined ? [] : [[key, length(props[key], s)]])),
  )
}

/** A layer's shape, corners, fills, strokes and effects scaled, each where the layer has it. */
function look(props: LookLike, s: number): Partial<LookLike> {
  const out: Partial<LookLike> = shaped(props, s)
  const { cornerRadius } = props
  if (cornerRadius !== undefined)
    out.cornerRadius = Array.isArray(cornerRadius) ? cornerRadius.map((n) => length(n, s)) : length(cornerRadius, s)
  if (props.fills) out.fills = props.fills.map((paint) => tiled(paint, s))
  if (props.strokes) out.strokes = props.strokes.map((stroke) => scaledStroke(stroke, s))
  if (props.effects) out.effects = props.effects.map((effect) => scaledEffect(effect, s))
  return out
}

/** `n` scaled by `s` to hundredths, never -0, which a store compares as unlike 0. */
function scaledBy(n: number, s: number) {
  return round(n * s) + 0
}

/** A length scaled by `s` to hundredths, at least 0. */
function length(n: number, s: number) {
  return Math.max(0, scaledBy(n, s))
}

/** An image that tiles at a tile scale, its tiles scaled inside `TILE_SCALE`; any other paint as it is. */
function tiled<T extends PaintLike>(paint: T, s: number): T {
  if (paint.type !== 'image' || paint.fit !== 'tile' || paint.tileScale === undefined) return paint
  return { ...paint, tileScale: Math.min(TILE_SCALE.max, Math.max(TILE_SCALE.min, scaledBy(paint.tileScale, s))) }
}

/** A stroke's width, dashes and dash offset scaled, and its paint's tiles. */
function scaledStroke<T extends StrokeLike>(stroke: T, s: number): T {
  const out = { ...stroke, paint: tiled(stroke.paint, s), width: Math.max(MIN_STROKE_WIDTH, scaledBy(stroke.width, s)) }
  if (stroke.dashes) out.dashes = scaledDashes(stroke.dashes, s)
  if (stroke.dashOffset !== undefined) out.dashOffset = scaledBy(stroke.dashOffset, s)
  return out
}

/**
 * A shadow's offset, blur and spread, a glow's blur and spread, a blur's radius, scaled. A drop
 * shadow's spread may be below 0 and stays so; every other blur, spread and radius stays at least 0.
 */
function scaledEffect<T extends EffectLike>(effect: T, s: number): T {
  const out = { ...effect }
  if (effect.x !== undefined) out.x = scaledBy(effect.x, s)
  if (effect.y !== undefined) out.y = scaledBy(effect.y, s)
  if (effect.blur !== undefined) out.blur = length(effect.blur, s)
  if (effect.radius !== undefined) out.radius = length(effect.radius, s)
  if (effect.spread !== undefined)
    out.spread = effect.type === 'dropShadow' ? scaledBy(effect.spread, s) : length(effect.spread, s)
  return out
}

/**
 * Dash and gap lengths scaled. When every length would round to 0 though one was above 0, the
 * longest becomes MIN_DASH and the others keep their share of it, rounded, so the stroke still
 * has a dash.
 */
function scaledDashes(dashes: number[], s: number): number[] {
  const out = dashes.map((n) => length(n, s))
  const longest = Math.max(0, ...dashes)
  if (longest === 0 || out.some((n) => n > 0)) return out
  return dashes.map((n) => length(MIN_DASH * n, 1 / longest))
}

/** The smallest letters of a text as it draws them at the least its shrink to fit allows; a curved text draws none. */
function drawnSmallest(props: TextProps): number | undefined {
  const fit = props.curve ? undefined : props.shrinkToFit
  return smallestLetters(props, fit ? fit.min / props.style.fontSize : 1)?.size
}

/**
 * Where a side `was` long at `at` starts once grown to `to`, kept at `keep`, then moved back inside
 * `room`: at its start when it is longer than the room.
 */
function grownFrom(keep: Side, { at, was, to, room }: { at: number; was: number; to: number; room: number }): number {
  const start = keep === 'start' ? at : keep === 'end' ? at + was - to : at + (was - to) / 2
  return Math.min(Math.max(start, 0), Math.max(0, room - to))
}
