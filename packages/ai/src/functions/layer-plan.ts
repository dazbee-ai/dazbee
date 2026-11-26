// The layer plan: the layers a draft is split into, made once for every size of it.
import { answerSchema, type CallInput, LayerPlanAnswer } from '@dazbee/schema'

import { PLANNER_PROMPT } from '../prompts/ads/layer-planner.ts'
import type { AiFunctionDef } from './types.ts'

export const layerPlan: AiFunctionDef = {
  kind: 'text',
  prompt: PLANNER_PROMPT,
  answer: LayerPlanAnswer,
  ceiling: 16_000,
  presets: {
    // Worked out, not measured: 8,000 tokens in and 4,000 out at OpenAI's prices, at 49 tokens a second.
    sol: {
      model: 'gpt-6.2-sol',
      settings: { effort: 'medium', tier: 'standard' },
      guess: { cost: 6_370_000n, seconds: 82 },
    },
  },
}

/** The layer plan's call on the plan's picture. */
export function planCall(picture: string, planner: string): CallInput {
  return {
    kind: 'text',
    instructions: planner,
    prompt: 'The attached picture is the ad.',
    pictures: [picture],
    schema: answerSchema(LayerPlanAnswer),
  }
}
