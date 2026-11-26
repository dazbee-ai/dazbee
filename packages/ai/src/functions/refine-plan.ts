// The refine plan: one instruction written from a person's message, the ad and its marked copy.
import { answerSchema, type CallInput, type RefineInput, RefinePlanAnswer } from '@dazbee/schema'

import { REFINE_EDITOR } from '../prompts/ads/refine-editor.ts'
import type { AiFunctionDef } from './types.ts'

export const refinePlan: AiFunctionDef = {
  kind: 'text',
  prompt: REFINE_EDITOR,
  answer: RefinePlanAnswer,
  ceiling: 4000,
  presets: {
    // One paid plan of an ad with no marks: 1,745 tokens in and 131 out, in 2.0 s
    // (`docs/research/ai-flow-image-models.md`, the runs of 26 Nov 2026).
    luna: {
      model: 'gpt-6-luna',
      settings: { effort: 'low', tier: 'fast' },
      guess: { cost: 60_000n, seconds: 2 },
    },
  },
}

/** The refine plan's call: its prompt, the person's message, the ad and its marked copy when it has one. */
export function planCall(input: RefineInput, marked: string | undefined, editor: string): CallInput {
  const marks = marked ? "\n\nThe second attached picture is the ad with the advertiser's numbered marks." : ''
  return {
    kind: 'text',
    instructions: editor,
    prompt: `The advertiser's message:\n${input.message}${marks}`,
    pictures: [input.pictureKey, ...(marked ? [marked] : [])],
    schema: answerSchema(RefinePlanAnswer),
  }
}
