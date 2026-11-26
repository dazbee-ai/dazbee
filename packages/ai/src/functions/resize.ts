// The resize: a draft's picture drawn again in another shape.
import type { AiFunctionDef } from './types.ts'

/**
 * The resize instruction: a plain stand-in for the resize prompt, which is not written yet. `{shape}` is the size's
 * shape in words.
 */
export const RESIZE_PROMPT = 'The same ad, re-laid out as a {shape} image.'

export const resize: AiFunctionDef = {
  kind: 'picture',
  prompt: RESIZE_PROMPT,
  presets: {
    // 22–117 s an edit; US$0.027 for a 1K edit with its input picture (`docs/research/ai-flow-image-models.md`).
    seedream: { model: 'seedream-5.5', settings: {}, guess: { cost: 2_600_000n, seconds: 117 } },
  },
}
