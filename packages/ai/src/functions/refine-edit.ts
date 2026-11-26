// The refine edit: the clean ad edited with the refine plan's instruction alone.
import type { CallInput, RefineInput } from '@dazbee/schema'

import { callSize, pictureLimits } from '../call-size.ts'
import type { AiFunctionDef } from './types.ts'

export const refineEdit: AiFunctionDef = {
  kind: 'picture',
  presets: {
    // 22–117 s an edit; US$0.027 for a 1K edit with its input picture (`docs/research/ai-flow-image-models.md`).
    seedream: { model: 'seedream-5.5', settings: {}, guess: { cost: 2_600_000n, seconds: 117 } },
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
