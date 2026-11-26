// The reference read: what kind of ad a reference picture is.
import { ReferenceReadAnswer } from '@dazbee/schema'

import { REFERENCE_READER } from '../prompts/ads/reference.ts'
import type { AiFunctionDef } from './types.ts'

export const referenceRead: AiFunctionDef = {
  kind: 'text',
  prompt: REFERENCE_READER,
  answer: ReferenceReadAnswer,
  ceiling: 2000,
  presets: {
    // Worked out, not measured: 5,500 tokens in and 500 out at OpenAI's fast-tier prices, at 142 tokens a second.
    luna: {
      model: 'gpt-6-luna',
      settings: { effort: 'low', tier: 'fast' },
      guess: { cost: 190_000n, seconds: 4 },
    },
  },
}
