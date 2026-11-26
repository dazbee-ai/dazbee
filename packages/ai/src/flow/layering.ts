// Layering: one layer plan, made from the draft the sizes came from, then for each frame's picture the layer split
// at the job's size with the plan's prompt, and the reading of its text blocks. The layers are stored as parts,
// which the tab that finishes Make editable crops and places.
import {
  answerSchema,
  type CallInput,
  type LayeringInput,
  LayerPlanAnswer,
  type LayerSplitSize,
  ReadingAnswer,
} from '@dazbee/schema'

import type { JobEnd } from '../jobs.ts'
import { PLANNER_PROMPT } from '../prompts/ads/layer-planner.ts'
import { READING_PROMPT } from '../prompts/ads/reading.ts'
import { pictureName } from './assets.ts'
import type { DeclaredCall } from './holds.ts'
import type { FlowRun } from './run.ts'

/** Each call's index in a layering job: the plan, then frame `n`'s split and reading. */
export const LAYERING_CALL = { plan: 0, split: (n: number) => 1 + 2 * n, read: (n: number) => 2 + 2 * n } as const

/** Runs a layering job: the plan, then each frame's split and reading; a failed plan fails the job. */
export async function runLayering(run: FlowRun, input: LayeringInput): Promise<JobEnd | null> {
  const name = await pictureName(run.db, run.workspace, input.briefId, '')
  const answer = await run.call(LAYERING_CALL.plan, 'flow.layer-plan', planCall(planPicture(input)), name)
  const plan = answer?.kind === 'text' ? LayerPlanAnswer.safeParse(answer.json) : null
  if (!answer) return run.failed()
  if (!plan?.success) return run.failed('the layer plan could not be read')
  const texts = plan.data.elements.filter((element) => element.kind === 'text')
  await run.all(
    input.frames.flatMap((frame, n) => [
      run.call(LAYERING_CALL.split(n), 'flow.layer-split', splitCall(frame.pictureKey, input.size, plan.data), name),
      ...(texts.length > 0
        ? [run.call(LAYERING_CALL.read(n), 'flow.read', readCall(frame.pictureKey, texts), name)]
        : []),
    ]),
  )
  return null
}

/** The calls a layering job declares: its plan, and each frame's split and reading. */
export function layeringCalls(input: LayeringInput): DeclaredCall[] {
  return [
    { step: 'flow.layer-plan', input: planCall(planPicture(input)) },
    ...input.frames.flatMap((frame): DeclaredCall[] => [
      { step: 'flow.layer-split', input: splitCall(frame.pictureKey, input.size, null) },
      { step: 'flow.read', input: readCall(frame.pictureKey, []) },
    ]),
  ]
}

/** The picture the plan is made from: the draft the sizes came from, or the first frame's. */
function planPicture(input: LayeringInput): string {
  return input.planKey ?? input.frames[0]?.pictureKey ?? ''
}

/** The layer planner's call on the plan's picture. */
function planCall(picture: string): CallInput {
  return {
    kind: 'text',
    instructions: PLANNER_PROMPT,
    prompt: 'The attached picture is the ad.',
    pictures: [picture],
    schema: answerSchema(LayerPlanAnswer),
  }
}

/** The layer split of `picture` at `size`, following the plan's prompt when it gave one. */
function splitCall(picture: string, size: LayerSplitSize, plan: LayerPlanAnswer | null): CallInput {
  const prompt = plan?.prompt.trim().slice(0, 10_000)
  return { kind: 'layer-split', picture, size, ...(prompt ? { plan: prompt } : {}) }
}

/**
 * The reading of `picture`'s text blocks: the whole ad, with each block's id, its place on the planner's 0 to 999
 * grid and the text the plan found for it, as the first reading.
 */
function readCall(picture: string, texts: LayerPlanAnswer['elements']): CallInput {
  const blocks = texts.map(
    ({ id, box, text_lines: lines, content }) =>
      `${id} (x ${box.x_min}–${box.x_max}, y ${box.y_min}–${box.y_max} of 999): ${JSON.stringify(lines.length > 0 ? lines.join('\n') : content)}`,
  )
  return {
    kind: 'text',
    instructions: READING_PROMPT,
    prompt: `The attached picture is the whole ad. Its text blocks, by id, with where each lies and its first reading:\n${blocks.join('\n')}`,
    pictures: [picture],
    schema: answerSchema(ReadingAnswer),
  }
}
