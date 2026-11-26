// The reading: the text of each text block a layer plan found, read from the whole ad.
import { ReadingAnswer } from '@dazbee/schema'

import { READING_PROMPT } from '../prompts/ads/reading.ts'
import type { AiFunctionDef } from './types.ts'

export const reading: AiFunctionDef = {
  kind: 'text',
  prompt: READING_PROMPT,
  answer: ReadingAnswer,
  ceiling: 8000,
  presets: {
    // Worked out, not measured: 8,000 tokens in and 2,000 out at OpenAI's prices, at 142 tokens a second.
    luna: {
      model: 'gpt-6-luna',
      settings: { effort: 'none', tier: 'standard' },
      guess: { cost: 210_000n, seconds: 14 },
    },
  },
}
