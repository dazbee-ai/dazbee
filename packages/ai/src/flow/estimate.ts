// What an AI action would take before it is asked for: the hold its job would set aside, as a share of the
// workspace's live allowance as the usage bar counts it, and about how long it takes, each AI step's time
// (`STEP_SECONDS`) summed along its job kind's longest path. Calls made side by side take as long as the slowest,
// `FLOW_CALLS_AT_ONCE` at a time.
import type { Db, Tx } from '@dazbee/db'
import type {
  AiEstimate,
  AiEstimateQuery,
  FlowJobInput,
  LayeringInput,
  RefineInput,
  ResizeInput,
  RoundInput,
} from '@dazbee/schema'

import { allowanceOf, drawsFirst, grantsOf, layerSize } from '../ledger.ts'
import { holdFor, STEP_SECONDS } from '../steps.ts'
import { declaredCalls } from './holds.ts'
import { MODE_STEPS, roundCalls } from './round.ts'
import { FLOW_CALLS_AT_ONCE } from './run.ts'

/** The placeholder every estimate's job names for what a real job would name: never read. */
const PLACEHOLDER = 'estimate'

/** The action's share of the workspace's live allowance and its seconds. */
export async function estimateAction(db: Db | Tx, workspace: string, query: AiEstimateQuery): Promise<AiEstimate> {
  const hold = await actionHold(db, workspace, query)
  const live = (await grantsOf(db, workspace)).filter((g) => g.live)
  const given = live.reduce((sum, g) => sum + g.amount, 0n)
  // The hold is counted at the usage rate of the grant it draws from first.
  const rate = (drawsFirst(live) ?? live[0])?.usageRate
  const seconds = actionSeconds(query)
  if (given <= 0n || rate === undefined) return { share: null, seconds }
  const hundredths = Number((allowanceOf(hold, rate) * 10_000n) / given)
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

/**
 * About how long the action takes: its job kind's steps one after another, where the calls of a step made side by
 * side go `FLOW_CALLS_AT_ONCE` at a time, each turn as long as its slowest call.
 */
function actionSeconds(query: AiEstimateQuery): number {
  const turns = (calls: number) => Math.ceil(calls / FLOW_CALLS_AT_ONCE)
  const { plan, draft } = MODE_STEPS[query.mode]
  const sizes = query.sizes.length
  switch (query.action) {
    case 'round':
    case 'more-like-this':
      return STEP_SECONDS[plan] + turns(4) * STEP_SECONDS[draft]
    case 'try-again':
      return STEP_SECONDS[draft]
    case 'refine':
      return STEP_SECONDS['flow.refine-plan'] + STEP_SECONDS['flow.refine']
    case 'resize':
      return turns(sizes) * STEP_SECONDS['flow.resize']
    case 'layering':
      // Each size's split and reading go side by side.
      return (
        STEP_SECONDS['flow.layer-plan'] +
        turns(2 * sizes) * Math.max(STEP_SECONDS['flow.layer-split'], STEP_SECONDS['flow.read'])
      )
  }
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
