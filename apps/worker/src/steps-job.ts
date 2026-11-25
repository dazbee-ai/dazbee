// Runs `ai-steps` jobs (ADR-0022): each attempt starts under the workspace's job limit, makes the job's AI
// calls through `callAi` (up to 4 at once per job, and at most the worker-wide limit across jobs), and ends
// the job with its output and the rest of its hold given back. A cancel aborts the attempt's calls; a stop
// sends the job again before pg-boss would fail it, and an expiry or a crash leaves it to pg-boss's retry.
import { createHash } from 'node:crypto'

import type { JobWithMetadata, PgBoss } from 'pg-boss'

import {
  callAi,
  CallFailed,
  endJob,
  ensureQueue,
  isCancelled,
  type PictureFiles,
  sendAgain,
  startAttempt,
} from '@dazbee/ai'
import type { Db } from '@dazbee/db'
import { AiJobMessage, type AiStepsInput, type CallOutput } from '@dazbee/schema'
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
  /** The most jobs this worker holds at once; half the call limit unless given. */
  jobsAtOnce?: number
  /** How often a running job's state is read for a cancel. */
  cancelCheckMs?: number
}

/** A running steps worker. */
export interface StepsWorker {
  /**
   * Stops taking jobs. Gracefully, it waits up to `timeoutMs` for the running ones and sends those still
   * running again, so the stop spends none of their tries; hard, it drops them at once, as a crash would.
   */
  stop(how: 'graceful' | 'hard', timeoutMs?: number): Promise<void>
}

/** Runs at most `size` tasks at once; the rest wait their turn. */
export interface Limiter {
  run<T>(task: () => Promise<T>): Promise<T>
}

/** One attempt of a job, as `runAttempt` makes it. */
export interface Attempt {
  job: string
  workspace: string
  attempt: number
  input: AiStepsInput
  /** Aborted when the job is cancelled or the worker stops. */
  signal: AbortSignal
  /** Reads the job's state between calls, aborting `signal` on a cancel. */
  checkCancel?: () => Promise<void>
}

/** Why an attempt's calls were aborted: a cancel, the worker sending the job again, or pg-boss taking it back. */
type AbortWhy = 'cancelled' | 'sending-again' | 'taken-back'

/** The most calls of one job running at once. */
const CALLS_PER_JOB = 4

/** How long before a graceful stop's end the worker sends its running jobs again. */
const SEND_AGAIN_BEFORE_MS = 5_000

/** Starts running the queue's `ai-steps` jobs. */
export async function startStepsWorker(deps: StepsWorkerDeps): Promise<StepsWorker> {
  const { db, boss, queue } = deps
  // The worker-wide limit on calls at once.
  const calls = limiter(deps.callLimit)
  // Every attempt in hand, by pg-boss job id, so a stop can abort them.
  const running = new Map<string, AbortController>()
  // Set once the worker is dropped: its attempts write nothing more, as a crashed worker's wouldn't.
  let dead = false

  async function handle(job: JobWithMetadata<unknown>): Promise<void> {
    if (dead) throw new Error('the worker stopped')
    const { job: id } = AiJobMessage.parse(job.data)
    const controller = new AbortController()
    const takenBack = () => controller.abort('taken-back' satisfies AbortWhy)
    job.signal.addEventListener('abort', takenBack, { once: true })
    running.set(job.id, controller)
    const checkCancel = async () => {
      if (await isCancelled(db, id).catch(() => false)) controller.abort('cancelled' satisfies AbortWhy)
    }
    const watch = setInterval(() => void checkCancel(), deps.cancelCheckMs ?? 5_000)
    try {
      if (job.signal.aborted) throw new Error('pg-boss took the job back')
      const start = await startAttempt(db, boss, { job: id, queue, queueJobId: job.id })
      if (!start.make) return
      const made = { job: id, workspace: start.workspace, attempt: start.attempt, input: start.input }
      await attempt(job, made, controller, checkCancel)
    } finally {
      clearInterval(watch)
      job.signal.removeEventListener('abort', takenBack)
      running.delete(job.id)
    }
  }

  async function attempt(
    job: JobWithMetadata<unknown>,
    made: Omit<Attempt, 'signal' | 'checkCancel'>,
    controller: AbortController,
    checkCancel: () => Promise<void>,
  ): Promise<void> {
    try {
      const outputs = await runAttempt(deps, calls, { ...made, signal: controller.signal, checkCancel })
      if (!dead) await endJob(db, made.job, made.attempt, { state: 'done', output: { outputs } })
    } catch (error) {
      if (dead) throw error
      const why = controller.signal.reason as AbortWhy | undefined
      if (why === 'cancelled') {
        await endJob(db, made.job, made.attempt, { state: 'cancelled' })
        return
      }
      if (why === 'sending-again') {
        await sendAgain(db, boss, { job: made.job, attempt: made.attempt, queue })
        return
      }
      if (error instanceof CallFailed) {
        await endJob(db, made.job, made.attempt, { state: 'failed', error: error.message })
        return
      }
      // An expiry or a crash goes back to pg-boss to be tried again; on the last try the job ends here.
      if (why !== 'taken-back' && job.retryCount >= job.retryLimit) {
        await endJob(db, made.job, made.attempt, { state: 'failed', error: messageOf(error) })
      }
      throw error
    }
  }

  async function stop(how: 'graceful' | 'hard', timeoutMs = 110_000): Promise<void> {
    if (how === 'hard') {
      dead = true
      for (const controller of running.values()) controller.abort('taken-back' satisfies AbortWhy)
      await boss.stop({ graceful: false, close: true })
      return
    }
    const sendingAgain = setTimeout(
      () => {
        for (const controller of running.values()) controller.abort('sending-again' satisfies AbortWhy)
      },
      Math.max(0, timeoutMs - SEND_AGAIN_BEFORE_MS),
    )
    try {
      await boss.stop({ graceful: true, timeout: timeoutMs, close: true })
    } finally {
      clearTimeout(sendingAgain)
    }
  }

  await ensureQueue(boss, queue)
  await boss.work(
    queue,
    {
      localConcurrency: deps.jobsAtOnce ?? Math.max(1, Math.ceil(deps.callLimit / 2)),
      batchSize: 1,
      pollingIntervalSeconds: 0.5,
      includeMetadata: true,
    },
    async ([job]) => {
      if (job) await handle(job)
    },
  )

  return { stop }
}

/**
 * Makes one attempt's AI calls, up to 4 at once, each under the worker-wide limit; their outputs, by call
 * index. The job's state is read before each call. A call that fails for good stops new calls, waits for
 * those running, then fails the attempt.
 */
export async function runAttempt(
  deps: Pick<StepsWorkerDeps, 'db' | 'storage'>,
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
            step: call.step,
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
