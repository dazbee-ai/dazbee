// Commands on frames: add, change, resize (with their layers following), copy (with linked copies
// of every layer, also at another size, its text kept readable) and delete.
import { z } from 'zod'

import {
  type Design,
  Frame,
  FrameId,
  framesInSection,
  framesOf,
  freeSpot,
  Guide,
  type Layer,
  MAX_GUIDES,
  NEW_FRAME_FILLS,
  newFramePosition,
  PageId,
  Paint,
  readableTextSize,
  type Rect,
  SectionId,
  sectionOf,
  sizeProblem,
} from '@dazbee/schema'

import { descendants } from '../children.ts'
import { followingBoxes, guessesUnder, stayedBoxes, stayedGuides } from '../constraints.ts'
import { round } from '../geometry.ts'
import type { StoreWrite } from '../store.ts'
import { frameProblem, idProblem, pageProblem, sectionOnPageProblem } from './checks.ts'
import { type CommandContext, defineCommand, strict } from './define.ts'
import { readableBox, readableScale, scaledSizes, type Size, smallerRatio } from './fit.ts'
import { keepDrawnIn } from './paths.ts'
import { forgetFrame, pageRecords, sweepPage } from './tidy-page.ts'
import { copyFrameLayers, type Slot, writeOrder } from './tree.ts'

/** Where a frame's copy goes: its place on the page, its order among the page's frames, and its section, if any. */
export interface CopyPlace {
  x: number
  y: number
  order: string
  sectionId?: string
}

/** What frame.resize writes: the frame's new box, its layers' new stored boxes, and its guides when they move. */
interface ResizePlan {
  to: Rect
  boxes: Map<string, Rect>
  guides?: Guide[]
}

/** The keys of frame.update's input that a star alone gives, which name its step for the star. */
const STAR_KEYS = new Set(['frameId', 'starred'])

/** A frame's name as a command takes it. */
export const FrameName = z.string().trim().min(1).max(120)

/**
 * Adds an empty white frame to a page, after its last frame: at `x`, `y` when given, else where
 * the frame rule puts it (newFramePosition). Returns the frame's id.
 */
export const frameAdd = defineCommand({
  name: 'frame.add',
  description:
    'Adds an empty white frame to a page, after its last frame, in the section given if any, and returns its id. It refuses a missing page, an id already in use, a size the editor does not take, and a section that is missing or on another page.',
  step: 'addFrame',
  input: z.strictObject({
    id: FrameId.optional().describe('The new frame’s id; a fresh one is made when left out.'),
    pageId: PageId.describe('The page the frame goes on.'),
    name: FrameName.describe('The frame’s name, such as the size it is for.'),
    width: Frame.shape.width.describe('Its width, in pixels.'),
    height: Frame.shape.height.describe('Its height, in pixels.'),
    x: Frame.shape.x.optional().describe('Where its left edge goes on the page; beside the last frame when left out.'),
    y: Frame.shape.y.optional().describe('Where its top edge goes on the page; beside the last frame when left out.'),
    sectionId: SectionId.optional().describe('The section of the page it goes in; none when left out.'),
  }),
  check: (ctx, { id, pageId, width, height, sectionId }) =>
    pageProblem(ctx.design, pageId) ??
    idProblem(ctx, id) ??
    sizeProblem(width, height) ??
    (sectionId === undefined ? undefined : sectionOnPageProblem(ctx.design, pageId, sectionId)),
  apply: ({ w, design, newId }, { id = newId(), pageId, x, y, sectionId, ...frame }) => {
    const next = nextOnPage(w, design, pageId, id)
    const added: Frame = {
      ...frame,
      ...next,
      pageId,
      x: x ?? next.x,
      y: y ?? next.y,
      fills: NEW_FRAME_FILLS,
      ...(sectionId !== undefined && { sectionId }),
    }
    w.create('frame', id, added)
    return id
  },
})

/** Renames, resizes, moves, refills or stars a frame, or sets its guides; its layers stay as they are. */
export const frameUpdate = defineCommand({
  name: 'frame.update',
  description:
    'Renames, resizes, moves, refills or stars a frame, or sets its guides, leaving its layers as they are; frame.resize resizes it with its layers following. It refuses a missing frame and a size the editor does not take.',
  step: 'editFrame',
  stepOf: (input) => {
    const others = Object.entries(input).filter(([key, value]) => !STAR_KEYS.has(key) && value !== undefined)
    if (input.starred === undefined || others.length > 0) return 'editFrame'
    return input.starred ? 'star' : 'unstar'
  },
  batchable: true,
  input: z.strictObject({
    frameId: FrameId.describe('The frame to change.'),
    name: FrameName.optional().describe('Its new name.'),
    width: Frame.shape.width.optional().describe('Its new width, in pixels.'),
    height: Frame.shape.height.optional().describe('Its new height, in pixels.'),
    x: Frame.shape.x.optional().describe('Where its left edge goes on the page.'),
    y: Frame.shape.y.optional().describe('Where its top edge goes on the page.'),
    fills: strict(Paint).array().optional().describe('Its new fills, the first drawn lowest.'),
    guides: z
      .strictObject({
        axis: Guide.shape.axis.describe('x for a vertical guide, y for a horizontal one.'),
        at: Guide.shape.at.describe('Its x or y in the frame, in whole pixels from its top left, also past its sides.'),
      })
      .array()
      .max(MAX_GUIDES)
      .optional()
      .describe('All its guides, in the order they were added.'),
    starred: z.boolean().optional().describe('true stars it as ready to go out; false takes its star off.'),
  }),
  check: ({ design }, { frameId, width, height }) => {
    const problem = frameProblem(design, frameId)
    if (problem) return problem
    const frame = design.frames[frameId] as Frame
    if (width === undefined && height === undefined) return undefined
    return sizeProblem(width ?? frame.width, height ?? frame.height)
  },
  apply: ({ w }, { frameId, starred, ...change }) => {
    for (const [key, value] of Object.entries(change)) if (value !== undefined) w.set('frame', frameId, key, value)
    if (starred === true) w.set('frame', frameId, 'starred', true)
    else if (starred === false) w.unset('frame', frameId, 'starred')
  },
})

/**
 * Resizes a frame, and moves it when given a place, with its layers following: by their
 * constraints from its old size to its new one (`follow`, its guides kept from its top left), or
 * each kept where it is on the page (`stay`, its guides shifted with them by whole pixels). A layer
 * locked in place keeps its place in the frame either way, and a path whose box changes keeps the
 * box it was drawn in, so its drawing scales with it. In a batch it places the layers from the design
 * as the batch found it, as every command of a batch reads it.
 */
export const frameResize = defineCommand({
  name: 'frame.resize',
  description:
    'Resizes a frame from its top left, or to the place given, with its layers following their constraints, or with them staying where they are on the page; a layer locked in place keeps its place in the frame. It refuses a missing frame, a size the editor does not take, and a resize that would move a layer or a guide past where one can be.',
  step: 'resize',
  batchable: true,
  input: z.strictObject({
    frameId: FrameId.describe('The frame to resize.'),
    width: Frame.shape.width.describe('Its new width, in pixels.'),
    height: Frame.shape.height.describe('Its new height, in pixels.'),
    x: Frame.shape.x.optional().describe('Where its left edge goes on the page; where it is when left out.'),
    y: Frame.shape.y.optional().describe('Where its top edge goes on the page; where it is when left out.'),
    layers: z
      .enum(['follow', 'stay'])
      .optional()
      .describe(
        'follow (the default): each layer follows its constraints and the guides keep their place from the frame’s top left; stay: the layers and guides stay where they are on the page.',
      ),
  }),
  check: ({ design }, input) => {
    const { frameId, width, height } = input
    const problem = frameProblem(design, frameId) ?? sizeProblem(width, height)
    if (problem) return problem
    const plan = resizePlan(design, input)
    const far = [...plan.boxes].find(([, box]) => !Object.values(box).every(Number.isFinite))
    if (far) return `"${far[0]}" would be moved past where a layer can be`
    if (plan.guides?.some((guide) => !Number.isSafeInteger(guide.at)))
      return `the guides of frame "${frameId}" would be moved past where a guide can be`
    return undefined
  },
  apply: ({ w, design }, input) => {
    const { frameId } = input
    const { to, boxes, guides } = resizePlan(design, input)
    writeBoxes(w, design, boxes)
    if (guides) w.set('frame', frameId, 'guides', guides)
    // Each is written as given, also when the frame has it, so a batch that changed it before keeps this one.
    for (const key of ['x', 'y', 'width', 'height'] as const) w.set('frame', frameId, key, to[key])
  },
})

/**
 * Where frame.resize puts a frame, its layers and its guides: under `follow` the layers go by their
 * constraints from the frame's old size to its new one and the guides stay; under `stay` both move
 * in the frame by its old place less its new, the guides by its whole-pixel place's.
 */
function resizePlan(
  design: Design,
  { frameId, width, height, x, y, layers = 'follow' }: z.output<typeof frameResize.input>,
): ResizePlan {
  const frame = design.frames[frameId] as Frame
  const to = { x: x ?? frame.x, y: y ?? frame.y, width, height }
  if (layers === 'follow') {
    const from = { x: 0, y: 0, width: frame.width, height: frame.height }
    return { to, boxes: followingBoxes(design, frameId, from, { x: 0, y: 0, width, height }) }
  }
  const boxes = stayedBoxes(design, frameId, frame, to)
  const guides = stayedGuides(frame.guides, frame, to)
  return guides && guides !== frame.guides ? { to, boxes, guides } : { to, boxes }
}

/**
 * Writes the stored boxes given, each value only where it differs from the layer's own; a path
 * whose size changes first keeps the box it was drawn in.
 */
function writeBoxes(w: StoreWrite, design: Design, boxes: ReadonlyMap<string, Rect>) {
  for (const [id, box] of boxes) {
    const changed = (['x', 'y', 'width', 'height'] as const).filter((key) => w.prop(id, key) !== box[key])
    if (changed.includes('width') || changed.includes('height')) keepDrawnIn(w, design, id)
    for (const key of changed) w.setProp(id, key, box[key])
  }
}

/**
 * Copies a frame onto its page where the frame rule puts it, after the page's last frame, with its
 * name, size and fills, holding a linked copy of every layer at the same index. Returns its id.
 */
export const frameDuplicate = defineCommand({
  name: 'frame.duplicate',
  description:
    'Copies a frame after the last frame of its page, with its name, size and fills and a linked copy of every layer, and returns the copy’s id. It refuses a missing frame and an id already in use.',
  step: 'duplicate',
  input: z.strictObject({
    frameId: FrameId.describe('The frame to copy.'),
    newId: FrameId.optional().describe('The copy’s id; a fresh one is made when left out.'),
  }),
  check: (ctx, { frameId, newId }) => frameProblem(ctx.design, frameId) ?? idProblem(ctx, newId),
  apply: (ctx, { frameId, newId = ctx.newId() }) => copyFrame(ctx, frameId, newId),
})

/**
 * As frame.duplicate, at another size, and named by it: every copy is scaled to it and placed by its
 * constraints, guessed where its original has none, and no text is set under the readable size for
 * it (`sizedLayers`). Returns the new frame's id.
 */
export const frameAddSize = defineCommand({
  name: 'frame.addSize',
  description:
    'Copies a frame at another size, after the last frame of its page, named by the size (such as 1200×628), and returns the new frame’s id. Every layer is a linked copy scaled by the smaller of the two ratios, then placed by its constraints to the new size; a layer with none gets them guessed from where it sits, and its copy keeps the guess. A text that scale would set under the readable size for the new frame (the size check_frame warns under) is set at that size instead, its sizes kept in proportion and its box grown to hold it; one whose lines can’t then break where they did inside the frame grows with its words (auto height). The frame and its layers are not changed. It refuses a missing frame, an id already in use and a size the editor does not take.',
  step: 'addSize',
  input: z.strictObject({
    frameId: FrameId.describe('The frame to copy.'),
    newId: FrameId.optional().describe('The new frame’s id; a fresh one is made when left out.'),
    width: Frame.shape.width.describe('The new frame’s width, in pixels.'),
    height: Frame.shape.height.describe('The new frame’s height, in pixels.'),
  }),
  check: (ctx, { frameId, newId, width, height }) =>
    frameProblem(ctx.design, frameId) ?? idProblem(ctx, newId) ?? sizeProblem(width, height),
  apply: (ctx, { frameId, newId = ctx.newId(), width, height }) => copyFrame(ctx, frameId, newId, { width, height }),
})

/**
 * Deletes a frame, its layers and its connectors, and a section it empties with that section's
 * connectors; their linked copies in other frames stay, and undo brings all back. A page may be left
 * with no frame. On the page, it also deletes what races left (`sweepPage`).
 */
export const frameDelete = defineCommand({
  name: 'frame.delete',
  description:
    'Deletes a frame, its layers and its connectors, and a section it leaves with no frame with that section’s connectors; their linked copies in other frames stay, and a page may be left with no frame. It refuses a missing frame.',
  step: 'delete',
  input: z.strictObject({ frameId: FrameId.describe('The frame to delete.') }),
  check: ({ design }, { frameId }) => frameProblem(design, frameId),
  apply: ({ w, design }, { frameId }) => {
    const records = pageRecords(design, design.frames[frameId]?.pageId ?? '')
    forgetFrame(w, records, frameId)
    deleteFrame(w, design, frameId)
    sweepPage(w, records)
  },
})

/** Deletes a frame's layers and removes the frame, for frame.delete, section.delete and page.delete. */
export function deleteFrame(w: StoreWrite, design: Design, frameId: string) {
  // Its layers are deleted as node.delete deletes them, so undo and other tabs' edits behave alike.
  for (const node of descendants(design, frameId)) w.remove('layer', node)
  w.remove('frame', frameId)
}

/** Where the frame rule puts the new frame `id` on a page, and its order after the page's last frame. */
function nextOnPage(w: StoreWrite, design: Design, pageId: string, id: string) {
  const siblings = framesOf(design, pageId)
  const slots = siblings.map(([sibling, frame]): Slot => [sibling, frame.order])
  const orderOf = writeOrder(w, 'frame', [...slots, [id, null]], new Set([id]))
  return { ...newFramePosition(siblings.map(([, frame]) => frame)), order: orderOf(id) }
}

/**
 * A copy of a frame with a copy of every layer keeping its link id, sized to a new size when it has
 * one (`sizedLayers`). Outside a section it goes where the frame rule puts it; in one, it stays in
 * that section, at the free spot right of the section's rightmost frame, at the original's top
 * (`freeSpot`). A copy at a new size is named by it, such as "1200×628", and has no guides: they
 * belong to the frame's own size.
 */
function copyFrame(ctx: CommandContext, frameId: string, newId: string, size?: Size) {
  const { w, design } = ctx
  const frame = design.frames[frameId] as Frame
  const next = nextOnPage(w, design, frame.pageId, newId)
  const sectionId = sectionOf(design, frameId)
  if (sectionId === undefined) return copyFrameTo(ctx, frameId, newId, next, size)
  const at = freeSpot(design, frame.pageId, size ?? frame, { ...rightmostIn(design, sectionId), y: frame.y })
  return copyFrameTo(ctx, frameId, newId, { ...at, order: next.order, sectionId }, size)
}

/**
 * Copies a frame to `place`, with a copy of every layer keeping its link id, sized to `size` when
 * given (named by it, with no guides). The copy is never starred, and is in the section `place`
 * names, if any. Returns its id.
 */
export function copyFrameTo(ctx: CommandContext, frameId: string, newId: string, place: CopyPlace, size?: Size) {
  const { w, design } = ctx
  const { guides, ...frame } = unmarked(design.frames[frameId] as Frame)
  const to = size ?? frame
  const copy: Frame = {
    ...frame,
    ...(!size && guides && { guides }),
    ...(size && { name: `${size.width}×${size.height}` }),
    width: to.width,
    height: to.height,
    x: place.x,
    y: place.y,
    order: place.order,
    ...(place.sectionId !== undefined && { sectionId: place.sectionId }),
  }
  w.create('frame', newId, copy)
  copyFrameLayers(ctx, frameId, newId, { links: 'keep', ...(size && { props: sizedLayers(design, frameId, size) }) })

  return newId
}

/** A frame's record with no star and in no section: what a copy made in the design starts from. */
export function unmarked(frame: Frame): Frame {
  const copy = { ...frame }
  delete copy.starred
  delete copy.sectionId
  return copy
}

/** The box of the frame of a section whose right edge is furthest right, the first of those that tie. */
function rightmostIn(design: Design, sectionId: string): Rect {
  let rightmost: Rect = { x: 0, y: 0, width: 0, height: 0 }
  let right = -Infinity
  for (const [, frame] of framesInSection(design, sectionId)) {
    if (frame.x + frame.width <= right) continue
    right = frame.x + frame.width
    rightmost = frame
  }
  return rightmost
}

/**
 * The props of a frame's layers, by id, for their copies in a frame of `size`, in three steps. First
 * every layer is scaled by the smaller ratio (`smallerRatio`) about the frame's top left: its box,
 * and its sizes as `scaledSizes` scales them, but the sizes of a text that scale would set under the
 * readable size for `size` by the larger factor that sets its smallest letters at it
 * (`readableScale`). Then the frame, which that scale leaves short of `size` along one side, is
 * resized to it with its layers following their constraints (`followingBoxes`), whatever their
 * locks: a layer whose constraints say where it goes and that has none of its own takes the guess
 * (`guessesUnder`) from where the scale left it, and keeps it. Last, each raised text's box grows
 * to hold its letters (`readableBox`).
 */
function sizedLayers(design: Design, frameId: string, size: Size): Map<string, Layer['props']> {
  const frame = design.frames[frameId] as Frame
  const s = smallerRatio({ from: frame, to: size })
  const readable = readableTextSize(size.width, size.height)
  const by = (n: number) => round(n * s) + 0
  const ids = descendants(design, frameId)
  const nodes = { ...design.nodes }
  // The boxes the scale gave the raised texts, and how many times larger their sizes are than it would set them.
  const raised = new Map<string, { scaled: Rect; raise: number }>()
  for (const id of ids) {
    const node = design.nodes[id] as Layer
    const { x, y, width, height } = node.props
    const box = { x: by(x), y: by(y), width: by(width), height: by(height) }
    const textScale = node.type === 'text' ? readableScale(node.props, s, readable) : s
    if (textScale > s) raised.set(id, { scaled: box, raise: textScale / s })
    nodes[id] = { ...node, props: { ...scaledSizes(node.props, textScale), ...box } } as Layer
  }
  const from = { x: 0, y: 0, width: frame.width * s, height: frame.height * s }
  const guesses = guessesUnder({ ...design, nodes }, frameId, from)
  for (const [id, constraints] of guesses) {
    const node = nodes[id] as Layer
    nodes[id] = { ...node, props: { ...node.props, constraints } } as Layer
  }
  // The rule reads the guesses as the copies' own constraints.
  const placed: Design = { ...design, nodes }
  const boxes = followingBoxes(placed, frameId, from, { x: 0, y: 0, ...size }, { locks: 'ignore' })
  return new Map(
    ids.map((id) => {
      const props = { ...(nodes[id] as Layer).props, ...boxes.get(id) }
      const text = raised.get(id)
      return [id, text ? { ...props, ...readableBox(props, text.scaled, text.raise, size) } : props]
    }),
  )
}
