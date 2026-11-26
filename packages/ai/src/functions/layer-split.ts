// The layer split: a draft's picture split into picture layers on our own GPU, at a fixed amount.
import type { CallInput, LayerPlanAnswer, LayerSplitSize } from '@dazbee/schema'

import type { AiFunctionDef } from './types.ts'

export const layerSplit: AiFunctionDef = {
  kind: 'layer-split',
  presets: {
    // One paid split at 1024 px from a cold start, as most are with no container kept warm: 98.3 s, 25.8 of
    // them on the GPU; 17.5 s warm (`docs/research/ai-flow-image-models.md`, the runs of 26 Nov 2026).
    ming: { model: 'ming-image-0.1-design-layer', settings: {}, guess: { cost: 3_040_000n, seconds: 99 } },
  },
  fixedCharge: (settings, input) =>
    input.kind === 'layer-split' && input.size === 512 ? settings.layerSplit512 : settings.layerSplit1024,
}

/** The layer split of `picture` at `size`, following the plan's prompt when it gave one. */
export function splitCall(picture: string, size: LayerSplitSize, plan: LayerPlanAnswer | null): CallInput {
  const prompt = plan?.prompt.trim().slice(0, 10_000)
  return { kind: 'layer-split', picture, size, ...(prompt ? { plan: prompt } : {}) }
}
