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
    // One paid plan of a square draft: 3,854 tokens in and 2,729 out, in 37.3 s
    // (`docs/research/ai-flow-image-models.md`, the runs of 26 Nov 2026).
    sol: {
      model: 'gpt-6.2-sol',
      settings: { effort: 'medium', tier: 'standard' },
      guess: { cost: 3_980_000n, seconds: 38 },
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
