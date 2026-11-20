import { z } from 'zod'

import { AssetId, Color, Point } from './primitives.ts'

/** How small and how big a tile may be, times the image's own size: 1 % to 1000 %. */
export const TILE_SCALE = { min: 0.01, max: 10 } as const

const GradientStop = z.object({ offset: z.number().min(0).max(1), color: Color })
const Stops = GradientStop.array().min(2)

/**
 * What every paint has (#219): an opacity of its own, on top of its colours' alpha, and whether it
 * shows. A hidden paint keeps its settings, so showing it again brings it back as it was. Left out,
 * a paint is opaque and shows.
 */
const paintCommon = { opacity: z.number().min(0).max(1).optional(), visible: z.boolean().optional() }

export const SolidPaint = z.object({ type: z.literal('solid'), color: Color, ...paintCommon })
export type SolidPaint = z.infer<typeof SolidPaint>

/**
 * Gradient geometry is in the layer's unit box: (0,0) top left, (1,1) bottom right. A radial is a
 * circle in any box, its radius a share of the box's shorter side, as CSS's closest-side.
 */
export const LinearPaint = z.object({ type: z.literal('linear'), from: Point, to: Point, stops: Stops, ...paintCommon })
export type LinearPaint = z.infer<typeof LinearPaint>
export const RadialPaint = z.object({
  type: z.literal('radial'),
  center: Point,
  radius: z.number().positive(),
  stops: Stops,
  ...paintCommon,
})
export type RadialPaint = z.infer<typeof RadialPaint>

/**
 * A conic sweep of colour about `center` (#43): offset 0 starts at `angle` degrees, turning
 * clockwise from pointing right, and the stops go once round to offset 1 back at the start.
 */
export const AngularPaint = z.object({
  type: z.literal('angular'),
  center: Point,
  angle: z.number().default(0),
  stops: Stops,
  ...paintCommon,
})
export type AngularPaint = z.infer<typeof AngularPaint>

/**
 * A crop is the fill's transform: the part of the image stretched over the layer's box, in image
 * pixels. It may reach past the image's edges, and the layer shows nothing there.
 */
export const ImageCrop = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
})
export type ImageCrop = z.infer<typeof ImageCrop>
/** How far to push each adjustment of an image fill (#48), from -100 to 100; 0 leaves it as it is. */
const Amount = z.number().min(-100).max(100).default(0)
export const ImageAdjust = z.object({
  /** Brighter or darker, up to a stop either way. */
  exposure: Amount,
  contrast: Amount,
  /** -100 is grey. */
  saturation: Amount,
  /** Warmer (more red, less blue) or cooler. */
  temperature: Amount,
  /** Towards magenta, or towards green. */
  tint: Amount,
})
export type ImageAdjust = z.infer<typeof ImageAdjust>
/** A look laid over an image fill after its adjustments (#48). */
export const ImageFilter = z.enum(['none', 'mono', 'sepia', 'vivid', 'fade', 'warm', 'cool'])
export type ImageFilter = z.infer<typeof ImageFilter>
/** How an image fill sits in its layer: covering it, whole inside it, cut to its crop, or repeated across it. */
export const ImageFit = z.enum(['fill', 'fit', 'crop', 'tile'])
export type ImageFit = z.infer<typeof ImageFit>
export const ImagePaint = z.object({
  type: z.literal('image'),
  assetId: AssetId,
  fit: ImageFit.default('fill'),
  crop: ImageCrop.optional(),
  opacity: z.number().min(0).max(1).default(1),
  visible: paintCommon.visible,
  adjust: ImageAdjust.optional(),
  filter: ImageFilter.optional(),
  /** How big a tile is, times the image's own size: 0.5 repeats it twice as often. Read only by tile; left out, 1. */
  tileScale: z.number().min(TILE_SCALE.min).max(TILE_SCALE.max).optional(),
})
export type ImagePaint = z.infer<typeof ImagePaint>

export const Paint = z.discriminatedUnion('type', [SolidPaint, LinearPaint, RadialPaint, AngularPaint, ImagePaint])
export type Paint = z.infer<typeof Paint>

/**
 * The fill a brand colour binding colours, and the look cards' colour shows: the topmost solid
 * fill that shows. -1 when there is none.
 */
export const boundFillIndex = (fills: readonly unknown[]) => topmostShowing(fills, 'solid')

/** The fill a brand logo binding draws its picture in: the topmost image fill that shows. -1 when there is none. */
export const boundImageIndex = (fills: readonly unknown[]) => topmostShowing(fills, 'image')

/** The fill a paint picker edits: the topmost one that shows, whatever its type. -1 when none shows. */
export const showingFillIndex = (fills: readonly Paint[]) => fills.findLastIndex((fill) => fill.visible !== false)

/** Fills with the one at `index` changed by `to`; at -1 there is none to change, so `to(added)` goes on top. */
export const changeFill = (
  fills: readonly Paint[],
  index: number,
  to: (fill: Paint) => Paint,
  added: Paint,
): Paint[] => (index < 0 ? [...fills, to(added)] : fills.map((fill, i) => (i === index ? to(fill) : fill)))

/**
 * A colour, `#rrggbb` in either case, painted on a fill, opaque and in upper case as the design
 * stores it: a solid keeps its other settings, and any other paint becomes a solid of it.
 */
export const paintColour =
  (hex: string) =>
  (fill: Paint): Paint => {
    const color = `${hex.toUpperCase()}FF`
    return fill.type === 'solid' ? { ...fill, color } : { type: 'solid', color }
  }

/** The index of the topmost fill of a type that shows; -1 when there is none. */
function topmostShowing(fills: readonly unknown[], type: Paint['type']) {
  return fills.findLastIndex(
    (f) => (f as { type?: unknown } | null)?.type === type && (f as { visible?: unknown }).visible !== false,
  )
}
