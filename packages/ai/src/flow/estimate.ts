// What an AI action would take before it is asked for: the hold its job would set aside, as a share of the
// workspace's live allowance as the usage bar counts it, and about how long it takes, each AI step's time
// (`STEP_SECONDS`) summed along its job kind's longest path. Calls made side by side count once.
import type { Db, Tx } from '@dazbee/db'
import type {
  AiEstimate,
  AiEstimateQuery,
  AiMode,
  AiStep,
  FlowJobInput,
  FlowJobKind,
  LayeringInput,
  RefineInput,
  ResizeInput,
  RoundInput,
} from '@dazbee/schema'

import { grantsOf, layerSize } from '../ledger.ts'
import { holdFor, STEP_SECONDS } from '../steps.ts'
import { declaredCalls } from './holds.ts'
import { MODE_STEPS, roundCalls } from './round.ts'

/** A rate of 1, as usage rates are kept (millionths). */
const RATE_ONE = 1_000_000n

/** Each job kind's longest path through its steps, one after another. */
const LONGEST_PATH: Record<FlowJobKind, (mode: AiMode) => AiStep[]> = {
  round: (mode) => [MODE_STEPS[mode].plan, MODE_STEPS[mode].draft],
  'more-like-this': (mode) => [MODE_STEPS[mode].plan, MODE_STEPS[mode].draft],
  'try-again': (mode) => [MODE_STEPS[mode].draft],
  refine: () => ['flow.refine-plan', 'flow.refine'],
  resize: () => ['flow.resize'],
  layering: () => ['flow.layer-plan', 'flow.layer-split', 'flow.read'],
}

/** The placeholder every estimate's job names for what a real job would name: never read. */
const PLACEHOLDER = 'estimate'

/** The action's share of the workspace's live allowance and its seconds. */
export async function estimateAction(db: Db | Tx, workspace: string, query: AiEstimateQuery): Promise<AiEstimate> {
  const hold = await actionHold(db, workspace, query)
  const live = (await grantsOf(db, workspace)).filter((g) => g.live)
  const given = live.reduce((sum, g) => sum + g.amount, 0n)
  // The hold draws first from the first live grant with allowance left, at that grant's usage rate.
  const rate = (live.find((g) => g.left > 0n) ?? live[0])?.usageRate
  const seconds = LONGEST_PATH[query.action](query.mode).reduce((sum, step) => sum + STEP_SECONDS[step], 0)
  if (given <= 0n || rate === undefined) return { share: null, seconds }
  const hundredths = Number((hold * rate * 10_000n) / (RATE_ONE * given))
  return { share: hundredths < 100 ? 'under-1' : Math.round(hundredths / 100), seconds }
}

/**
 * The hold, in millionths of a rupee of real cost, of the job the action would start: its calls with the query's
 * sizes, mode and number of brief pictures, and for layering the workspace's layer size.
 */
export async function actionHold(db: Db | Tx, workspace: string, query: AiEstimateQuery): Promise<bigint> {
  const flow = await sampleJob(db, workspace, query)
  if (flow.kind === 'try-again') {
    // One draft of a round like it: the stored plan's prompt is not known before the job.
    const draft = (await roundCalls(db, sampleRound(query))).at(-1)
    return holdFor(db, draft ? [draft] : [])
  }
  return holdFor(db, await declaredCalls(db, workspace, flow))
}

/** A job of the query's action, shaped like one a tab would start. */
async function sampleJob(db: Db | Tx, workspace: string, query: AiEstimateQuery): Promise<FlowJobInput> {
  const on = { brandId: PLACEHOLDER, designId: PLACEHOLDER }
  const target = { frameId: PLACEHOLDER, pictureLayerId: PLACEHOLDER }
  const size = query.sizes[0] ?? { width: 1080, height: 1080 }
  switch (query.action) {
    case 'round':
      return { kind: 'round', input: sampleRound(query) }
    case 'more-like-this':
      return { kind: 'more-like-this', input: { ...sampleRound(query), likedKey: PLACEHOLDER } }
    case 'try-again':
      return { kind: 'try-again', input: { ...on, briefId: PLACEHOLDER, draft: 0, frame: target } }
    case 'refine': {
      const input: RefineInput = { ...on, frame: target, pictureKey: PLACEHOLDER, message: PLACEHOLDER, size }
      return { kind: 'refine', input }
    }
    case 'resize': {
      const sizes = query.sizes.map((each) => ({ ...target, ...each }))
      const input: ResizeInput = { ...on, sectionId: PLACEHOLDER, pictureKey: PLACEHOLDER, sizes }
      return { kind: 'resize', input }
    }
    case 'layering': {
      const frames = query.sizes.map(() => ({ frameId: PLACEHOLDER, pictureKey: PLACEHOLDER }))
      const input: LayeringInput = { ...on, frames, size: await layerSize(db, workspace) }
      return { kind: 'layering', input }
    }
  }
}

/** A round of the query's mode and first size, with as many brief pictures as it names. */
function sampleRound(query: AiEstimateQuery): RoundInput {
  const target = { frameId: PLACEHOLDER, pictureLayerId: PLACEHOLDER }
  return {
    brandId: PLACEHOLDER,
    designId: PLACEHOLDER,
    briefId: PLACEHOLDER,
    sectionId: PLACEHOLDER,
    frames: [target, target, target, target],
    words: PLACEHOLDER,
    pictures: Array.from({ length: query.pictures }, (_, n) => `${PLACEHOLDER}-${n}`),
    size: query.sizes[0] ?? { width: 1080, height: 1080 },
    mode: query.mode,
    brand: { name: '', colors: [], fonts: [], voice: '' },
  }
}
