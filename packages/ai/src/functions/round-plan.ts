// The round plan: four ads planned from a brief, the brand's facts and its pictures.
import { RoundPlanAnswer } from '@dazbee/schema'

import { ROUND_DIRECTOR } from '../prompts/ads/round-director.ts'
import { ROUND_DIRECTOR_LIGHT } from '../prompts/ads/round-director-light.ts'
import type { AiFunctionDef } from './types.ts'

export const roundPlan: AiFunctionDef = {
  kind: 'text',
  answer: RoundPlanAnswer,
  // The planners reason before they write four long prompts, past the 60 s a text call usually gets.
  timeoutMs: 240_000,
  presets: {
    // 7.5–10.0 s over four rounds of real briefs; 6,000 tokens in and 3,000 out at OpenAI's fast-tier prices.
    'light-luna': {
      model: 'gpt-6-luna',
      settings: { effort: 'low', tier: 'fast' },
      prompt: ROUND_DIRECTOR_LIGHT,
      ceiling: 12_000,
      guess: { cost: 480_000n, seconds: 10 },
    },
    // 28.4–32.9 s over four rounds of real briefs; 12,000 tokens in and 6,000 out at OpenAI's prices.
    'full-terra': {
      model: 'gpt-6.1-terra',
      settings: { effort: 'low', tier: 'standard' },
      prompt: ROUND_DIRECTOR,
      ceiling: 24_000,
      guess: { cost: 4_780_000n, seconds: 33 },
    },
  },
}
