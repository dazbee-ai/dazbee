// Refine with AI: the refine plan reads the ad, its marked copy and the person's message and writes one
// instruction, then the refine edit edits the clean ad with that instruction alone. The marks are drawn over the ad
// here, for the refine plan only.
import { answerSchema, type CallInput, type RefineInput, RefinePlanAnswer } from '@dazbee/schema'

import { callSize, pictureLimits } from '../call-size.ts'
import type { JobEnd } from '../jobs.ts'
import { drawMarks } from '../marks.ts'
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
  const answer = await run.call(
    REFINE_CALL.plan,
    'refine-plan',
    planCall(input, marked, run.prompt('refine-plan')),
    name,
  )
  const plan = answer?.kind === 'text' ? RefinePlanAnswer.safeParse(answer.json) : null
  if (!answer) return run.failed()
  if (!plan?.success) return run.failed('the refine plan could not be read')
  const edit = editCall(input, plan.data.instruction, run.preset('refine-edit').model)
  await run.call(REFINE_CALL.edit, 'refine-edit', edit, name)
  return null
}

/** The calls a refine declares: its plan and its edit. */
export function refineCalls(): DeclaredCall[] {
  return [{ fn: 'refine-plan' }, { fn: 'refine-edit' }]
}

/** The refine plan's call: its prompt, the person's message, the ad and its marked copy when it has one. */
function planCall(input: RefineInput, marked: string | undefined, editor: string): CallInput {
  const marks = marked ? "\n\nThe second attached picture is the ad with the advertiser's numbered marks." : ''
  return {
    kind: 'text',
    instructions: editor,
    prompt: `The advertiser's message:\n${input.message}${marks}`,
    pictures: [input.pictureKey, ...(marked ? [marked] : [])],
    schema: answerSchema(RefinePlanAnswer),
  }
}

/** The edit's call: the clean ad and the instruction, at the edit model's call size. */
function editCall(input: RefineInput, instruction: string, model: string): CallInput {
  return {
    kind: 'picture',
    prompt: instruction,
    pictures: [input.pictureKey],
    ...callSize(input.size, pictureLimits(model)),
  }
}
