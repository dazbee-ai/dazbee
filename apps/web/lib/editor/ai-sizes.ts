// What Other sizes and Make all editable read of a design's AI frames: the sizes the AI is offered from a list of
// picked tiles, and a section of AI sizes as one Make all editable takes it: its frames still a picture.
import { type DesignAi, isAiSize } from '@dazbee/schema'

/** A design as these read it: its frames. */
interface Placed {
  frames: Readonly<Record<string, { sectionId?: string | undefined; width: number; height: number }>>
}

/** A section of AI sizes to make editable together: its frames. */
export interface SizesToLayer {
  frameIds: string[]
}

/** The picked sizes the AI may redraw: from 1:3 to 3:1. */
export function aiSizes<S extends { width: number; height: number }>(picked: readonly S[]): S[] {
  return picked.filter(isAiSize)
}

/**
 * Section `sectionId` as Make all editable takes it: its AI frames of the size kind that show their picture, at
 * least two; null for any other section.
 */
export function sizesToLayer(ai: DesignAi | null, design: Placed, sectionId: string): SizesToLayer | null {
  const frameIds = (ai?.frames ?? [])
    .filter((f) => f.kind === 'size' && f.state === 'arrived' && design.frames[f.frameId]?.sectionId === sectionId)
    .map((f) => f.frameId)
  return frameIds.length >= 2 ? { frameIds } : null
}
