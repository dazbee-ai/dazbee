// The refine edit: the clean ad edited with the refine plan's instruction alone.
import type { CallInput, RefineInput } from '@dazbee/schema'

import { callSize, pictureLimits } from '../call-size.ts'
import type { AiFunctionDef } from './types.ts'

export const refineEdit: AiFunctionDef = {
  kind: 'picture',
  presets: {
    // 22–117 s an edit; US$0.02 an edit, its input picture free, in three paid edits
    // (`docs/research/ai-flow-image-models.md`).
    seedream: { model: 'seedream-5.5', settings: {}, guess: { cost: 1_930_000n, seconds: 117 } },
  },
}

/** The edit's call: the clean ad and the instruction, at the edit model's call size. */
export function editCall(input: RefineInput, instruction: string, model: string): CallInput {
  return {
    kind: 'picture',
    prompt: instruction,
    pictures: [input.pictureKey],
    ...callSize(input.size, pictureLimits(model)),
  }
}
