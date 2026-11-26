// The refine edit: the clean ad edited with the refine plan's instruction alone.
import type { AiFunctionDef } from './types.ts'

export const refineEdit: AiFunctionDef = {
  kind: 'picture',
  presets: {
    // 22–117 s an edit; US$0.027 for a 1K edit with its input picture (`docs/research/ai-flow-image-models.md`).
    seedream: { model: 'seedream-5.5', settings: {}, guess: { cost: 2_600_000n, seconds: 117 } },
  },
}
