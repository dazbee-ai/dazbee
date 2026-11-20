import { z } from 'zod'

import { Effect } from './effects.ts'
import { Paint } from './paint.ts'
import { BlendMode, Color, ContainerBlendMode, FractionalIndex, FrameId, LinkId, NodeId } from './primitives.ts'
import { Features, LetterSpacing, NO_LETTER_SPACING } from './typography.ts'
import { Bindings } from './variables.ts'

/**
 * How a layer follows its parent's edges when the parent, a frame or a box, is resized: across,
 * keeping its left, its right, both, its centre, or scaling with the parent; down likewise. Read
 * only where the parent is a frame or a box (in a laid-out box, only for a layer its flow doesn't
 * place); a layer in a group or a boolean scales with it instead.
 */
export const Constraints = z.object({
  horizontal: z.enum(['left', 'right', 'leftRight', 'center', 'scale']),
  vertical: z.enum(['top', 'bottom', 'topBottom', 'center', 'scale']),
})
export type Constraints = z.infer<typeof Constraints>

/** Properties every layer has. */
const commonProps = {
  x: z.number(),
  y: z.number(),
  width: z.number().min(0),
  height: z.number().min(0),
  rotation: z.number().default(0),
  visible: z.boolean().default(true),
  opacity: z.number().min(0).max(1).default(1),
  blendMode: BlendMode.default('normal'),
  effects: Effect.array().default([]),
  /**
   * How the layer sizes along each axis inside an auto layout box, or, for such a box and for
   * text, on its own (#46): fixed at its width or height, hugging what it holds, or filling the
   * room its auto layout parent leaves. Left out, text hugs as its box mode says and the rest is fixed.
   */
  sizing: z.object({ width: z.enum(['fixed', 'hug', 'fill']), height: z.enum(['fixed', 'hug', 'fill']) }).optional(),
  /** Inside an auto layout box, stays where it is put instead of taking its turn in the flow (#46). */
  absolute: z.boolean().optional(),
  /**
   * Makes the layer a mask (#48): it is not drawn, and the layers after it in the same parent, up
   * to the next mask, show only where it is opaque (`alpha`) or bright (`luminance`).
   */
  mask: z.enum(['alpha', 'luminance']).optional(),
  /** How the layer follows its parent's edges when the parent is resized; left out, it keeps to the left and top. */
  constraints: Constraints.optional(),
}

/**
 * Mirrors what the layer draws itself (a graphic's shape, a box's corners and clip, its fills,
 * strokes, image and glyphs) across its own vertical (`flipX`) or horizontal (`flipY`) centre line,
 * before its rotation turns it. Never the layers inside it, so a boolean's outline, made of the
 * shapes inside it, isn't mirrored by its own flag; and never its shadows' offsets. Left out, the
 * layer is not flipped.
 */
const flips = {
  flipX: z.boolean().optional(),
  flipY: z.boolean().optional(),
}

/**
 * Lock ratio: the editor's resizes keep the layer's width to its height, a drag of the handles
 * while it is the one layer selected (with its linked copies whose ratio is locked too) and a width
 * or height typed in Position. A command sets the sizes it is given. Left out while off. Graphics, texts and boxes have it; groups and booleans take
 * their box from what they hold.
 */
const ratio = { lockRatio: z.boolean().optional() }

const limit = z.number().min(0).optional()

/**
 * The least and most a layer's width and height may be wherever auto layout sizes it: in a flow,
 * and a laid-out box's own size wherever it sits. Each side is clamped between them, the least
 * winning where they cross. Left out, that side has no such limit. Graphics, texts and boxes have
 * them; groups and booleans take their box from what they hold.
 */
export const LayerLimits = z.object({ minWidth: limit, maxWidth: limit, minHeight: limit, maxHeight: limit })
export type LayerLimits = z.infer<typeof LayerLimits>

export const Stroke = z.object({
  paint: Paint,
  width: z.number().positive(),
  align: z.enum(['inside', 'center', 'outside']).default('center'),
  /**
   * Dash and gap lengths in design pixels, taken in turn and repeated (#43); none is a solid
   * line. An odd number of lengths is taken twice, as in SVG, so dashes and gaps alternate.
   */
  dashes: z
    .number()
    .min(0)
    .array()
    .refine((d) => d.length === 0 || d.some((n) => n > 0), 'dashes need a length above 0')
    .default([]),
  /** How far into the pattern the dashes start, in design pixels. */
  dashOffset: z.number().default(0),
  /** The ends of open paths and of each dash. */
  cap: z.enum(['butt', 'round', 'square']).default('butt'),
  join: z.enum(['miter', 'round', 'bevel']).default('miter'),
  /** How far a mitred corner may reach, as a multiple of half the stroke width, before it is bevelled. */
  miterLimit: z.number().min(1).default(4),
})
export type Stroke = z.infer<typeof Stroke>

/** What the end of a line looks like (#44). */
export const LineEnd = z.enum(['none', 'arrow', 'triangle', 'circle'])
export type LineEnd = z.infer<typeof LineEnd>

/** A corner's radius, in pixels. */
export const Radius = z.number().min(0)

export const Shape = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('rect'),
    cornerRadius: Radius.default(0),
    /** Each corner's own radius, from the top left clockwise (#44); when set, `cornerRadius` is unused. */
    corners: z.tuple([Radius, Radius, Radius, Radius]).optional(),
  }),
  z.object({ kind: z.literal('ellipse') }),
  /** A regular polygon in the layer's box, its first corner at the top centre (#44). */
  z.object({
    kind: z.literal('polygon'),
    sides: z.number().int().min(3).max(100).default(5),
    cornerRadius: Radius.default(0),
  }),
  /**
   * A star in the layer's box, its first point at the top centre (#44). Its inner corners sit at
   * `innerRadius` of the way out, as a share of the box.
   */
  z.object({
    kind: z.literal('star'),
    points: z.number().int().min(3).max(100).default(5),
    innerRadius: z.number().min(0).max(1).default(0.382),
    cornerRadius: Radius.default(0),
  }),
  /**
   * A straight line across the middle of the layer's box, from its start edge to its end edge,
   * drawn by the layer's strokes; rotation turns it (#44). The ends take the first stroke's size.
   */
  z.object({ kind: z.literal('line'), start: LineEnd.default('none'), end: LineEnd.default('none') }),
  /**
   * SVG path data in the layer's own box; evenodd lets a path have holes. `drawnIn` is the width and
   * height of the box the data was drawn in: a box of another size draws it scaled to fit, as a
   * resized or laid-out copy's box does. Left out, the data is drawn at its own size whatever the box.
   */
  z.object({
    kind: z.literal('path'),
    d: z.string().min(1),
    fillRule: z.enum(['nonzero', 'evenodd']).default('nonzero'),
    drawnIn: z.object({ width: z.number().min(0), height: z.number().min(0) }).optional(),
  }),
])

export type Shape = z.infer<typeof Shape>

/**
 * How much a path's data is scaled to fill a box of `width` × `height`: by the box over the box it
 * was drawn in, or 1 on an axis that box has no length on, and when it has none.
 */
export function pathScale(
  shape: { drawnIn?: { width: number; height: number } | undefined },
  width: number,
  height: number,
) {
  const { drawnIn } = shape
  return {
    sx: drawnIn && drawnIn.width > 0 ? width / drawnIn.width : 1,
    sy: drawnIn && drawnIn.height > 0 ? height / drawnIn.height : 1,
  }
}

export const GraphicProps = z.object({
  ...commonProps,
  ...flips,
  ...ratio,
  ...LayerLimits.shape,
  shape: Shape,
  fills: Paint.array().default([]),
  strokes: Stroke.array().default([]),
})
export type GraphicProps = z.infer<typeof GraphicProps>

/**
 * A box's auto layout: its children in a row, a column or a grid, `gap` apart inside its
 * paddings, lined up along the flow (`justify`) and across it (`align`). A grid places them in
 * `columns` equal columns (2 when left out), row after row, `gap` apart along a row and `lineGap`
 * apart down the rows. A row or column that wraps runs onto more lines while the box keeps its
 * length along its flow, `lineGap` apart, packed where `align` puts them or spread with the room
 * left between them. Gaps and paddings may be negative, so children overlap.
 */
export const AutoLayout = z.object({
  direction: z.enum(['row', 'column', 'grid']),
  columns: z.number().int().min(1).max(12).optional(),
  gap: z.number().default(0),
  /** A row's or column's layers run onto a new line where the next would pass the box's length; a grid ignores it. */
  wrap: z.boolean().optional(),
  /** The room between wrapped lines, and between a grid's rows; left out, `gap`. */
  lineGap: z.number().optional(),
  /** How wrapped lines take the room left across the flow: packed where `align` puts them (left out), or spread with it between them. */
  alignLines: z.enum(['packed', 'space-between']).optional(),
  padding: z
    .object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() })
    .default({ top: 0, right: 0, bottom: 0, left: 0 }),
  justify: z.enum(['start', 'center', 'end', 'space-between']).default('start'),
  align: z.enum(['start', 'center', 'end']).default('start'),
})
export type AutoLayout = z.infer<typeof AutoLayout>

export const BoxProps = z.object({
  ...commonProps,
  ...flips,
  ...ratio,
  ...LayerLimits.shape,
  blendMode: ContainerBlendMode.default('pass-through'),
  clip: z.boolean().default(true),
  /** The box's corners: one radius for all, or each corner's own from the top left clockwise. */
  cornerRadius: z.union([Radius, z.tuple([Radius, Radius, Radius, Radius])]).default(0),
  fills: Paint.array().default([]),
  /** Strokes along the box's edge, drawn over what is inside it and never cut by its clip. */
  strokes: Stroke.array().default([]),
  /** Lays out the box's children (#46); left out, they stay where they are put. */
  layout: AutoLayout.optional(),
})
export type BoxProps = z.infer<typeof BoxProps>

export const GroupProps = z.object({ ...commonProps, blendMode: ContainerBlendMode.default('pass-through') })
export type GroupProps = z.infer<typeof GroupProps>

/** How a boolean layer combines its shapes, in order: the first with each of the others (#44). */
export const BooleanOp = z.enum(['union', 'subtract', 'intersect', 'exclude'])
export type BooleanOp = z.infer<typeof BooleanOp>

/**
 * A live boolean of the shapes inside it (#44): their outlines combined by `op` and painted with
 * the boolean's own fills and strokes. The shapes keep their own properties, so they can still be
 * moved and edited; their paints don't show.
 */
export const BooleanProps = z.object({
  ...commonProps,
  ...flips,
  op: BooleanOp.default('union'),
  fills: Paint.array().default([]),
  strokes: Stroke.array().default([]),
})
export type BooleanProps = z.infer<typeof BooleanProps>

/** The fields of a text's character style, as the base style and a run's style take them. */
export const textStyleFields = {
  fontFamily: z.string().min(1),
  fontWeight: z.number().int().min(100).max(900),
  fontStyle: z.enum(['normal', 'italic']),
  fontSize: z.number().positive(),
  color: Color,
  /** The room after each character: pixels, or a percentage of the font size the characters are set at. */
  letterSpacing: LetterSpacing,
  /** A multiple of the font size; omitted means the font's own line height. */
  lineHeight: z.number().positive(),
  underline: z.boolean(),
  strikethrough: z.boolean(),
  /** Drawn in another case, as CSS text-transform does; the text itself is kept as typed (#47). */
  textCase: z.enum(['none', 'upper', 'lower', 'title']),
  /** A line along the glyphs' edges, centred on them, drawn over the fill (#47). Width 0 is none. */
  outline: z.object({ width: z.number().min(0), color: Color }),
  /** OpenType features turned on or off by tag; a run's set theirs over the base style's, tag by tag. */
  features: Features,
}

/** A text layer's base character style. */
export const TextStyle = z.object({
  ...textStyleFields,
  fontWeight: textStyleFields.fontWeight.default(400),
  fontStyle: textStyleFields.fontStyle.default('normal'),
  letterSpacing: textStyleFields.letterSpacing.default(NO_LETTER_SPACING),
  lineHeight: textStyleFields.lineHeight.optional(),
  underline: textStyleFields.underline.optional(),
  strikethrough: textStyleFields.strikethrough.optional(),
  textCase: textStyleFields.textCase.optional(),
  outline: textStyleFields.outline.optional(),
  features: textStyleFields.features.optional(),
})
export type TextStyle = z.infer<typeof TextStyle>

/** A run's style: only the keys it changes, with no defaults, so the rest come from the base style. */
export const RunStyle = z.object(textStyleFields).partial()
export type RunStyle = z.infer<typeof RunStyle>

/** Run offsets count UTF-16 code units, as JavaScript strings do. */
export const TextRun = z
  .object({
    start: z.number().int().min(0),
    end: z.number().int().min(0),
    style: RunStyle,
  })
  .refine((r) => r.end > r.start, 'a run must cover at least one character')
export type TextRun = z.infer<typeof TextRun>

export const TextProps = z
  .object({
    ...commonProps,
    ...flips,
    ...ratio,
    ...LayerLimits.shape,
    text: z.string(),
    style: TextStyle,
    runs: TextRun.array().default([]),
    align: z.enum(['start', 'center', 'end', 'justify']).default('start'),
    direction: z.enum(['auto', 'ltr', 'rtl']).default('auto'),
    verticalAlign: z.enum(['top', 'middle', 'bottom']).default('top'),
    boxMode: z.enum(['autoWidth', 'autoHeight', 'fixed']).default('autoHeight'),
    /**
     * Where a paragraph's lines break when it wraps: `auto` fits as many words on each line as fit,
     * `balance` breaks it at the narrowest width that adds no line, so its lines come out near even,
     * and `pretty` keeps lines full but leaves no one word alone on the last.
     */
    wrapStyle: z.enum(['auto', 'balance', 'pretty']).default('auto'),
    /** Every paragraph that has text gets a bullet or its number, in a gutter its lines wrap clear of (#47). */
    list: z.enum(['bullet', 'number']).optional(),
    /** Space between paragraphs, in pixels at the base font size. */
    paragraphSpacing: z.number().min(0).optional(),
    /** Lines shown at most; text past them is cut and the last line ends in an ellipsis. */
    maxLines: z.number().int().positive().optional(),
    /**
     * The base font size is the largest, a quarter point apart, from `min` to `max` at which the
     * text fits its box: no word broken and, in a fixed box, no line below it. Every size in the
     * text scales with it. Text that can't fit is drawn at `min`.
     */
    shrinkToFit: z
      .object({ min: z.number().positive(), max: z.number().positive() })
      .refine((f) => f.min <= f.max, 'the smallest size must not be more than the largest')
      .optional(),
  })
  .superRefine((t, ctx) => {
    for (const [i, run] of t.runs.entries()) {
      if (run.end > t.text.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['runs', i, 'end'],
          message: `run ends at ${run.end} but the text is ${t.text.length} UTF-16 units long`,
        })
      }
    }
  })
export type TextProps = z.infer<typeof TextProps>

/** Five of the seven layer types in ADR-0006: boolean arrived with #44; instance and lottie come later. */
export const LAYER_PROPS = {
  box: BoxProps,
  group: GroupProps,
  graphic: GraphicProps,
  text: TextProps,
  boolean: BooleanProps,
} as const
export type LayerType = keyof typeof LAYER_PROPS

/**
 * What can't be changed about a layer, each on its own (as in Polotno): its position and
 * constraints, its size, rotation and flip, its content (text), its style, and whether it can be
 * deleted. Locking a layer on the stage sets all five; a layer whose position is locked can't be
 * picked on the stage.
 */
export const LayerLock = z.object({
  move: z.boolean().default(false),
  resize: z.boolean().default(false),
  content: z.boolean().default(false),
  style: z.boolean().default(false),
  delete: z.boolean().default(false),
})
export type LayerLock = z.infer<typeof LayerLock>
export const LOCK_FLAGS = ['move', 'resize', 'content', 'style', 'delete'] as const satisfies (keyof LayerLock)[]

/** Where a layer is: what holds it, the link id it shares, and its place among its siblings. */
const layerPlace = {
  /** The frame the layer sits in at the top level, or the layer holding it. */
  parentId: z.union([FrameId, NodeId]),
  /** Shared by the layer's linked copies in the other frames of its page; a frame holds no two layers with one link id. */
  link: LinkId,
  index: FractionalIndex,
}

/** What a layer of any type has besides its place and its props. */
const layerOwn = {
  name: z.string(),
  role: z
    .enum([
      'headline',
      'subhead',
      'body',
      'price',
      'cta',
      'logo',
      'product',
      'person',
      'background',
      'badge',
      'decoration',
    ])
    .optional(),
  /** Left out while nothing is locked. */
  lock: LayerLock.optional(),
  /** Properties that follow brand kit tokens (#53); left out while nothing is bound. */
  bindings: Bindings.optional(),
}

const layerOf = <T extends LayerType>(type: T) =>
  z.object({ type: z.literal(type), ...layerPlace, ...layerOwn, props: LAYER_PROPS[type] })
const unplacedOf = <T extends LayerType>(type: T) =>
  z.object({ type: z.literal(type), ...layerOwn, props: LAYER_PROPS[type] })

export const Layer = z.discriminatedUnion('type', [
  layerOf('box'),
  layerOf('group'),
  layerOf('graphic'),
  layerOf('text'),
  layerOf('boolean'),
])
export type Layer = z.infer<typeof Layer>

/**
 * A layer without its place: what a new layer is before it is given a parent, a link id and an
 * index among its siblings.
 */
export const UnplacedLayer = z.discriminatedUnion('type', [
  unplacedOf('box'),
  unplacedOf('group'),
  unplacedOf('graphic'),
  unplacedOf('text'),
  unplacedOf('boolean'),
])
export type UnplacedLayer = z.infer<typeof UnplacedLayer>

/** Layer types that hold other layers, and which types each can hold. */
export const CONTAINERS = {
  box: ['box', 'group', 'graphic', 'text', 'boolean'],
  group: ['box', 'group', 'graphic', 'text', 'boolean'],
  boolean: ['graphic', 'boolean'],
} as const satisfies Partial<Record<LayerType, readonly LayerType[]>>

/** Whether a layer of type `parent` can hold one of type `child`. */
export const canHold = (parent: string, child: string) =>
  Object.hasOwn(CONTAINERS, parent) &&
  (CONTAINERS[parent as keyof typeof CONTAINERS] as readonly string[]).includes(child)
/** Whether a layer of this type holds other layers. */
export const isContainer = (type: string) => Object.hasOwn(CONTAINERS, type)

/** Whether a layer's props have Lock ratio on: only a graphic's, text's or box's can. */
export const ratioLocked = (props: object) => 'lockRatio' in props && props.lockRatio === true

/** Hebrew, Arabic, Syriac, Thaana, NKo, their presentation forms, and the right-to-left blocks beyond the BMP. */
const RTL_CHAR = /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF\u{10800}-\u{10FFF}\u{1E800}-\u{1EFFF}]/u
const STRONG_CHAR = /[\p{L}]/u

/** The direction of the first strong character, as the Unicode bidi algorithm picks a paragraph's direction. */
export function autoDirection(text: string): 'ltr' | 'rtl' {
  for (const ch of text) if (STRONG_CHAR.test(ch)) return RTL_CHAR.test(ch) ? 'rtl' : 'ltr'
  return 'ltr'
}

/** A box's layout: Free, or the way it places its layers. */
export type Layout = 'free' | AutoLayout['direction']

/** A box's layout: Free while it has none, else the way it places its layers. */
export function layoutOf(box: { layout?: Pick<AutoLayout, 'direction'> | undefined }): Layout {
  return box.layout?.direction ?? 'free'
}

/** How many columns a grid lays its layers out in: its own count, or 2 when it sets none. */
export function gridColumns(layout: Pick<AutoLayout, 'columns'>): number {
  return layout.columns ?? 2
}
