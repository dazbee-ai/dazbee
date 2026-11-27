// A brief's section and drafts as the tab places them: the ids it makes for the section, the four frames and
// their picture layers (ADR-0015), which the round is started with; the commands that place them below
// everything on a page, or, for more like this, right of the liked draft's section joined to the draft by a
// connector, each frame holding one picture layer that waits in a plain colour until its picture arrives, and what
// it holds; and whether one more brief would take the design past its size warning.
import type { Session } from '@dazbee/doc'
import {
  type AiSize,
  belowAll,
  briefTitle,
  type DesignSize,
  FRAME_GAP,
  freeSpot,
  type Layer,
  type PageBox,
  type Paint,
  PICTURE_NAME,
  type Point,
  ROUND_DRAFTS,
  type RoundPlan,
  sectionBox,
  SYNC_LIMITS,
  WAITING_FILL,
} from '@dazbee/schema'

import { outlineRoom } from '../canvas/sections.ts'
import { shareOf } from '../link-notices.ts'

/** What placing a brief writes: its plan, the page, the section's title, the frames' size and names. */
export interface BriefPlacing {
  plan: RoundPlan
  pageId: string
  /** The brief's words: the section is titled with their first line. */
  words: string
  /** Every frame's size, or each frame's, by its place from 0, as other sizes give them. */
  size: AiSize | readonly AiSize[]
  /** Each draft's name, by its place from 0. */
  draftName: (n: number) => string
  /** The section's title, when not the brief's first line. */
  title?: string
  /** The frame the section is joined to by a connector from it, as more like this joins it to the liked draft. */
  from?: string
}

/** More than the bytes a brief's section, four frames and four picture layers take in the design. */
const BRIEF_BYTES = 4096

/**
 * Where a brief of `size` goes on page `pageId`: below the page's lowest frame, at the left of its frames, far
 * enough below that its outline and title clear what is above (`outlineRoom`) at the zoom it is seen at, which
 * `zoomFor` gives for the area of the page with the brief in it (the lower of the zoom now and the zoom that area
 * fits at), and at any zoom further out.
 */
export function briefSpot(
  frames: Readonly<Record<string, Readonly<PageBox> & { readonly pageId: string }>>,
  pageId: string,
  size: AiSize,
  zoomFor: (area: PageBox) => number,
): Point {
  const row = { width: ROUND_DRAFTS * size.width + (ROUND_DRAFTS - 1) * FRAME_GAP, height: size.height }
  const page = Object.values(frames).filter((frame) => frame.pageId === pageId)
  let gap = FRAME_GAP
  // The gap moves the row down, which can lower the zoom the page fits at: worked out twice.
  for (let pass = 0; pass < 2; pass++) {
    const at = belowAll(frames, pageId, gap)
    const boxes = [...page, { ...at, ...row }]
    const left = Math.min(...boxes.map((b) => b.x))
    const top = Math.min(...boxes.map((b) => b.y))
    const right = Math.max(...boxes.map((b) => b.x + b.width))
    const bottom = Math.max(...boxes.map((b) => b.y + b.height))
    gap = Math.ceil(FRAME_GAP + outlineRoom(zoomFor({ x: left, y: top, width: right - left, height: bottom - top })))
  }
  return belowAll(frames, pageId, gap)
}

/**
 * Where more like this, or other sizes, of frame `frameId` puts its row of frames, four drafts of `size` or one of
 * each size given, on the frame's page: in the column right of
 * the frame's section (of the frame itself when it is in none), at its top, moved down below each frame or section
 * in the way, far enough apart that the outlines and titles clear each other at the zoom `zoomFor` gives for the page
 * with the drafts in it, as a brief's spot is. Null for a frame the design hasn't.
 */
export function moreLikeSpot(
  design: Parameters<typeof freeSpot>[0] & Parameters<typeof sectionBox>[0],
  frameId: string,
  size: AiSize | readonly AiSize[],
  zoomFor: (area: PageBox) => number,
): Point | null {
  const frame = design.frames[frameId]
  if (!frame) return null
  const from = (frame.sectionId && sectionBox(design, frame.sectionId)) || frame
  const row = rowOf(size)
  const page = Object.values(design.frames).filter((f) => f.pageId === frame.pageId)
  let gap = FRAME_GAP
  // The gap moves the row, which can lower the zoom the page fits at: worked out twice.
  for (let pass = 0; pass < 2; pass++) {
    const at = freeSpot(design, frame.pageId, row, from, undefined, gap)
    const boxes = [...page, { ...at, ...row }]
    const left = Math.min(...boxes.map((b) => b.x))
    const top = Math.min(...boxes.map((b) => b.y))
    const right = Math.max(...boxes.map((b) => b.x + b.width))
    const bottom = Math.max(...boxes.map((b) => b.y + b.height))
    gap = Math.ceil(FRAME_GAP + outlineRoom(zoomFor({ x: left, y: top, width: right - left, height: bottom - top })))
  }
  return freeSpot(design, frame.pageId, row, from, undefined, gap)
}

/**
 * Runs the commands that place a brief at `at` on its page: its frames in a row, FRAME_GAP apart, each with a
 * picture layer filling it in WAITING_FILL, then its section of them, titled with the brief's first line or the
 * title given, then the connector to it from the frame `from` names, if one does. The caller runs them in one
 * gesture, as one step.
 */
export function placeBrief(session: Pick<Session, 'run'>, placing: BriefPlacing, at: Point): void {
  const { plan, pageId } = placing
  let x = at.x
  plan.frames.forEach(({ frameId, pictureLayerId }, n) => {
    const size = sizeOf(placing.size, n)
    session.run('frame.add', {
      id: frameId,
      pageId,
      name: placing.draftName(n),
      width: size.width,
      height: size.height,
      x,
      y: at.y,
    })
    x += size.width + FRAME_GAP
    session.run('node.create', {
      id: pictureLayerId,
      parentId: frameId,
      layer: {
        type: 'graphic',
        name: PICTURE_NAME,
        props: { x: 0, y: 0, width: size.width, height: size.height, shape: { kind: 'rect' }, fills: [WAITING_FILL] },
      },
    })
  })
  session.run('section.add', {
    pageId,
    id: plan.sectionId,
    title: placing.title ?? briefTitle(placing.words),
    frameIds: plan.frames.map((f) => f.frameId),
  })
  if (placing.from) session.run('connector.add', { pageId, from: placing.from, to: plan.sectionId })
}

/**
 * What a frame's picture layer holds against picture `assetId`: the picture (`shows`), the plain fill it waits in
 * (`waits`), or anything else a person put there (`other`).
 */
export function pictureState(layer: Pick<Layer, 'props'>, assetId: string): 'shows' | 'waits' | 'other' {
  const fills = fillsOf(layer)
  if (fills.some((fill) => fill.type === 'image' && fill.assetId === assetId)) return 'shows'
  const [only] = fills
  return fills.length === 1 && only?.type === 'solid' && only.color === WAITING_FILL.color ? 'waits' : 'other'
}

/** The picture a picture layer shows: its image fill's asset; null for none. */
export function shownPicture(layer: Pick<Layer, 'props'>): string | null {
  const image = fillsOf(layer).find((fill) => fill.type === 'image')
  return image?.type === 'image' ? image.assetId : null
}

/** Whether one more brief would take a design of `size` to its size warning (SYNC_LIMITS.warnAt) or past it. */
export function briefPassesWarning(size: DesignSize): boolean {
  const after = {
    ...size,
    layers: size.layers + ROUND_DRAFTS,
    frames: size.frames + ROUND_DRAFTS,
    sections: (size.sections || 0) + 1,
    bytes: size.bytes + BRIEF_BYTES,
  }
  return shareOf(after).share >= SYNC_LIMITS.warnAt
}

/** A layer's fills; none for a layer that has no fills. */
function fillsOf(layer: Pick<Layer, 'props'>): Paint[] {
  return ('fills' in layer.props ? layer.props.fills : []) as Paint[]
}

/** Frame `n`'s size, of every frame's size or each frame's. */
function sizeOf(size: AiSize | readonly AiSize[], n: number): AiSize {
  return 'width' in size ? size : (size[n] ?? size[0] ?? { width: 1, height: 1 })
}

/** The box a row of frames takes, FRAME_GAP apart: four drafts of one size, or a frame of each size given. */
function rowOf(size: AiSize | readonly AiSize[]): { width: number; height: number } {
  const sizes = 'width' in size ? Array.from({ length: ROUND_DRAFTS }, () => size) : size
  return {
    width: sizes.reduce((sum, s) => sum + s.width, 0) + Math.max(0, sizes.length - 1) * FRAME_GAP,
    height: Math.max(...sizes.map((s) => s.height)),
  }
}
