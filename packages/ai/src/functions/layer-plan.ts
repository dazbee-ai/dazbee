// The layer plan: the parts of a frame's picture and the layers it is split into, made for each frame of a
// layering job from that frame's own picture.
import { answerSchema, type CallInput, LayerPlanAnswer } from '@dazbee/schema'

import { PLANNER_PROMPT } from '../prompts/ads/layer-planner.ts'
import type { AiFunctionDef } from './types.ts'

export const layerPlan: AiFunctionDef = {
  kind: 'text',
  prompt: PLANNER_PROMPT,
  answer: LayerPlanAnswer,
  ceiling: 16_000,
  // A plan of an ad with many parts writes for most of a minute: of 19 paid plans by each preset, made 36 at once,
  // the slowest by terra took 47.9 s and three by sol over 60 s (`docs/research/ai-flow-image-models.md`, the runs
  // of 27 Nov 2026).
  timeoutMs: 120_000,
  presets: {
    // The dearest and slowest of 19 paid plans of square, wide and tall ads: 1,243 tokens in, 2,501 cached and
    // 3,965 out, in 47.9 s (`docs/research/ai-flow-image-models.md`, the runs of 27 Nov 2026).
    terra: {
      model: 'gpt-6.1-terra',
      settings: { effort: 'medium', tier: 'standard' },
      guess: { cost: 2_410_000n, seconds: 48 },
    },
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
