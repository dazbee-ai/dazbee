// The layer split: a draft's picture split into picture layers on our own GPU, at a fixed amount.
import type { CallInput, LayerPlanAnswer, LayerSplitSize } from '@dazbee/schema'

import type { AiFunctionDef } from './types.ts'

export const layerSplit: AiFunctionDef = {
  kind: 'layer-split',
  presets: {
    // A lone split at 1024 px on a container started from its snapshot, as most are with none kept warm: 45 s to
    // its result and 46 s of the container billed (`docs/research/ai-flow-image-models.md`, the layer split on Modal).
    ming: { model: 'ming-image-0.1-design-layer', settings: {}, guess: { cost: 5_450_000n, seconds: 46 } },
  },
  fixedCharge: (settings, input) =>
    input.kind === 'layer-split' && input.size === 512 ? settings.layerSplit512 : settings.layerSplit1024,
}

/** The layer split of `picture` at `size`, following its plan's prompt when the plan gave one. */
export function splitCall(picture: string, size: LayerSplitSize, plan: LayerPlanAnswer): CallInput {
  const prompt = plan.prompt.trim().slice(0, 10_000)
  return { kind: 'layer-split', picture, size, ...(prompt ? { plan: prompt } : {}) }
}
