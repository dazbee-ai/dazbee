// Where a design's frames are: a page's frames in order, the cover frame, where the frame rule puts
// a new one, where something goes below everything on a page, and the frame a layer is in; and what a new frame and a blank design start as.
import type { DesignInput, DesignMeta } from './design.ts'
import type { Paint } from './paint.ts'
import { inOrder } from './primitives.ts'
import type { PageBox } from './sections.ts'

/** The gap the frame rule leaves between a page's rightmost frame and a new one. */
export const FRAME_GAP = 200

/** A new frame's background: white. */
export const NEW_FRAME_FILLS: Paint[] = [{ type: 'solid', color: '#FFFFFFFF' }]

/** A page's frames as `[id, frame]` pairs, by order, ties broken by id. */
export function framesOf<F extends { readonly pageId: string; readonly order: string }>(
  design: { readonly frames: Readonly<Record<string, F>> },
  pageId: string,
): [string, F][] {
  return inOrder(design.frames).filter(([, frame]) => frame.pageId === pageId)
}

/**
 * The design's cover frame: the first frame, by order, of the first page, by order, that has one.
 * Thumbnails, templates and the Recent filter show it. Undefined when no page has a frame.
 */
export function coverFrame<F extends { readonly pageId: string; readonly order: string }>(design: {
  readonly pages: Readonly<Record<string, { readonly order: string }>>
  readonly frames: Readonly<Record<string, F>>
}): [string, F] | undefined {
  for (const [pageId] of inOrder(design.pages)) {
    const first = framesOf(design, pageId)[0]
    if (first) return first
  }
  return undefined
}

/**
 * Where the frame rule puts a new frame among a page's frames: at 0, 0 on an empty page, else
 * FRAME_GAP right of the frame whose right edge is furthest right (the first of those that tie),
 * its top aligned with that frame's.
 */
export function newFramePosition(frames: readonly { x: number; y: number; width: number }[]): {
  x: number
  y: number
} {
  let rightmost: { x: number; y: number; width: number } | undefined
  for (const frame of frames) {
    if (!rightmost || frame.x + frame.width > rightmost.x + rightmost.width) rightmost = frame
  }
  if (!rightmost) return { x: 0, y: 0 }
  return { x: rightmost.x + rightmost.width + FRAME_GAP, y: rightmost.y }
}

/**
 * Where a box of `size` goes beside `from` (a frame or a section's box) without covering a frame of
 * page `pageId`, or the box of one of its drawn sections other than `joins`, the section the box goes
 * in: `gap` (FRAME_GAP unless given) right of `from`, at its top, then moved down below each it
 * overlaps, plus `gap`, until it overlaps none. One only touching its edge is not in the way.
 */
export function freeSpot(
  design: {
    readonly frames: Readonly<
      Record<string, Readonly<PageBox> & { readonly pageId: string; readonly sectionId?: string | undefined }>
    >
    readonly sections?: Readonly<Record<string, { readonly pageId: string }>>
  },
  pageId: string,
  size: { width: number; height: number },
  from: PageBox,
  joins?: string,
  gap = FRAME_GAP,
): { x: number; y: number } {
  const frames = Object.values(design.frames).filter((frame) => frame.pageId === pageId)
  const boxes: PageBox[] = [...frames, ...sectionBoxes(frames, design.sections ?? {}, pageId, joins)]
  const x = from.x + from.width + gap
  let y = from.y
  for (;;) {
    const right = x + size.width
    const bottom = y + size.height
    const below = boxes
      .filter((f) => f.x < right && f.x + f.width > x && f.y < bottom && f.y + f.height > y)
      .reduce((most, f) => Math.max(most, f.y + f.height), -Infinity)
    if (below === -Infinity) return { x, y }
    y = below + gap
  }
}

/**
 * Where something placed below everything on page `pageId` goes, such as a new brief's section: FRAME_GAP
 * below the bottom of the page's lowest frame, at the left of its leftmost frame; at 0, 0 on a page with none.
 */
export function belowAll(
  frames: Readonly<Record<string, Readonly<PageBox> & { readonly pageId: string }>>,
  pageId: string,
): { x: number; y: number } {
  let [left, bottom] = [Infinity, -Infinity]
  for (const frame of Object.values(frames)) {
    if (frame.pageId !== pageId) continue
    left = Math.min(left, frame.x)
    bottom = Math.max(bottom, frame.y + frame.height)
  }
  return bottom === -Infinity ? { x: 0, y: 0 } : { x: left, y: bottom + FRAME_GAP }
}

/**
 * The frame a layer is in, walking up its parents; a frame id gives itself. Undefined when the
 * chain ends at no frame or loops. Takes only what it reads, so a design as stored or as JSON fits.
 */
export function frameIdOf(
  design: {
    readonly frames: Readonly<Record<string, unknown>>
    readonly nodes: Readonly<Record<string, { readonly parentId: string } | undefined>>
  },
  id: string,
): string | undefined {
  const seen = new Set<string>()
  for (let up: string | undefined = id; up !== undefined && !seen.has(up); up = design.nodes[up]?.parentId) {
    if (Object.hasOwn(design.frames, up)) return up
    if (!Object.hasOwn(design.nodes, up)) return undefined
    seen.add(up)
  }
  return undefined
}

/**
 * A blank design: one page, "Page 1", holding an empty white frame of each size given, in the order
 * given, in a row by the frame rule (newFramePosition), with ids `f1`, `f2` …
 */
export function blankDesign(
  meta: DesignMeta,
  frames: readonly { name: string; width: number; height: number }[],
): DesignInput {
  const placed: { x: number; y: number; width: number }[] = []
  const entries = frames.map(({ name, width, height }, i) => {
    const at = newFramePosition(placed)
    placed.push({ ...at, width })
    return [`f${i + 1}`, { pageId: 'p1', name, width, height, ...at, fills: NEW_FRAME_FILLS, order: `a${i}` }] as const
  })
  return { meta, pages: { p1: { name: 'Page 1', order: 'a0' } }, frames: Object.fromEntries(entries), nodes: {} }
}

/**
 * The boxes of page `pageId`'s drawn sections but `joins`, each the union of its frames: one pass over
 * the page's `frames`, grouped by the section each names.
 */
function sectionBoxes(
  frames: readonly (Readonly<PageBox> & { readonly sectionId?: string | undefined })[],
  sections: Readonly<Record<string, { readonly pageId: string }>>,
  pageId: string,
  joins: string | undefined,
): PageBox[] {
  const edges = new Map<string, { left: number; top: number; right: number; bottom: number }>()
  for (const { sectionId: id, x, y, width, height } of frames) {
    if (id === undefined || id === joins || !Object.hasOwn(sections, id) || sections[id]?.pageId !== pageId) continue
    const box = edges.get(id)
    if (!box) edges.set(id, { left: x, top: y, right: x + width, bottom: y + height })
    else {
      box.left = Math.min(box.left, x)
      box.top = Math.min(box.top, y)
      box.right = Math.max(box.right, x + width)
      box.bottom = Math.max(box.bottom, y + height)
    }
  }
  return [...edges.values()].map(({ left, top, right, bottom }) => ({
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  }))
}
