// Refine with AI: the refine editor reads the ad, its marked copy and the person's message and writes one
// instruction (the refine plan), then the picture model edits the clean ad with that instruction alone. The marks
// are drawn over the ad here, for the refine plan only.
import type { Db, Tx } from '@dazbee/db'
import { answerSchema, type CallInput, type RefineInput, RefinePlanAnswer } from '@dazbee/schema'

import { callSize, pictureLimits } from '../call-size.ts'
import type { JobEnd } from '../jobs.ts'
import { drawMarks } from '../marks.ts'
import { REFINE_EDITOR } from '../prompts/ads/refine-editor.ts'
import { stepModel } from '../steps.ts'
import { pictureName } from './assets.ts'
import type { DeclaredCall } from './holds.ts'
import type { FlowRun } from './run.ts'

/** Each call's index in a refine. */
export const REFINE_CALL = { plan: 0, edit: 1 } as const

/** Runs a refine: the refine plan, then the edit; a failed plan fails the job. */
export async function runRefine(run: FlowRun, input: RefineInput): Promise<JobEnd | null> {
  const name = await pictureName(run.db, run.workspace, input.briefId, input.message)
  const marked = input.marksKey
    ? await run.files.save(
        await drawMarks(await run.files.read(input.pictureKey), await run.files.read(input.marksKey)),
        'image/png',
      )
    : undefined
  const answer = await run.call(REFINE_CALL.plan, 'flow.refine-plan', planCall(input, marked), name)
  const plan = answer?.kind === 'text' ? RefinePlanAnswer.safeParse(answer.json) : null
  if (!answer) return run.failed()
  if (!plan?.success) return run.failed('the refine plan could not be read')
  await run.call(REFINE_CALL.edit, 'flow.refine', await editCall(run.db, input, plan.data.instruction), name)
  return null
}

/** The calls a refine declares: its plan, reading the ad and its marked copy, and the edit. */
export async function refineCalls(db: Db | Tx, input: RefineInput): Promise<DeclaredCall[]> {
  return [
    { step: 'flow.refine-plan', input: planCall(input, input.marksKey) },
    { step: 'flow.refine', input: await editCall(db, input, '') },
  ]
}

/** The refine plan's call: the refine editor, the person's message, the ad and its marked copy when it has one. */
function planCall(input: RefineInput, marked: string | undefined): CallInput {
  const marks = marked ? "\n\nThe second attached picture is the ad with the advertiser's numbered marks." : ''
  return {
    kind: 'text',
    instructions: REFINE_EDITOR,
    prompt: `The advertiser's message:\n${input.message}${marks}`,
    pictures: [input.pictureKey, ...(marked ? [marked] : [])],
    schema: answerSchema(RefinePlanAnswer),
  }
}

/** The edit's call: the clean ad and the instruction, at the edit model's call size. */
async function editCall(db: Db | Tx, input: RefineInput, instruction: string): Promise<CallInput> {
  const { model } = await stepModel(db, 'flow.refine')
  return {
    kind: 'picture',
    prompt: instruction,
    pictures: [input.pictureKey],
    ...callSize(input.size, pictureLimits(model)),
  }
}
