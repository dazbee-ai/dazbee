// What the stage shows of the design's AI frames beside the canvas's own drawing: a note on each frame of the shown
// page whose picture didn't come out, saying what wasn't charged, and the pictures of each brief beside its section's
// title. Read from the design's AI frames as last read; a frame or section the design no longer has shows nothing.
import type { DesignAi } from '@dazbee/schema'

/** What a failed frame's note says wasn't charged: the draft, the size, or nothing at all when its plan failed. */
export type NotCharged = 'draft' | 'size' | 'nothing'

/** A failed AI frame's note. */
export interface FailedNote {
  frameId: string
  notCharged: NotCharged
}

/** A brief's pictures beside its section's title. */
export interface BriefChips {
  sectionId: string
  assetIds: string[]
}

/** The design as these read it: where its frames and sections are. */
interface Placed {
  frames: Readonly<Record<string, { pageId: string }>>
  sections: Readonly<Record<string, { pageId: string }>>
}

/**
 * The notes of the failed AI frames on page `pageId`. A draft whose round's plan failed charged nothing, since no
 * draft was made; another failed draft wasn't charged, nor was a failed size.
 */
export function failedNotes(ai: DesignAi | null, design: Placed, pageId: string): FailedNote[] {
  return (ai?.frames ?? []).flatMap((frame) => {
    if (frame.state !== 'failed' || design.frames[frame.frameId]?.pageId !== pageId) return []
    const brief = ai?.briefs.find((b) => b.id === frame.briefId)
    const notCharged: NotCharged = frame.kind === 'size' ? 'size' : brief && !brief.planned ? 'nothing' : 'draft'
    return [{ frameId: frame.frameId, notCharged }]
  })
}

/** The pictures of each brief with any whose section is on page `pageId`, in the brief's order. */
export function briefChips(ai: DesignAi | null, design: Placed, pageId: string): BriefChips[] {
  return (ai?.briefs ?? []).flatMap((brief) =>
    brief.pictureAssetIds.length > 0 && design.sections[brief.sectionId]?.pageId === pageId
      ? [{ sectionId: brief.sectionId, assetIds: brief.pictureAssetIds }]
      : [],
  )
}
