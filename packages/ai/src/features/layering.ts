// Layering: one layer plan, made from the draft the sizes came from, then for each frame's picture the layer split
// at the job's size with the plan's prompt, and the reading of its text blocks. The layers are stored as parts,
// which the tab that finishes Make editable crops and places.
import { type LayeringInput, LayerPlanAnswer } from '@dazbee/schema'

import { planCall } from '../functions/layer-plan.ts'
import { splitCall } from '../functions/layer-split.ts'
import { readCall } from '../functions/reading.ts'
import type { JobEnd } from '../jobs.ts'
import { pictureName } from './assets.ts'
import type { DeclaredCall } from './holds.ts'
import type { FlowRun } from './runner.ts'

/** Each call's index in a layering job: the plan, then frame `n`'s split and reading. */
export const LAYERING_CALL = { plan: 0, split: (n: number) => 1 + 2 * n, read: (n: number) => 2 + 2 * n } as const

/** Runs a layering job: the plan, then each frame's split and reading; a failed plan fails the job. */
export async function runLayering(run: FlowRun, input: LayeringInput): Promise<JobEnd | null> {
  const name = await pictureName(run.db, run.workspace, input.briefId, '')
  const planner = planCall(planPicture(input), run.prompt('layer-plan'))
  const answer = await run.call(LAYERING_CALL.plan, 'layer-plan', planner, name)
  const plan = answer?.kind === 'text' ? LayerPlanAnswer.safeParse(answer.json) : null
  if (!answer) return run.failed()
  if (!plan?.success) return run.failed('the layer plan could not be read')
  const texts = plan.data.elements.filter((element) => element.kind === 'text')
  const reader = run.prompt('reading')
  await run.all(
    input.frames.flatMap((frame, n) => [
      run.call(LAYERING_CALL.split(n), 'layer-split', splitCall(frame.pictureKey, input.size, plan.data), name),
      ...(texts.length > 0
        ? [run.call(LAYERING_CALL.read(n), 'reading', readCall(frame.pictureKey, texts, reader), name)]
        : []),
    ]),
  )
  return null
}

/** The calls a layering job declares: its plan, and each frame's split, at its size, and reading. */
export function layeringCalls(input: LayeringInput): DeclaredCall[] {
  return [
    { fn: 'layer-plan' },
    ...input.frames.flatMap((frame): DeclaredCall[] => [
      { fn: 'layer-split', input: splitCall(frame.pictureKey, input.size, null) },
      { fn: 'reading' },
    ]),
  ]
}

/** The picture the plan is made from: the draft the sizes came from, or the first frame's. */
function planPicture(input: LayeringInput): string {
  return input.planKey ?? input.frames[0]?.pictureKey ?? ''
}

