// The AI jobs' worker (ADR-0022): runs one queue's jobs, each attempt started under the workspace's job limit,
// handed to the queue's runner, which makes the job's AI calls through `callAi` (at most the worker-wide limit
// across jobs and queues), and ends the job as the runner says, with the rest of its hold given back. A cancel aborts the attempt's calls; a stop
// sends the job again before pg-boss would fail it, and an expiry or a crash leaves it to pg-boss's retry.
import type { JobWithMetadata, PgBoss } from 'pg-boss'

import {
  CallFailed,
  endJob,
  ensureQueue,
  isCancelled,
  type JobEnd,
  type JobInput,
  sendAgain,
  startAttempt,
} from '@dazbee/ai'
import type { Db } from '@dazbee/db'
import { AiJobMessage } from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'

/** Runs at most `size` tasks at once; the rest wait their turn. */
export interface Limiter {
  run<T>(task: () => Promise<T>): Promise<T>
}

/** What a job worker runs on. */
export interface JobWorkerDeps {
  db: Db
  boss: PgBoss
  storage: Storage
  /** The pg-boss queue it runs. */
  queue: string
  /** The most AI calls running at once across every job. */
  callLimit: number
  /** The limit of `callLimit` calls at once, when another queue's worker shares it; one of its own unless given. */
  calls?: Limiter
  /** The most jobs this worker holds at once; half the call limit unless given. */
  jobsAtOnce?: number
  /** How often a running job's state is read for a cancel. */
  cancelCheckMs?: number
}

/** A running job worker. */
export interface JobWorker {
  /**
   * Stops taking jobs. Gracefully, it waits up to `timeoutMs` for the running ones and sends those still
   * running again, so the stop spends none of their tries; hard, it drops them at once, as a crash would.
   */
  stop(how: 'graceful' | 'hard', timeoutMs?: number): Promise<void>
}

/** One attempt of a job, as the worker hands it to its queue's runner. */
export interface JobAttempt {
  job: string
  workspace: string
  attempt: number
  input: JobInput
  /** Aborted when the job is cancelled or the worker stops. */
  signal: AbortSignal
  /** Reads the job's state, aborting `signal` on a cancel. */
  checkCancel: () => Promise<void>
}

/**
 * Runs one attempt of a job to its end under the worker-wide limit `calls`; how the job ends. A call that fails for
 * good, thrown, fails the job; any other error sends it back to pg-boss to be tried again.
 */
export type RunJob = (attempt: JobAttempt, calls: Limiter) => Promise<JobEnd>

/** Why an attempt's calls were aborted: a cancel, the worker sending the job again, or pg-boss taking it back. */
type AbortWhy = 'cancelled' | 'sending-again' | 'taken-back'

/** How long before a graceful stop's end the worker sends its running jobs again. */
const SEND_AGAIN_BEFORE_MS = 5_000

/** Starts running the queue's jobs with `run`. */
export async function startJobWorker(deps: JobWorkerDeps, run: RunJob): Promise<JobWorker> {
  const { db, boss, queue } = deps
  // The worker-wide limit on calls at once.
  const calls = deps.calls ?? limiter(deps.callLimit)
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
      const made = { job: id, workspace: start.workspace, attempt: start.attempt, input: start.job }
      await attempt(job, made, controller, checkCancel)
    } finally {
      clearInterval(watch)
      job.signal.removeEventListener('abort', takenBack)
      running.delete(job.id)
    }
  }

  async function attempt(
    job: JobWithMetadata<unknown>,
    made: Omit<JobAttempt, 'signal' | 'checkCancel'>,
    controller: AbortController,
    checkCancel: () => Promise<void>,
  ): Promise<void> {
    try {
      const end = await run({ ...made, signal: controller.signal, checkCancel }, calls)
      if (!dead) await endJob(db, made.job, made.attempt, end)
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
