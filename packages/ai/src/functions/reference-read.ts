// The reference read: what kind of ad a reference picture is.
import { answerSchema, type CallInput, type CallOutput, ReferenceReadAnswer } from '@dazbee/schema'

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

/** The reference read's call on the reference picture. */
export function referenceReadCall(key: string, reader: string): CallInput {
  return {
    kind: 'text',
    instructions: reader,
    prompt: 'The attached picture is the reference.',
    pictures: [key],
    schema: answerSchema(ReferenceReadAnswer),
  }
}

/** The kind of ad the reference read found, or null when the read failed. */
export function readKind(read: CallOutput | null): string | null {
  const answer = read?.kind === 'text' ? ReferenceReadAnswer.safeParse(read.json) : null
  return answer?.success ? answer.data.kind : null
}
