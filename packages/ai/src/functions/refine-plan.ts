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
    // Worked out, not measured: 10,000 tokens in and 1,000 out at OpenAI's fast-tier prices, at 142 tokens a second.
    luna: {
      model: 'gpt-6-luna',
      settings: { effort: 'low', tier: 'fast' },
      guess: { cost: 350_000n, seconds: 7 },
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
