// Runs `calls` jobs (ADR-0022): each attempt makes the job's AI calls through `callAi`, up to 4 at once per
// job and at most the worker-wide limit across jobs.
import { createHash } from 'node:crypto'

import { callAi, type JobEnd, type PictureFiles } from '@dazbee/ai'
import type { CallOutput, CallsInput } from '@dazbee/schema'
import { originalKey, type Storage } from '@dazbee/storage'

import { type JobAttempt, type JobWorker, type JobWorkerDeps, type Limiter, startJobWorker } from './job-worker.ts'

/** One attempt of a job, as `runAttempt` makes it. */
export interface Attempt {
  job: string
  workspace: string
  attempt: number
  input: CallsInput
  /** Aborted when the job is cancelled or the worker stops. */
  signal: AbortSignal
  /** Reads the job's state between calls, aborting `signal` on a cancel. */
  checkCancel?: () => Promise<void>
}

/** The most calls of one job running at once. */
export const CALLS_PER_JOB = 4

/** Starts running the queue's `calls` jobs. */
export async function startCallsWorker(deps: JobWorkerDeps): Promise<JobWorker> {
  return startJobWorker(deps, (attempt, calls) => runCalls(deps, attempt, calls))
}

/**
 * Makes one attempt's AI calls, up to 4 at once, each under the worker-wide limit; their outputs, by call
 * index. The job's state is read before each call. A call that fails for good stops new calls, waits for
 * those running, then fails the attempt.
 */
export async function runAttempt(
  deps: Pick<JobWorkerDeps, 'db' | 'storage'>,
  calls: Limiter,
  made: Attempt,
): Promise<CallOutput[]> {
  const files = workspaceFiles(deps.storage, made.workspace)
  const outputs: CallOutput[] = []
  let next = 0
  let failure: unknown = null
  async function lane(): Promise<void> {
    while (failure === null && next < made.input.calls.length) {
      const callIndex = next++
      const call = made.input.calls[callIndex]
      if (!call) return
      try {
        await made.checkCancel?.()
        made.signal.throwIfAborted()
        outputs[callIndex] = await calls.run(() => {
          // A call that waited for its place starts only if the attempt still goes on.
          made.signal.throwIfAborted()
          return callAi(deps.db, {
            job: { id: made.job, workspaceId: made.workspace },
            attempt: made.attempt,
            callIndex,
            feature: 'calls',
            function: call.function,
            preset: call.preset,
            input: call.input,
            signal: made.signal,
            files,
            ...(call.sellers ? { sellers: call.sellers } : {}),
          })
        })
      } catch (error) {
        failure ??= error
      }
    }
  }
  const lanes = Math.min(CALLS_PER_JOB, made.input.calls.length)
  await Promise.all(Array.from({ length: lanes }, lane))
  if (failure !== null) throw failure
  made.signal.throwIfAborted()
  return outputs
}

/**
 * The workspace's originals as AI calls read and make them: a picture is read only from the workspace's own
 * keys, and a made picture is stored once by its SHA-256, as uploads are.
 */
export function workspaceFiles(storage: Storage, workspace: string): PictureFiles {
  const own = `workspaces/${workspace}/`
  return {
    async read(key) {
      if (!key.startsWith(own)) throw new Error(`the picture ${key} is not the workspace’s`)
      const bytes = await storage.get(key)
      if (!bytes) throw new Error(`the picture ${key} is gone`)
      return bytes
    },
    async save(bytes, type) {
      const key = originalKey(workspace, createHash('sha256').update(bytes).digest('hex'))
      if (!(await storage.exists(key))) await storage.put(key, bytes, type)
      return key
    },
  }
}

/** Runs a `calls` job's attempt: done with each call's output, by call index. */
async function runCalls(deps: JobWorkerDeps, attempt: JobAttempt, calls: Limiter): Promise<JobEnd> {
  const { input } = attempt
  if (input.kind !== 'calls') throw new Error(`the ai-calls queue can’t run a ${input.kind} job`)
  return { state: 'done', output: { outputs: await runAttempt(deps, calls, { ...attempt, input: input.input }) } }
}
