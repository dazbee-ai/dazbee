// Layering: a layer plan for each frame, made from that frame's picture, then for each frame the layer split at
// the job's size with its plan's prompt, and the reading of its text blocks. The layers are stored as parts,
// which the tab that finishes Make editable crops and places.
import { type CallOutput, LAYERING_CALL, type LayeringInput, LayerPlanAnswer } from '@dazbee/schema'

import { planCall } from '../functions/layer-plan.ts'
import { splitCall } from '../functions/layer-split.ts'
import { readCall } from '../functions/reading.ts'
import { pictureName } from './assets.ts'
import type { AiFeatureDef, FeatureCall } from './types.ts'

/**
 * A layering job: each frame's layer plan, side by side, then each frame's split, at the job's size, and its
 * reading, following that frame's own plan. A job of one frame stands on its plan. A job of several stands on
 * none: a frame whose plan failed or can't be read gets no split and no reading, and the other frames go on. A
 * reading is not made when the plan found no text.
 */
export const layering: AiFeatureDef<LayeringInput> = {
  shape: (input) => ({ count: input.frames.length, reference: false, layerSize: input.size }),
  stages: (shape) => [
    Array.from({ length: shape.count }, (_, n): FeatureCall<LayeringInput, undefined> => ({
      index: LAYERING_CALL.plan(n),
      fn: 'layer-plan',
      standsOn: shape.count === 1,
      unusable: (output) => (planIn(output) ? null : 'the layer plan could not be read'),
      build({ input, prompt }) {
        const frame = input.frames[n]
        return frame ? planCall(frame.pictureKey, prompt) : null
      },
    })),
    Array.from({ length: shape.count }, (_, n): FeatureCall<LayeringInput, undefined>[] => [
      {
        index: LAYERING_CALL.split(n),
        fn: 'layer-split',
        build({ input, answers }) {
          const frame = input.frames[n]
          const plan = planOf(answers, n)
          return frame && plan ? splitCall(frame.pictureKey, input.size, plan) : null
        },
        held: ({ layerSize }) => ({ kind: 'layer-split', picture: 'held', size: layerSize ?? 1024 }),
      },
      {
        index: LAYERING_CALL.read(n),
        fn: 'reading',
        build({ input, answers, prompt }) {
          const frame = input.frames[n]
          const texts = planOf(answers, n)?.elements.filter((element) => element.kind === 'text') ?? []
          return frame && texts.length > 0 ? readCall(frame.pictureKey, texts, prompt) : null
        },
      },
    ]).flat(),
  ],
  name: (on, input) => pictureName(on.db, on.workspace, input.briefId, ''),
}

/** Frame `n`'s layer plan among `answers`, or null when its plan call gave none that can be read. */
function planOf(answers: ReadonlyMap<number, CallOutput>, n: number): LayerPlanAnswer | null {
  const output = answers.get(LAYERING_CALL.plan(n))
  return output ? planIn(output) : null
}

/** The layer plan a plan call's output holds, or null when it can't be read. */
function planIn(output: CallOutput): LayerPlanAnswer | null {
  const plan = output.kind === 'text' ? LayerPlanAnswer.safeParse(output.json) : null
  return plan?.success ? plan.data : null
}
