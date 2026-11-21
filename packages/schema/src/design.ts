import { z } from 'zod'

import { carryOverLayers } from './carry-over.ts'
import { isRecord } from './json.ts'
import { canHold, Layer } from './layers.ts'
import { Paint } from './paint.ts'
import { FractionalIndex, FrameId, NodeId, PageId } from './primitives.ts'
import { bindProps, type Variables } from './variables.ts'

export const Page = z.object({
  name: z.string(),
  /** Orders the design's pages. */
  order: FractionalIndex,
})
export type Page = z.infer<typeof Page>

/** The most guides a frame holds. */
export const MAX_GUIDES = 100

/**
 * A line across a frame that layers snap to, dragged from a ruler: on `axis` x a vertical line at
 * x = `at`, on y a horizontal one at y = `at`, in the frame's own whole pixels.
 */
export const Guide = z.object({
  axis: z.enum(['x', 'y']),
  at: z.number().int(),
})
export type Guide = z.infer<typeof Guide>

/** One ad, post or other piece of creative at one size, placed on a page. It owns its layers. */
export const Frame = z.object({
  pageId: PageId,
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** Where the frame's top start corner sits on its page, in design pixels. */
  x: z.number(),
  y: z.number(),
  /** Paints behind every layer in the frame: its background. */
  fills: Paint.array().default([]),
  /** Orders the frames of one page: the layers panel and Export list them in it. */
  order: FractionalIndex,
  /** Its guides, in the order they were added; left out while it has none. */
  guides: Guide.array().max(MAX_GUIDES).optional(),
})
export type Frame = z.infer<typeof Frame>

/**
 * The version of this schema, which the API writes into a design's record when it creates one. A
 * sync token carries the design's, and the sync server refuses a tab built with an older version.
 */
export const SCHEMA_VERSION = 14

export const DesignMeta = z.object({
  designId: z.string().min(1),
  name: z.string(),
})
export type DesignMeta = z.infer<typeof DesignMeta>

/** Everything in a design but its layers: small, so always validated whole. */
export const DesignHead = z.object({
  meta: DesignMeta,
  pages: z.record(PageId, Page),
  frames: z.record(FrameId, Frame),
})
export type DesignHead = z.infer<typeof DesignHead>

export const DesignShape = z.object({
  ...DesignHead.shape,
  nodes: z.record(NodeId, Layer),
})
export type DesignShape = z.infer<typeof DesignShape>

export const Design = DesignShape.superRefine((d, ctx) =>
  checkStructure(d, (path, message) => ctx.addIssue({ code: 'custom', path, message })),
)
export type Design = z.infer<typeof Design>
export type DesignInput = z.input<typeof Design>

export type ParseResult = { success: true; design: Design } | { success: false; errors: string[] }

/** Reports one broken rule: where in the design, and what is wrong. */
export type Fail = (path: PropertyKey[], message: string) => void

/** Where a layer's chain of parents ends: a frame's id, back at the layer, or elsewhere (undefined). */
export type FrameEnd = string | 'inside itself' | undefined

/** What the structure rules read of a design: its records by id, and who holds a link first. */
export interface StructureLookup {
  /** Each layer's frame as `frameOfLayer` found it, so that one check walks each chain once. */
  readonly frames: Map<string, FrameEnd>
  pageCount(): number
  hasPage(id: string): boolean
  frame(id: string): Pick<Frame, 'pageId'> | undefined
  layer(id: string): Pick<Layer, 'type' | 'parentId' | 'link'> | undefined
  /**
   * The layer whose hold on `link` in frame `frameId` comes before layer `id`'s, if one does:
   * that frame then holds the link twice.
   */
  linkTakenBy(frameId: string, link: string, id: string): string | undefined
}

/** Validates untrusted JSON as a design, its layers carried over first (`carryOverLayers`). Errors read `path: message`. */
export function parseDesign(input: unknown): ParseResult {
  const nodes = isRecord(input) && isRecord(input.nodes) ? carryOverLayers(input.nodes) : undefined
  const result = Design.safeParse(isRecord(input) && nodes && nodes !== input.nodes ? { ...input, nodes } : input)
  if (result.success) return { success: true, design: result.data }
  return {
    success: false,
    errors: result.error.issues.map((i) => `${i.path.join('.') || '(design)'}: ${i.message}`),
  }
}

/** Whether a frame holds any guide, shown or past its edge; a frame keeps no list, or an empty one, with none. */
export function hasGuides(frame: Pick<Frame, 'guides'> | undefined): boolean {
  return (frame?.guides?.length ?? 0) > 0
}

/**
 * Every asset an image paint of the design names, on frames and layers' fills and strokes, sorted; only those of the
 * frames named and the layers inside them, when `frameIds` is given. With the brand's variables, a
 * picture bound to the brand's logo is the kit's.
 */
export function imageAssetIds(design: Design, frameIds?: Iterable<string>, variables?: Variables): string[] {
  const within = frameIds && new Set(frameIds)
  const ids = new Set<string>()
  const add = (fills: unknown) => {
    if (!Array.isArray(fills)) return
    for (const fill of fills) {
      if (fill && typeof fill === 'object' && (fill as { type?: unknown }).type === 'image') {
        const { assetId } = fill as { assetId?: unknown }
        if (typeof assetId === 'string') ids.add(assetId)
      }
    }
  }
  for (const [id, frame] of Object.entries(design.frames)) if (!within || within.has(id)) add(frame.fills)
  const frameOf = frameFinder(design)
  for (const [id, node] of Object.entries(design.nodes)) {
    if (within && !within.has(frameOf(id) ?? '')) continue
    const { fills, strokes } = bindProps(node.type, node.props, node.bindings, variables) as {
      fills?: unknown
      strokes?: unknown
    }
    add(fills)
    if (Array.isArray(strokes)) add(strokes.map((stroke) => (stroke as { paint?: unknown } | null)?.paint))
  }
  return [...ids].sort()
}

/** Finds the frame a node is in by its parents, each worked out once; undefined for one in no frame. */
function frameFinder(design: Design): (id: string) => string | undefined {
  const found = new Map<string, string | undefined>()
  const most = Object.keys(design.nodes).length
  const frameOf = (id: string, depth = 0): string | undefined => {
    if (Object.hasOwn(design.frames, id)) return id
    if (found.has(id)) return found.get(id)
    const parentId = Object.hasOwn(design.nodes, id) ? design.nodes[id]?.parentId : undefined
    // A parent chain longer than the design has nodes loops, and is in no frame.
    const frame = parentId === undefined || depth > most ? undefined : frameOf(parentId, depth + 1)
    found.set(id, frame)
    return frame
  }
  return (id) => frameOf(id)
}

/**
 * The rules about the design's shape: it has a page; every frame's page exists; every layer's
 * chain of parents ends at a frame, through layers that can hold what they hold; and no frame
 * holds two layers with one link id. Each rule is written once (`checkPages`, `checkFrame`,
 * `checkLayer`) over a lookup: this runs them all over a whole design, and the sync server runs
 * them over the records a change set wrote.
 */
export function checkStructure(d: Pick<DesignShape, 'pages' | 'frames' | 'nodes'>, fail: Fail) {
  const lookup = designLookup(d)
  checkPages(lookup, fail)
  for (const id of Object.keys(d.frames)) checkFrame(lookup, id, fail)
  for (const id of Object.keys(d.nodes)) checkLayer(lookup, id, fail)
}

/** The design keeps a page. */
export function checkPages(lookup: StructureLookup, fail: Fail) {
  if (lookup.pageCount() === 0) fail(['pages'], 'a design needs a page')
}

/** Frame `id`'s page exists. */
export function checkFrame(lookup: StructureLookup, id: string, fail: Fail) {
  const frame = lookup.frame(id)
  if (frame && !lookup.hasPage(frame.pageId)) fail(['frames', id, 'pageId'], `no page "${frame.pageId}"`)
}

/**
 * Layer `id` is no frame, its parent exists and can hold it, it is not inside itself, and no
 * other layer of its frame took its link first.
 */
export function checkLayer(lookup: StructureLookup, id: string, fail: Fail) {
  const node = lookup.layer(id)
  if (!node) return
  if (lookup.frame(id)) fail(['nodes', id], `"${id}" is both a frame and a layer`)
  const parent = lookup.layer(node.parentId)
  if (!lookup.frame(node.parentId) && !parent) {
    fail(['nodes', id, 'parentId'], `parent "${node.parentId}" is neither a frame nor a layer`)
  } else if (parent && !canHold(parent.type, node.type)) {
    fail(
      ['nodes', id, 'parentId'],
      parent.type === 'boolean'
        ? `parent "${node.parentId}" is a boolean, which holds only shapes and booleans`
        : `parent "${node.parentId}" is a ${parent.type}, which can't hold layers`,
    )
  }
  const frameId = frameOfLayer(lookup, id)
  if (frameId === 'inside itself') fail(['nodes', id, 'parentId'], `"${id}" is inside itself`)
  if (frameId === undefined || frameId === 'inside itself') return
  const first = lookup.linkTakenBy(frameId, node.link, id)
  if (first !== undefined)
    fail(['nodes', id, 'link'], `frame "${frameId}" holds link "${node.link}" twice, also on "${first}"`)
}

/**
 * The frame layer `id`'s chain of parents ends at: 'inside itself' when the chain comes back to
 * it, undefined when it ends elsewhere or loops above it (reported for the layers in that loop).
 * Each layer the chain passes is noted in `lookup.frames`, so no chain is walked twice.
 */
export function frameOfLayer(lookup: StructureLookup, id: string): FrameEnd {
  const known = lookup.frames
  const path: string[] = []
  const at = new Map<string, number>()
  let up = id
  let end: FrameEnd
  let loop = -1
  for (;;) {
    if (known.has(up)) {
      // A layer in a loop is inside itself; one below the loop only ends elsewhere.
      const found = known.get(up)
      end = found === 'inside itself' ? undefined : found
      break
    }
    const layer = lookup.layer(up)
    if (!layer) {
      end = up !== id && lookup.frame(up) ? up : undefined
      break
    }
    const seen = at.get(up)
    if (seen !== undefined) {
      loop = seen
      break
    }
    at.set(up, path.length)
    path.push(up)
    up = layer.parentId
  }
  path.forEach((layer, i) => known.set(layer, loop >= 0 && i >= loop ? 'inside itself' : end))
  return known.has(id) ? known.get(id) : end
}

/** A lookup over a whole design: a link is held first by the first of its layers in the design's order. */
function designLookup(d: Pick<DesignShape, 'pages' | 'frames' | 'nodes'>): StructureLookup {
  const own = <T>(records: Record<string, T>, id: string) => (Object.hasOwn(records, id) ? records[id] : undefined)
  /** The first holder of each link id, by frame. */
  const firsts = new Map<string, Map<string, string>>()
  const lookup: StructureLookup = {
    frames: new Map(),
    pageCount: () => Object.keys(d.pages).length,
    hasPage: (id) => Object.hasOwn(d.pages, id),
    frame: (id) => own(d.frames, id),
    layer: (id) => own(d.nodes, id),
    linkTakenBy: (frameId, link, id) => {
      const first = firsts.get(frameId)?.get(link)
      return first === id ? undefined : first
    },
  }
  for (const [id, node] of Object.entries(d.nodes)) {
    const frameId = frameOfLayer(lookup, id)
    if (frameId === undefined || frameId === 'inside itself') continue
    const links = firsts.get(frameId) ?? new Map<string, string>()
    firsts.set(frameId, links)
    if (!links.has(node.link)) links.set(node.link, id)
  }
  return lookup
}
