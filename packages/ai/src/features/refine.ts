// Refine with AI: the refine plan reads the ad, its marked copy and the person's message and writes one
// instruction, then the refine edit edits the clean ad with that instruction alone. The marks are drawn over the ad
// here, for the refine plan only.
import { REFINE_CALL, type RefineInput, RefinePlanAnswer } from '@dazbee/schema'

import { editCall } from '../functions/refine-edit.ts'
import { planCall } from '../functions/refine-plan.ts'
import { drawMarks } from '../marks.ts'
import { pictureName } from './assets.ts'
import type { AiFeatureDef } from './types.ts'

/** A refine: the refine plan, which the job stands on, then the edit. */
export const refine: AiFeatureDef<RefineInput, { marked: string | undefined }> = {
  shape: () => ({ count: 1, reference: false }),
  stages: () => [
    [
      {
        index: REFINE_CALL.plan,
        fn: 'refine-plan',
        standsOn: true,
        unusable: (output) =>
          output.kind === 'text' && RefinePlanAnswer.safeParse(output.json).success
            ? null
            : 'the refine plan could not be read',
        build: ({ input, loaded, prompt }) => planCall(input, loaded.marked, prompt),
      },
    ],
    [
      {
        index: REFINE_CALL.edit,
        fn: 'refine-edit',
        build({ input, answers, model }) {
          const plan = answers.get(REFINE_CALL.plan)
          const read = plan?.kind === 'text' ? RefinePlanAnswer.safeParse(plan.json) : null
          return read?.success ? editCall(input, read.data.instruction, model) : null
        },
      },
    ],
  ],
  async load(on, input) {
    if (!input.marksKey) return { loaded: { marked: undefined } }
    const marked = await drawMarks(await on.files.read(input.pictureKey), await on.files.read(input.marksKey))
    return { loaded: { marked: await on.files.save(marked, 'image/png') } }
  },
  name: (on, input) => pictureName(on.db, on.workspace, input.briefId, input.message),
}
