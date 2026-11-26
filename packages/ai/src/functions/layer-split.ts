// The layer split: a draft's picture split into picture layers on our own GPU, at a fixed amount.
import type { CallInput, LayerPlanAnswer, LayerSplitSize } from '@dazbee/schema'

import type { AiFunctionDef } from './types.ts'

export const layerSplit: AiFunctionDef = {
  kind: 'layer-split',
  presets: {
    // 17.5 s on a warm Modal H100, a cold start 50–55 s; a warm split's GPU, CPU and memory at 1024 px.
    ming: { model: 'ming-image-0.1-design-layer', settings: {}, guess: { cost: 2_310_000n, seconds: 18 } },
  },
  fixedCharge: (settings, input) =>
    input.kind === 'layer-split' && input.size === 512 ? settings.layerSplit512 : settings.layerSplit1024,
}

/** The layer split of `picture` at `size`, following the plan's prompt when it gave one. */
export function splitCall(picture: string, size: LayerSplitSize, plan: LayerPlanAnswer | null): CallInput {
  const prompt = plan?.prompt.trim().slice(0, 10_000)
  return { kind: 'layer-split', picture, size, ...(prompt ? { plan: prompt } : {}) }
}
