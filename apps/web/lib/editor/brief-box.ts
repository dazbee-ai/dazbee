// What the brief box in a design offers and says: the sizes the AI is offered from the Add a frame card's list, and
// what it says for a brief that didn't start.
import { type AiJobRefusal, isAiSize, SIZE_PRESETS, type SizePreset } from '@dazbee/schema'

/** What the brief box says for a brief that didn't start, by its words' key. */
export type BriefSaid = 'usedUp' | 'paused' | 'notAllowed' | 'notStarted' | 'notPlaced' | 'unknown'

/** The Add a frame card's sizes the AI is offered, from 1:3 to 3:1, in its order. */
export const AI_SIZE_PRESETS: readonly SizePreset[] = SIZE_PRESETS.filter(isAiSize)

/**
 * What the box says for a brief refused for `refusal`, or for another reason with none; for one whose job was saved
 * but whose drafts the design didn't take (`notPlaced`); or for one whose answer was lost (`unknown`).
 */
export function briefSaid({
  refusal,
  notPlaced,
  unknown,
}: {
  refusal: AiJobRefusal | null
  notPlaced?: true
  unknown?: true
}): BriefSaid {
  if (notPlaced) return 'notPlaced'
  if (unknown) return 'unknown'
  switch (refusal) {
    case 'used-up':
      return 'usedUp'
    case 'stopped':
      return 'paused'
    case 'not-allowed':
      return 'notAllowed'
    case null:
      return 'notStarted'
  }
}
