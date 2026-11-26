// Layering: one layer plan, made from the draft the sizes came from, then for each frame's picture the layer split
// at the job's size with the plan's prompt, and the reading of its text blocks. The layers are stored as parts,
// which the tab that finishes Make editable crops and places.
import { type CallOutput, type LayeringInput, LayerPlanAnswer } from '@dazbee/schema'

import { planCall } from '../functions/layer-plan.ts'
import { splitCall } from '../functions/layer-split.ts'
import { readCall } from '../functions/reading.ts'
import { pictureName } from './assets.ts'
import type { AiFeatureDef, FeatureCall } from './types.ts'

/** Each call's index in a layering job: the plan, then frame `n`'s split and reading. */
export const LAYERING_CALL = { plan: 0, split: (n: number) => 1 + 2 * n, read: (n: number) => 2 + 2 * n } as const

/**
 * A layering job: the layer plan, which the job stands on, then each frame's split, at the job's size, and its
 * reading, side by side. A reading is not made when the plan found no text.
 */
export const layering: AiFeatureDef<LayeringInput> = {
  shape: (input) => ({ count: input.frames.length, reference: false, layerSize: input.size }),
  stages: (shape) => [
    [
      {
        index: LAYERING_CALL.plan,
        fn: 'layer-plan',
        standsOn: true,
        unusable: (output) => (planIn(output) ? null : 'the layer plan could not be read'),
        build: ({ input, prompt }) => planCall(planPicture(input), prompt),
      },
    ],
    Array.from({ length: shape.count }, (_, n): FeatureCall<LayeringInput, undefined>[] => [
      {
        index: LAYERING_CALL.split(n),
        fn: 'layer-split',
        build({ input, answers }) {
          const frame = input.frames[n]
          return frame ? splitCall(frame.pictureKey, input.size, planOf(answers)) : null
        },
        held: ({ layerSize }) => ({ kind: 'layer-split', picture: 'held', size: layerSize ?? 1024 }),
      },
      {
        index: LAYERING_CALL.read(n),
        fn: 'reading',
        build({ input, answers, prompt }) {
          const frame = input.frames[n]
          const texts = planOf(answers)?.elements.filter((element) => element.kind === 'text') ?? []
          return frame && texts.length > 0 ? readCall(frame.pictureKey, texts, prompt) : null
        },
      },
    ]).flat(),
  ],
  name: (on, input) => pictureName(on.db, on.workspace, input.briefId, ''),
}

/** The picture the plan is made from: the draft the sizes came from, or the first frame's. */
function planPicture(input: LayeringInput): string {
  return input.planKey ?? input.frames[0]?.pictureKey ?? ''
}

/** The layer plan among `answers`, or null when the plan call gave none that can be read. */
function planOf(answers: ReadonlyMap<number, CallOutput>): LayerPlanAnswer | null {
  const output = answers.get(LAYERING_CALL.plan)
  return output ? planIn(output) : null
}

/** The layer plan a plan call's output holds, or null when it can't be read. */
function planIn(output: CallOutput): LayerPlanAnswer | null {
  const plan = output.kind === 'text' ? LayerPlanAnswer.safeParse(output.json) : null
  return plan?.success ? plan.data : null
}
