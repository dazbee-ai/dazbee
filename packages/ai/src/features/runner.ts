// Runs one attempt of an AI feature's job from its declaration: stage by stage, a stage's calls side by side, each
// through `callAi` with the preset the job saved for its AI function, each picture recorded as an asset of the job's
// brand. A call that fails for good is never charged and doesn't stop the others. The job is done once every call
// has ended, and failed when none delivered or when a call it stands on failed or gave an answer that can't be used.
import type { Db } from '@dazbee/db'
import type { AiFeatureInput, AiFunction, CallInput, CallOutput } from '@dazbee/schema'

import { callAi, CallFailed, type PictureFiles } from '../call.ts'
import { presetOf, promptOf } from '../functions/ai-function.ts'
import type { JobEnd } from '../jobs.ts'
import { pictureAssets } from './assets.ts'
import { FEATURES } from './features.ts'
import type { FeatureCall, FeatureRun } from './types.ts'

/** How many calls of one job the worker makes at once. */
export const FLOW_CALLS_AT_ONCE = 4

/** What a feature's job runs on. */
export interface FlowDeps {
  db: Db
  /** The workspace's originals, which calls read pictures from and store pictures in. */
  files: PictureFiles
  /** Runs one call under the worker's limits of calls at once; at once when not given. */
  limit?: <T>(task: () => Promise<T>) => Promise<T>
  /** The sellers to try for every call in place of each model's own: tests only. */
  sellers?: string[]
}

/** One attempt of a feature's job. */
export interface FlowAttempt {
  job: string
  workspace: string
  attempt: number
  flow: AiFeatureInput
  /** The name of the preset each AI function runs with, as the job saved them. */
  presets: Record<string, string>
  /** Aborted when the worker stops or pg-boss takes the job back. */
  signal: AbortSignal
}

/**
 * Runs the attempt's feature to its end; how the job ends. A job that saved an AI function or a preset the code
 * doesn't have fails before any call is made. Throws the signal's reason once it is aborted, and any error that is
 * not a call failing for good, which sends the job to be tried again.
 */
export async function runFlowJob(deps: FlowDeps, attempt: FlowAttempt): Promise<JobEnd> {
  const { db, files, sellers } = deps
  const { signal, flow } = attempt
  const gone = Object.entries(attempt.presets).find(([fn, name]) => !presetOf(fn, name))
  if (gone) return { state: 'failed', error: `the AI function ${gone[0]} has no preset ${gone[1]}` }
  const feature = FEATURES[flow.kind]
  const on: FeatureRun = { db, files, workspace: attempt.workspace }
  const input: unknown = flow.input
  const start = feature.load ? await feature.load(on, input) : { loaded: undefined }
  if ('end' in start) return start.end
  const name = await feature.name(on, input, start.loaded)
  const limit = deps.limit ?? ((task) => task())
  const answers = new Map<number, CallOutput>()
  let delivered = 0
  let failure: string | null = null
  const failed = (why?: string): JobEnd => ({ state: 'failed', error: why ?? failure ?? 'no call was made' })

  /** The preset the job saved for `fn`. */
  const presetFor = (fn: AiFunction) => {
    const named = attempt.presets[fn]
    const preset = named === undefined ? null : presetOf(fn, named)
    if (named === undefined || !preset) throw new Error(`the job saved no preset for the AI function ${fn}`)
    return { named, preset }
  }

  /** Makes `call` with `built`; its output, or null when it failed for good. */
  async function make(
    call: FeatureCall<unknown, unknown>,
    named: string,
    built: CallInput,
  ): Promise<CallOutput | null> {
    const assets = pictureAssets({ workspace: attempt.workspace, brand: flow.input.brandId, name })
    try {
      const output = await limit(() => {
        // A call that waited for its place starts only if the attempt still goes on.
        signal.throwIfAborted()
        return callAi(db, {
          job: { id: attempt.job, workspaceId: attempt.workspace },
          attempt: attempt.attempt,
          callIndex: call.index,
          feature: flow.kind,
          function: call.fn,
          preset: named,
          input: built,
          signal,
          files,
          assets,
          ...(sellers ? { sellers } : {}),
        })
      })
      delivered++
      return output
    } catch (error) {
      if (!(error instanceof CallFailed) || signal.aborted) throw error
      failure ??= error.message
      return null
    }
  }

  for (const stage of feature.stages(feature.shape(input))) {
    const made = await settled(
      stage.map(async (call) => {
        const { named, preset } = presetFor(call.fn)
        const built = call.build({
          input,
          loaded: start.loaded,
          answers,
          prompt: promptOf(call.fn, preset) ?? '',
          model: preset.model,
        })
        if (!built) return null
        const output = await make(call, named, built)
        if (output) {
          answers.set(call.index, output)
          await feature.kept?.(on, input, call.index, output)
        }
        return { call, output }
      }),
    )
    for (const each of made) {
      if (!each?.call.standsOn) continue
      if (!each.output) return failed()
      const why = each.call.unusable?.(each.output)
      if (why) return failed(why)
    }
  }
  signal.throwIfAborted()
  return delivered > 0 ? { state: 'done', output: null } : failed()
}

/** Runs every task to its end, then throws the first error any of them threw; their results. */
async function settled<T>(tasks: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(tasks)
  const rejected = results.find((result) => result.status === 'rejected')
  if (rejected) throw rejected.reason
  return results.map((result) => (result as PromiseFulfilledResult<T>).value)
}
