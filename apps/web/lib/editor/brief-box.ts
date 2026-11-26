// What the brief box in a design offers and says: the sizes the AI is offered from the Add a frame card's list, each
// drawn as its shape; the two speeds, one toggle; what a key in its words does; and what it says for a brief that
// didn't start.
import { type AiJobRefusal, type AiMode, isAiSize, SIZE_PRESETS, type SizePreset } from '@dazbee/schema'

/** What the brief box says for a brief that didn't start, by its words' key. */
export type BriefSaid = 'usedUp' | 'paused' | 'notAllowed' | 'notStarted' | 'notPlaced' | 'unknown'

/** What a key in the brief's words does: makes the drafts, closes the box, or what it does in any text. */
export type BriefKey = 'make' | 'close' | null

/** The Add a frame card's sizes the AI is offered, from 1:3 to 3:1, in its order. */
export const AI_SIZE_PRESETS: readonly SizePreset[] = SIZE_PRESETS.filter(isAiSize)

/**
 * What a key pressed in the brief's words does: Enter makes the drafts and Escape closes the box. Shift+Enter, or
 * Enter while an input method composes, is left to the text, which keeps the line break.
 */
export function briefKey({
  key,
  shiftKey,
  isComposing,
}: {
  key: string
  shiftKey: boolean
  isComposing: boolean
}): BriefKey {
  if (key === 'Escape') return 'close'
  return key === 'Enter' && !shiftKey && !isComposing ? 'make' : null
}

/** The speed the toggle turns to from `mode`: Fast to Precise and back. */
export function otherMode(mode: AiMode): AiMode {
  return mode === 'fast' ? 'precise' : 'fast'
}

/** A size's shape drawn to fit a `box`-pixel square, its sides whole pixels and at least 3. */
export function shapeIn(size: { width: number; height: number }, box: number): { width: number; height: number } {
  const k = box / Math.max(size.width, size.height)
  return { width: Math.max(3, Math.round(size.width * k)), height: Math.max(3, Math.round(size.height * k)) }
}

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
