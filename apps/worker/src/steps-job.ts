// Runs `ai-steps` jobs (ADR-0022): each run starts under the workspace's job limit, makes the job's AI calls
// through `callAi` (up to 4 at once per job, and at most the worker-wide limit across jobs), and ends the job
// with its output and the rest of its hold given back. A cancel aborts the run's calls; a stop or an expiry
// leaves the job to its next run.
import { createHash } from 'node:crypto'

import type { Job, PgBoss } from 'pg-boss'

import {
  callAi,
  CallFailed,
  endJob,
  ensureQueue,
  isCancelled,
  type PictureFiles,
  QUEUE_OPTIONS,
  startRun,
} from '@dazbee/ai'
import type { Db } from '@dazbee/db'
import type { AiStepsInput, CallOutput } from '@dazbee/schema'
import { originalKey, type Storage } from '@dazbee/storage'

/** What a steps worker runs on. */
export interface StepsWorkerDeps {
  db: Db
  boss: PgBoss
  storage: Storage
  /** The pg-boss queue of `ai-steps` jobs. */
  queue: string
  /** The most AI calls running at once across every job. */
  callLimit: number
  /** The most jobs running at once. */
  jobLimit?: number
  /** How often a running job's state is read for a cancel. */
  cancelCheckMs?: number
}

/** A running steps worker. */
export interface StepsWorker {
  /**
   * Stops taking jobs. Gracefully, it waits up to `timeoutMs` for the running ones, and pg-boss gives back
   * those still running to be retried; hard, it drops them at once, as a crashed worker would.
   */
  stop(how: 'graceful' | 'hard', timeoutMs?: number): Promise<void>
}

/** One run of a job, as `runAttempt` makes it. */
export interface Attempt {
  job: string
  workspace: string
  attempt: number
  input: AiStepsInput
  signal: AbortSignal
}

/** Runs at most `size` tasks at once; the rest wait their turn. */
export interface Limiter {
  run<T>(task: () => Promise<T>): Promise<T>
}

/** Why a run's calls were aborted. */
type AbortWhy = 'cancelled' | 'stopped'

/** The most calls of one job running at once. */
const CALLS_PER_JOB = 4

/** The most jobs one worker runs at once unless told otherwise; their calls share the worker-wide limit. */
const JOBS_AT_ONCE = 16

/** Starts running the queue's `ai-steps` jobs. */
export async function startStepsWorker(deps: StepsWorkerDeps): Promise<StepsWorker> {
  const calls = limiter(deps.callLimit)
  // Every run in hand, by pg-boss job id, so a hard stop can drop them.
  const running = new Map<string, AbortController>()
  // Set once the worker is dropped: its runs write nothing more, as a crashed worker's wouldn't.
  let dead = false
  await ensureQueue(deps.boss, deps.queue)
  await deps.boss.work<{ job: string }>(
    deps.queue,
    { localConcurrency: deps.jobLimit ?? JOBS_AT_ONCE, batchSize: 1, pollingIntervalSeconds: 0.5 },
    async ([job]) => {
      if (job) await handle(job)
    },
  )

  async function handle(job: Job<{ job: string }>): Promise<void> {
    if (dead) throw new Error('the worker stopped')
    const start = await startRun(deps.db, deps.boss, { job: job.data.job, queue: deps.queue, queueJobId: job.id })
    if (!start.run) return
    const controller = new AbortController()
    running.set(job.id, controller)
    const stopped = () => controller.abort('stopped' satisfies AbortWhy)
    job.signal.addEventListener('abort', stopped, { once: true })
    const watch = setInterval(() => void watchCancel(), deps.cancelCheckMs ?? 5_000)
    async function watchCancel() {
      if (await isCancelled(deps.db, job.data.job).catch(() => false)) controller.abort('cancelled' satisfies AbortWhy)
    }
    const attempt = { job: job.data.job, workspace: start.workspace, attempt: start.attempt, input: start.input }
    try {
      const outputs = await runAttempt(deps, calls, { ...attempt, signal: controller.signal })
      if (!dead) await endJob(deps.db, attempt.job, attempt.attempt, { state: 'done', output: { outputs } })
    } catch (error) {
      if (dead) throw error
      if (controller.signal.reason === 'cancelled') {
        await endJob(deps.db, attempt.job, attempt.attempt, { state: 'cancelled' })
        return
      }
      if (error instanceof CallFailed) {
        await endJob(deps.db, attempt.job, attempt.attempt, { state: 'failed', error: error.message })
        return
      }
      // A stop, an expiry or a crash goes back to pg-boss to be run again; on the last try the job ends here.
      if (!controller.signal.aborted && job.retryCount >= QUEUE_OPTIONS.retryLimit) {
        await endJob(deps.db, attempt.job, attempt.attempt, { state: 'failed', error: messageOf(error) })
      }
      throw error
    } finally {
      clearInterval(watch)
      job.signal.removeEventListener('abort', stopped)
      running.delete(job.id)
    }
  }

  async function stop(how: 'graceful' | 'hard', timeoutMs = 110_000): Promise<void> {
    if (how === 'hard') {
      dead = true
      for (const controller of running.values()) controller.abort('stopped' satisfies AbortWhy)
      await deps.boss.stop({ graceful: false, close: true })
      return
    }
    await deps.boss.stop({ graceful: true, timeout: timeoutMs, close: true })
  }

  return { stop }
}

/**
 * Makes one run's AI calls, up to 4 at once, each under the worker-wide limit; their outputs, by call index.
 * A call that fails for good stops new calls, waits for those running, then fails the run.
 */
export async function runAttempt(
  deps: Pick<StepsWorkerDeps, 'db' | 'storage'>,
  calls: Limiter,
  run: Attempt,
): Promise<CallOutput[]> {
  const files = workspaceFiles(deps.storage, run.workspace)
  const outputs: CallOutput[] = []
  let next = 0
  let failure: unknown = null
  async function lane(): Promise<void> {
    while (failure === null && next < run.input.calls.length) {
      run.signal.throwIfAborted()
      const callIndex = next++
      const call = run.input.calls[callIndex]
      if (!call) return
      try {
        outputs[callIndex] = await calls.run(() =>
          callAi(deps.db, {
            job: { id: run.job, workspaceId: run.workspace },
            attempt: run.attempt,
            callIndex,
            step: call.step,
            input: call.input,
            signal: run.signal,
            files,
            ...(call.sellers ? { sellers: call.sellers } : {}),
          }),
        )
      } catch (error) {
        failure ??= error
      }
    }
  }
  const lanes = Math.min(CALLS_PER_JOB, run.input.calls.length)
  await Promise.all(Array.from({ length: lanes }, lane))
  if (failure !== null) throw failure
  run.signal.throwIfAborted()
  return outputs
}

/** A `Limiter` of `size`. */
export function limiter(size: number): Limiter {
  let active = 0
  const waiting: (() => void)[] = []
  return {
    async run(task) {
      if (active >= size) await new Promise<void>((resolve) => waiting.push(resolve))
      active++
      try {
        return await task()
      } finally {
        active--
        waiting.shift()?.()
      }
    },
  }
}

/**
 * The workspace's originals as AI calls read and make them: a picture is read only from the workspace's own
 * keys, and a made picture is stored once by its SHA-256, as uploads are.
 */
export function workspaceFiles(storage: Storage, workspace: string): PictureFiles {
  const own = `workspaces/${workspace}/`
  return {
    async read(key) {
      if (!key.startsWith(own)) throw new Error(`the picture ${key} is not the workspace's`)
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
