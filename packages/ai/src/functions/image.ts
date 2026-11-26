// The image function: one picture made from a person's own words, at the ratio they picked.
import type { CallInput, ImageInput } from '@dazbee/schema'

import { IMAGE_SIZES } from '../call-size.ts'
import type { AiFunctionDef } from './types.ts'

export const image: AiFunctionDef = {
  kind: 'picture',
  presets: {
    // 17–26 s a picture at a flat price (`docs/research/ai-flow-image-models.md`).
    muse: { model: 'muse-image-1.0', settings: {}, guess: { cost: 930_000n, seconds: 26 } },
  },
}

/** The image's call: the person's words as written, with no picture given, at the ratio's size. */
export function imageCall(input: ImageInput): CallInput {
  return { kind: 'picture', prompt: input.words, pictures: [], ...IMAGE_SIZES[input.ratio] }
}
