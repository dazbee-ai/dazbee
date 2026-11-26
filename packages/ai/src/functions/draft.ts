// The draft: one ad drawn from a round plan's prompt, with the brief's pictures.
import { type AiMode, type AiSize, type CallInput, MAX_REFERENCES, type RoundPlanAnswer } from '@dazbee/schema'

import { callSize, pictureLimits, shapeOf } from '../call-size.ts'
import { DRAFT_PROMPT, PICTURES_SENTENCE } from '../prompts/ads/draft.ts'
import type { AiFunctionDef } from './types.ts'

export const draft: AiFunctionDef = {
  kind: 'picture',
  // The prompt of a draft whose plan gave none; a planned draft is drawn from the plan's own prompt.
  prompt: DRAFT_PROMPT,
  presets: {
    // 14–28 s a draft; the dearest of 13 paid square drafts at medium, each with one brief picture
    // (`docs/research/ai-flow-image-models.md`, the runs of 26 Nov 2026).
    'gpt-image-medium': {
      model: 'gpt-image-2.5-sunburst',
      settings: { quality: 'medium' },
      guess: { cost: 3_050_000n, seconds: 28 },
    },
  },
}

/** What a draft is made from: the brief's words, its pictures and kit logo, its size and its mode. */
export interface DraftBrief {
  words: string
  pictures: string[]
  logoKey?: string | undefined
  size: AiSize
  mode: AiMode
}

/** The brief's own pictures and its kit logo, each once, as many as a call sends. */
export function briefPictures(brief: DraftBrief): string[] {
  return [...new Set([...brief.pictures, ...(brief.logoKey ? [brief.logoKey] : [])])].slice(0, MAX_REFERENCES)
}

/**
 * Draft `n`'s picture call: the plan's prompt for it with the pictures sentence when the brief has pictures, or
 * `plain`, the draft preset's own prompt, filled in when the plan gave none; with the brief's pictures, at the draft
 * model's call size.
 */
export function draftCall(
  brief: DraftBrief,
  plan: RoundPlanAnswer | null,
  n: number,
  model: string,
  plain: string,
): CallInput {
  const pictures = briefPictures(brief)
  const planned = plan?.ads[n]?.prompt.trim()
  const prompt = planned
    ? [planned, ...(pictures.length > 0 ? [PICTURES_SENTENCE] : [])].join('\n\n')
    : plain
        .replace('{shape}', () => shapeOf(brief.size))
        .replace('{brief}', () => brief.words)
        .replace('{pictures}', () => (pictures.length > 0 ? `- ${PICTURES_SENTENCE}\n` : ''))
  return { kind: 'picture', prompt, pictures, ...callSize(brief.size, pictureLimits(model)) }
}
