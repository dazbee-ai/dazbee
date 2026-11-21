// A Figma file brought in as Dazbee pages, frames and layers, with the import report of what it
// left out or drew another way.
import { z } from 'zod'

import { LayerTree } from './clipboard.ts'
import { Paint } from './paint.ts'
import { NodeId } from './primitives.ts'
import { sizeIssue } from './sizes.ts'

/** Whether what a report line names was left out, or drawn another way. */
export const FigmaReportKind = z.enum(['left-out', 'changed'])
export type FigmaReportKind = z.infer<typeof FigmaReportKind>

/**
 * Each line an import report can hold, with whether what it names was left out or drawn another
 * way. Each has words of its own in the app.
 */
export const FIGMA_REPORT_LINES = {
  /** Slices, which draw nothing. */
  slices: 'left-out',
  /** Tables and their cells. */
  tables: 'left-out',
  /** Text set along a path. */
  'text-on-paths': 'left-out',
  /** Transform groups. */
  'transform-groups': 'left-out',
  /** Stickies, connectors, shapes with text and washi tape, from FigJam. */
  'figjam-items': 'left-out',
  /** Layers of a type Figma's documentation doesn't list. */
  'unknown-layers': 'left-out',
  /** Layers with no id, no type or no box to place them by. */
  'unreadable-layers': 'left-out',
  /** Top-level frames hidden in Figma. */
  'hidden-frames': 'left-out',
  /** Pages with nothing to import. */
  'empty-pages': 'left-out',
  /** Vectors, stars, polygons, arcs and rings, or vectors' strokes, with no outline in the file to draw them by. */
  'shapes-without-outlines': 'left-out',
  /** Texts. */
  texts: 'left-out',
  /** Frames whose size was rounded to whole pixels. */
  'frames-rounded': 'changed',
  /** Frames brought within the sizes a frame can be, their content cut at the frame's edge. */
  'frames-resized': 'changed',
  /** Top-level frames that don't clip in Figma, whose content is cut at the frame's edge. */
  'frames-unclipped': 'changed',
  /** Top-level frames locked in Figma, which come in unlocked. */
  'locked-frames': 'changed',
  /** Sections, which go while their frames stay where they were. */
  sections: 'changed',
  /** Layers outside any frame, put in one frame that fits them. */
  'outside-frames': 'changed',
  /** Components, component sets and instances, which come in as plain frames and boxes. */
  'components-and-instances': 'changed',
  /** A linked layer inside a frame, imported on its own in a frame of its size. */
  'linked-layer-alone': 'changed',
  /** Line ends Dazbee has no end for, drawn without one. */
  'line-ends': 'changed',
  /** Two or more masks in a box with auto layout, each masking only up to the next. */
  'masks-separate': 'changed',
  /** Layers placed further out, or larger, than Dazbee places them, brought within its reach. */
  'positions-clamped': 'changed',
  /** Top-level frames turned or mirrored in Figma, which come in upright with their content where it was. */
  'frames-turned': 'changed',
  /** Skewed texts, boxes and shapes with no outline, drawn turned and flipped without the skew. */
  'skewed-layers': 'changed',
  /** Vector strokes, kept as outlines filled with the stroke's paints. */
  'vector-strokes-outlined': 'changed',
  /** Booleans holding a layer that is no shape, drawn as one path of their outline. */
  'booleans-flattened': 'changed',
  /** Emoji paints. */
  'emoji-paints': 'left-out',
  /** Video paints. */
  'video-paints': 'left-out',
  /** Pattern paints. */
  'pattern-paints': 'left-out',
  /** Paints of a type Figma's documentation doesn't list. */
  'unknown-paints': 'left-out',
  /** Paints with no type, colour, stops or handles to draw them by. */
  'unreadable-paints': 'left-out',
  /** Image fills that name no image. */
  'missing-images': 'left-out',
  /** Radial and diamond gradients flattened to a line, which draw nothing. */
  'flat-gradients': 'left-out',
  /** Image fills' highlights and shadows adjustments. */
  'image-highlights-shadows': 'left-out',
  /** Noise effects. */
  'noise-effects': 'left-out',
  /** Texture effects. */
  'texture-effects': 'left-out',
  /** Effects of a type Figma's documentation doesn't list. */
  'unknown-effects': 'left-out',
  /** Effects with no type or colour to draw them by. */
  'unreadable-effects': 'left-out',
  /** Effects hidden in Figma, which Dazbee can't keep hidden. */
  'hidden-effects': 'left-out',
  /** Paints blended with what is under them in another way than normal, drawn normal. */
  'paint-blend-modes': 'changed',
  /** Linear gradients whose handles lie on one line, drawn from their start to their end. */
  'gradient-handles-in-line': 'changed',
  /** Oval radial and diamond gradients, drawn round with the same area. */
  'radial-ovals-round': 'changed',
  /** Diamond gradients, drawn as radial gradients through the same handles. */
  'diamond-gradients': 'changed',
  /** Angular gradients whose handles aren't square and of one length, drawn evenly from their start. */
  'angular-gradients-changed': 'changed',
  /** GIF fills, drawn as their still image. */
  'gif-images': 'changed',
  /** Image fills turned in Figma, drawn unturned. */
  'image-rotations': 'changed',
  /** Image fills whose tile size was brought within the sizes a tile can be. */
  'tile-scales-clamped': 'changed',
  /** Stretched image fills turned, mirrored or skewed in Figma, drawn covering their layer. */
  'stretched-images-turned': 'changed',
  /** Image fills on skewed shapes, drawn unskewed. */
  'skewed-images': 'changed',
  /** Strokes with a weight of their own on each side, drawn at the widest all round. */
  'stroke-weights-widest': 'changed',
  /** Smoothed corners, drawn round. */
  'corner-smoothing': 'changed',
  /** Inner shadows that shrink, drawn with no spread. */
  'inner-shadow-spreads': 'changed',
  /** Progressive blurs, drawn evenly at their end radius. */
  'progressive-blurs': 'changed',
  /** Shadows blended with what is under them in another way than normal, drawn normal. */
  'effect-blend-modes': 'changed',
  /** Layers in the linear burn or linear dodge blend modes, drawn normal. */
  'linear-blend-modes': 'changed',
  /** Vector masks with a blur or a soft or see-through paint, drawn as alpha masks. */
  'vector-masks': 'changed',
} as const satisfies Record<string, FigmaReportKind>

export const FigmaReportLine = z.enum(Object.keys(FIGMA_REPORT_LINES) as [keyof typeof FIGMA_REPORT_LINES])
export type FigmaReportLine = z.infer<typeof FigmaReportLine>

/** Report items show at most this many of the layers they name. */
export const FIGMA_REPORT_NODES = 3
/** A report holds at most this many items. */
export const FIGMA_REPORT_ITEMS = 200

/** One line of the report: how many layers it names, and the first few by their Figma ids and names. */
export const FigmaReportItem = z
  .object({
    line: FigmaReportLine,
    kind: FigmaReportKind,
    count: z.number().int().positive(),
    nodes: z.object({ id: z.string(), name: z.string() }).array().max(FIGMA_REPORT_NODES),
  })
  .refine((item) => FIGMA_REPORT_LINES[item.line] === item.kind, "an item's kind is its line's")
export type FigmaReportItem = z.infer<typeof FigmaReportItem>

/**
 * What an import left out or drew another way, in the order first met: the font families it found
 * no font for, and its items.
 */
export const FigmaReport = z.object({
  fonts: z.string().array(),
  items: FigmaReportItem.array().max(FIGMA_REPORT_ITEMS),
})
export type FigmaReport = z.infer<typeof FigmaReport>

/**
 * A Figma frame as a Dazbee frame: its place on its page, its size (one a frame can be), its fills,
 * and its layers, keyed by ids made from their Figma ids. `figmaIds` maps each key that came from a
 * Figma layer to that layer's Figma id; layers the import added have none.
 */
export const FigmaFrame = z
  .object({
    name: z.string().trim().min(1).max(120),
    figmaId: z.string(),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    fills: Paint.array(),
    layers: LayerTree.nullable(),
    figmaIds: z.record(NodeId, z.string()),
  })
  .superRefine((frame, ctx) => {
    const issue = sizeIssue(frame.width, frame.height)
    if (issue) ctx.addIssue({ code: 'custom', path: ['width'], message: `a frame can't be this size (${issue})` })
    for (const key of Object.keys(frame.figmaIds)) {
      if (!frame.layers || !Object.hasOwn(frame.layers.nodes, key))
        ctx.addIssue({ code: 'custom', path: ['figmaIds', key], message: `"${key}" is no layer of the frame` })
    }
  })
export type FigmaFrame = z.infer<typeof FigmaFrame>

export const FigmaPage = z.object({
  name: z.string(),
  figmaId: z.string(),
  frames: FigmaFrame.array().min(1),
})
export type FigmaPage = z.infer<typeof FigmaPage>

/**
 * A Figma file, or the part of it a link names, as Dazbee pages: each a new page (`pages`), or the
 * frames of one onto the page shown (`shown-page`).
 */
export const FigmaImport = z
  .object({
    name: z.string(),
    target: z.enum(['pages', 'shown-page']),
    pages: FigmaPage.array().min(1),
    report: FigmaReport,
  })
  .refine((i) => i.target === 'pages' || i.pages.length === 1, 'an import onto the shown page holds one page')
export type FigmaImport = z.infer<typeof FigmaImport>
