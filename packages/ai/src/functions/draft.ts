// The draft: one ad drawn from a round plan's prompt, with the brief's pictures.
import { DRAFT_PROMPT } from '../prompts/ads/draft.ts'
import type { AiFunctionDef } from './types.ts'

export const draft: AiFunctionDef = {
  kind: 'picture',
  // The prompt of a draft whose plan gave none; a planned draft is drawn from the plan's own prompt.
  prompt: DRAFT_PROMPT,
  presets: {
    // 14–27 s a draft, one round at a time; ₹1.27 for a square at medium (`docs/research/ai-flow-image-models.md`).
    'gpt-image-medium': {
      model: 'gpt-image-2.5-sunburst',
      settings: { quality: 'medium' },
      guess: { cost: 1_270_000n, seconds: 28 },
    },
  },
}
