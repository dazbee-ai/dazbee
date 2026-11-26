// A brief's section and drafts as the tab places them: the ids it makes for the section, the four frames and
// their picture layers (ADR-0015), which the round is started with; the commands that place them below
// everything on a page, each frame holding one picture layer that waits in a plain colour until its picture
// arrives, and what it holds; and whether one more brief would take the design past its size warning.
import type { Session } from '@dazbee/doc'
import {
  type AiFrameTarget,
  type AiSize,
  belowAll,
  briefTitle,
  type DesignSize,
  FRAME_GAP,
  type Layer,
  type PageBox,
  type Paint,
  type Point,
  type SolidPaint,
  SYNC_LIMITS,
} from '@dazbee/schema'

import { LABEL_ROOM } from '../canvas/frames.ts'
import { OUTLINE_PAD, TITLE_ROW } from '../canvas/sections.ts'
import { shareOf } from '../link-notices.ts'

/** A brief's section and frames as the tab made their ids, before they are placed. */
export interface BriefPlan {
  sectionId: string
  /** The four frames, one per draft, in the order of the round plan's ads. */
  frames: AiFrameTarget[]
}

/** What placing a brief writes: its plan, the page, the section's title, the frames' size and names. */
export interface BriefPlacing {
  plan: BriefPlan
  pageId: string
  /** The brief's words: the section is titled with their first line. */
  words: string
  size: AiSize
  /** Each draft's name, by its place from 0. */
  draftName: (n: number) => string
}

/** How many drafts a round makes. */
export const DRAFTS = 4

/** The fill a picture layer waits in until its picture arrives: a plain warm grey, as a waiting frame exports. */
export const WAITING_FILL: SolidPaint = { type: 'solid', color: '#EFE9E1FF' }

/** The name of a draft's picture layer. */
export const PICTURE_NAME = 'Picture'

/**
 * The screen pixels between a brief's frames and the frames above them that the outlines and labels take, the same
 * at any zoom: the outline's pad below the frames above, the new outline's pad and title row, and its frames' labels.
 */
export const BRIEF_SCREEN_ROOM = OUTLINE_PAD + OUTLINE_PAD + TITLE_ROW + LABEL_ROOM

/** More than the bytes a brief's section, four frames and four picture layers take in the design. */
const BRIEF_BYTES = 4096

/** A brief's section, frame and picture layer ids, made with `newId`. */
export function planBrief(newId: () => string): BriefPlan {
  const frames = Array.from({ length: DRAFTS }, () => {
    const frameId = newId()
    return { frameId, pictureLayerId: pictureLayerOf(frameId) }
  })
  return { sectionId: newId(), frames }
}

/**
 * The id of the picture layer of the AI frame `frameId`: any tab finds it from the frame's id alone, since the API
 * keeps the frame's id and not the layer's.
 */
export function pictureLayerOf(frameId: string): string {
  return `${frameId}-picture`
}

/**
 * Where a brief of `size` goes on page `pageId`: below the page's lowest frame, at the left of its frames, far
 * enough below that its outline and title clear what is above at the zoom it is seen at, which `zoomFor` gives for
 * the area of the page with the brief in it (the lower of the zoom now and the zoom that area fits at).
 */
export function briefSpot(
  frames: Readonly<Record<string, Readonly<PageBox> & { readonly pageId: string }>>,
  pageId: string,
  size: AiSize,
  zoomFor: (area: PageBox) => number,
): Point {
  const row = { width: DRAFTS * size.width + (DRAFTS - 1) * FRAME_GAP, height: size.height }
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
    gap = Math.ceil(
      FRAME_GAP + BRIEF_SCREEN_ROOM / zoomFor({ x: left, y: top, width: right - left, height: bottom - top }),
    )
  }
  return belowAll(frames, pageId, gap)
}

/**
 * Runs the commands that place a brief at `at` on its page: its frames in a row, FRAME_GAP apart, each with a
 * picture layer filling it in WAITING_FILL, then its section of them, titled with the brief's first line. The
 * caller runs them in one gesture, as one step.
 */
export function placeBrief(session: Pick<Session, 'run'>, placing: BriefPlacing, at: Point): void {
  const { plan, pageId, size } = placing
  plan.frames.forEach(({ frameId, pictureLayerId }, n) => {
    session.run('frame.add', {
      id: frameId,
      pageId,
      name: placing.draftName(n),
      width: size.width,
      height: size.height,
      x: at.x + n * (size.width + FRAME_GAP),
      y: at.y,
    })
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
    title: briefTitle(placing.words),
    frameIds: plan.frames.map((f) => f.frameId),
  })
}

/**
 * What a frame's picture layer holds against picture `assetId`: the picture (`shows`), the plain fill it waits in
 * (`waits`), or anything else a person put there (`other`).
 */
export function pictureState(layer: Pick<Layer, 'props'>, assetId: string): 'shows' | 'waits' | 'other' {
  const fills = ('fills' in layer.props ? layer.props.fills : []) as Paint[]
  if (fills.some((fill) => fill.type === 'image' && fill.assetId === assetId)) return 'shows'
  const [only] = fills
  return fills.length === 1 && only?.type === 'solid' && only.color === WAITING_FILL.color ? 'waits' : 'other'
}

/** Whether one more brief would take a design of `size` to its size warning (SYNC_LIMITS.warnAt) or past it. */
export function briefPassesWarning(size: DesignSize): boolean {
  const after = {
    ...size,
    layers: size.layers + DRAFTS,
    frames: size.frames + DRAFTS,
    sections: (size.sections || 0) + 1,
    bytes: size.bytes + BRIEF_BYTES,
  }
  return shareOf(after).share >= SYNC_LIMITS.warnAt
}
