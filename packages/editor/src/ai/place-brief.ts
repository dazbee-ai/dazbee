// A brief's section and drafts as the tab places them: the ids it makes for the section, the four frames and
// their picture layers (ADR-0015), which the round is started with; the commands that place them below
// everything on a page, each frame holding one picture layer that waits in a plain colour until its picture
// arrives; and whether one more brief would take the design past its size warning.
import type { Session } from '@dazbee/doc'
import {
  type AiFrameTarget,
  type AiSize,
  briefTitle,
  type DesignSize,
  FRAME_GAP,
  type Point,
  type SolidPaint,
  SYNC_LIMITS,
} from '@dazbee/schema'

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
