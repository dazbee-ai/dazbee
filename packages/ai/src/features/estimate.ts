// What an AI action would take before it is asked for: the hold its job would set aside, as a share of the
// workspace's live allowance as the usage bar counts it, and about how long it takes. Both come from the feature's
// declaration, for the shape the screen knows: its stages one after another, a stage as long as its slowest preset,
// `FLOW_CALLS_AT_ONCE` calls at a time.
import type { Db, Tx } from '@dazbee/db'
import type { AiEstimate, AiEstimateQuery, AiFeature } from '@dazbee/schema'

import { presetOf } from '../functions/ai-function.ts'
import { allowanceOf, drawsFirst, grantsOf, layerSize } from '../ledger.ts'
import { presetNumbers } from '../measured.ts'
import { presetsFor } from '../picks.ts'
import { FEATURES } from './features.ts'
import { featureCalls, holdOf } from './holds.ts'
import { FLOW_CALLS_AT_ONCE } from './runner.ts'
import type { Shape } from './types.ts'

/** The action's share of the workspace's live allowance and its seconds. */
export async function estimateAction(db: Db | Tx, workspace: string, query: AiEstimateQuery): Promise<AiEstimate> {
  const presets = await presetsFor(db, query.mode)
  const shape = await shapeOf(db, workspace, query)
  const hold = await holdOf(db, featureCalls(query.action, shape, presets))
  const live = (await grantsOf(db, workspace)).filter((g) => g.live)
  const given = live.reduce((sum, g) => sum + g.amount, 0n)
  // The hold is counted at the usage rate of the grant it draws from first.
  const rate = (drawsFirst(live) ?? live[0])?.usageRate
  const seconds = await featureSeconds(db, query.action, shape, presets)
  if (given <= 0n || rate === undefined) return { share: null, seconds }
  const hundredths = Number((allowanceOf(hold, rate) * 10_000n) / given)
  return { share: hundredths < 100 ? 'under-1' : Math.round(hundredths / 100), seconds }
}

/**
 * The hold, in millionths of a rupee of real cost, of the job the action would start: its feature's calls for the
 * query's shape, with the query's mode's presets.
 */
export async function actionHold(db: Db | Tx, workspace: string, query: AiEstimateQuery): Promise<bigint> {
  const presets = await presetsFor(db, query.mode)
  return holdOf(db, featureCalls(query.action, await shapeOf(db, workspace, query), presets))
}

/**
 * About how long a job of `feature` and `shape` takes with `presets`: its stages one after another, each as long as
 * its slowest preset for every `FLOW_CALLS_AT_ONCE` calls it makes.
 */
export async function featureSeconds(
  db: Db | Tx,
  feature: AiFeature,
  shape: Shape,
  presets: Record<string, string>,
): Promise<number> {
  let seconds = 0
  for (const stage of FEATURES[feature].stages(shape)) {
    let slowest = 0
    for (const fn of new Set(stage.map((call) => call.fn))) {
      const name = presets[fn] ?? ''
      const preset = presetOf(fn, name)
      if (!preset) throw new Error(`the AI function ${fn} has no preset ${name}`)
      slowest = Math.max(slowest, (await presetNumbers(db, fn, name, preset)).seconds)
    }
    seconds += Math.ceil(stage.length / FLOW_CALLS_AT_ONCE) * slowest
  }
  return seconds
}

/**
 * The shape of the job the query's action would start: its sizes or frames, whether it has a reference ad, and the
 * size the workspace's layer splits run at.
 */
async function shapeOf(db: Db | Tx, workspace: string, query: AiEstimateQuery): Promise<Shape> {
  return { count: query.sizes.length, reference: query.reference, layerSize: await layerSize(db, workspace) }
}
