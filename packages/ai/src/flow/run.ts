// Runs one attempt of a flow job: its job kind's script makes its calls through `callAi`, each with the preset the
// job saved for its AI function, each picture recorded as an asset of the job's brand. A call that fails for good
// is never charged and doesn't stop the others. The job is done once every call has ended, and failed when none
// delivered or when the plan the rest stand on failed.
import type { Db } from '@dazbee/db'
import type { AiFunction, CallInput, CallOutput, FlowJobInput } from '@dazbee/schema'

import { callAi, CallFailed, type PictureFiles } from '../call.ts'
import { presetOf, promptOf } from '../functions/ai-function.ts'
import type { Preset } from '../functions/types.ts'
import type { JobEnd } from '../jobs.ts'
import { pictureAssets } from './assets.ts'
import { runLayering } from './layering.ts'
import { runRefine } from './refine.ts'
import { runResize } from './resize.ts'
import { runMoreLikeThis, runRound, runTryAgain } from './round.ts'

/** How many calls of one flow job the worker makes at once. */
export const FLOW_CALLS_AT_ONCE = 4

/** What a flow job runs on. */
export interface FlowDeps {
  db: Db
  /** The workspace's originals, which calls read pictures from and store pictures in. */
  files: PictureFiles
  /** Runs one call under the worker's limits of calls at once; at once when not given. */
  limit?: <T>(task: () => Promise<T>) => Promise<T>
  /** The sellers to try for every call in place of each model's own: tests only. */
  sellers?: string[]
}

/** One attempt of a flow job. */
export interface FlowAttempt {
  job: string
  workspace: string
  attempt: number
  flow: FlowJobInput
  /** The name of the preset each AI function runs with, as the job saved them. */
  presets: Record<string, string>
  /** Aborted when the worker stops or pg-boss takes the job back. */
  signal: AbortSignal
}

/** One attempt as a job kind's script runs it. */
export interface FlowRun {
  db: Db
  files: PictureFiles
  workspace: string
  /** The preset the job runs `fn` with. */
  preset(fn: AiFunction): Preset
  /** The prompt that preset runs with: its own, or else its AI function's; empty for a function with no words. */
  prompt(fn: AiFunction): string
  /**
   * Makes call `index` of the job, of `fn`, its pictures named `name`; its output, or null when it failed for good.
   * Throws when the attempt is aborted, and on any other error, which sends the job to be tried again.
   */
  call(index: number, fn: AiFunction, input: CallInput, name: string): Promise<CallOutput | null>
  /** Runs every task to its end, then throws the first error any of them threw; their results. */
  all<T>(tasks: Promise<T>[]): Promise<T[]>
  /** The job's end when the call the rest stand on failed, or delivered nothing they can use: failed, for `why`. */
  failed(why?: string): JobEnd
}

/** A job kind's script: runs the job's calls, and gives its end when it decides it, otherwise null. */
type Script<K extends FlowJobInput['kind']> = (
  run: FlowRun,
  input: Extract<FlowJobInput, { kind: K }>['input'],
) => Promise<JobEnd | null>

/** Each job kind's script. */
const SCRIPTS: { [K in FlowJobInput['kind']]: Script<K> } = {
  round: runRound,
  'more-like-this': runMoreLikeThis,
  'try-again': runTryAgain,
  refine: runRefine,
  resize: runResize,
  layering: runLayering,
}

/**
 * Runs the attempt's script to its end; how the job ends. A job that saved a preset the code no longer has fails
 * before any call is made. Throws the signal's reason once it is aborted.
 */
export async function runFlowJob(deps: FlowDeps, attempt: FlowAttempt): Promise<JobEnd> {
  const { db, files, sellers } = deps
  const { signal, flow } = attempt
  const gone = Object.entries(attempt.presets).find(([fn, name]) => !presetOf(fn, name))
  if (gone) return { state: 'failed', error: `the AI function ${gone[0]} has no preset ${gone[1]}` }
  const limit = deps.limit ?? ((task) => task())
  let delivered = 0
  let failure: string | null = null
  const presetName = (fn: AiFunction) => {
    const name = attempt.presets[fn]
    if (name === undefined) throw new Error(`the job saved no preset for the AI function ${fn}`)
    return name
  }
  const run: FlowRun = {
    db,
    files,
    workspace: attempt.workspace,
    preset(fn) {
      const preset = presetOf(fn, presetName(fn))
      if (!preset) throw new Error(`the AI function ${fn} has no preset ${presetName(fn)}`)
      return preset
    },
    prompt: (fn) => promptOf(fn, run.preset(fn)) ?? '',
    async call(index, fn, input, name) {
      const assets = pictureAssets({ workspace: attempt.workspace, brand: flow.input.brandId, name })
      try {
        const output = await limit(() => {
          // A call that waited for its place starts only if the attempt still goes on.
          signal.throwIfAborted()
          return callAi(db, {
            job: { id: attempt.job, workspaceId: attempt.workspace },
            attempt: attempt.attempt,
            callIndex: index,
            feature: flow.kind,
            function: fn,
            preset: presetName(fn),
            input,
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
    },
    all: settled,
    failed: (why) => ({ state: 'failed', error: why ?? failure ?? 'no call was made' }),
  }
  const script = SCRIPTS[flow.kind] as Script<FlowJobInput['kind']>
  const end = await script(run, flow.input)
  signal.throwIfAborted()
  if (end) return end
  return delivered > 0 ? { state: 'done', output: null } : run.failed()
}

/** Runs every task to its end, then throws the first error any of them threw; their results. */
async function settled<T>(tasks: Promise<T>[]): Promise<T[]> {
  const results = await Promise.allSettled(tasks)
  const rejected = results.find((result) => result.status === 'rejected')
  if (rejected) throw rejected.reason
  return results.map((result) => (result as PromiseFulfilledResult<T>).value)
}
