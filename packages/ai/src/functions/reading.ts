// The reading: the text of each text block a layer plan found, read from the whole ad.
import { answerSchema, type CallInput, type LayerPlanAnswer, ReadingAnswer } from '@dazbee/schema'

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

/**
 * The reading of `picture`'s text blocks: the whole ad, with each block's id, its place on the planner's 0 to 999
 * grid and the text the plan found for it, as the first reading.
 */
export function readCall(picture: string, texts: LayerPlanAnswer['elements'], reader: string): CallInput {
  const blocks = texts.map(
    ({ id, box, text_lines: lines, content }) =>
      `${id} (x ${box.x_min}–${box.x_max}, y ${box.y_min}–${box.y_max} of 999): ${JSON.stringify(lines.length > 0 ? lines.join('\n') : content)}`,
  )
  return {
    kind: 'text',
    instructions: reader,
    prompt: `The attached picture is the whole ad. Its text blocks, by id, with where each lies and its first reading:\n${blocks.join('\n')}`,
    pictures: [picture],
    schema: answerSchema(ReadingAnswer),
  }
}
