// The worker running saved `ai-steps` jobs on a real pg-boss in the test database, with test sellers: each
// case on its own queue and workspace.
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { cancelJob, endJob, saveJob, startRun, sweepJobs } from '@dazbee/ai'
import { testSeller } from '@dazbee/ai/test-sellers'
import { aiCalls, aiSettings, newId } from '@dazbee/db'
import type { AiStepsInput } from '@dazbee/schema'

import { limiter, runAttempt, startStepsWorker, type StepsWorker } from './steps-job.ts'
import {
  callsOf,
  db,
  expectSettled,
  jobRow,
  memberOf,
  newBoss,
  newQueue,
  newSeller,
  stepsOf,
  storage,
  waitForJob,
} from './test-worker.ts'

/** A worker on `queue` with its own pg-boss, as a worker process would have. */
async function worker(queue: string, options: { jobLimit?: number } = {}) {
  const boss = await newBoss()
  const steps = await startStepsWorker({ db, boss, storage, queue, callLimit: 8, cancelCheckMs: 200, ...options })
  return { boss, steps }
}

/** Saves a job of `input` for `who` on `queue`; its id. */
async function save(who: { workspace: string; member: string }, queue: string, input: AiStepsInput) {
  const boss = await newBoss()
  try {
    const saved = await db.transaction((tx) => saveJob(tx, boss, { ...who, kind: 'ai-steps', input, queue }))
    if (!saved.ok) throw new Error(`refused: ${saved.refusal}`)
    return saved.job
  } finally {
    await boss.stop({ graceful: false })
  }
}

const stopAll = (...workers: { steps: StepsWorker }[]) =>
  Promise.all(workers.map((w) => w.steps.stop('graceful', 1000)))

describe('startStepsWorker', () => {
  it('runs a job to its end: output stored, each call charged once, the rest of the hold given back', async () => {
    const queue = newQueue()
    const who = await memberOf()
    const input = await stepsOf([testSeller(newSeller('a'))], 3)
    const one = await worker(queue)
    const job = await save(who, queue, input)
    const done = await waitForJob(job, 'done')
    expect(done.output).toEqual({ outputs: Array(3).fill({ kind: 'text', text: 'test answer' }) })
    expect((await callsOf(job)).map((c) => c.state)).toEqual(['done', 'done', 'done'])
    await expectSettled(job, who.workspace)
    await stopAll(one)
  })

  it('goes to the next seller when the first fails, charging only the call made', async () => {
    const queue = newQueue()
    const who = await memberOf()
    const failing = testSeller(newSeller('a'), [{ fail: 503 }, { fail: 503 }])
    const next = testSeller(newSeller('b'))
    const input = await stepsOf([failing, next])
    const one = await worker(queue)
    const job = await save(who, queue, input)
    await waitForJob(job, 'done')
    expect((await callsOf(job)).map((c) => [c.seller, c.state])).toEqual([
      [failing.seller, 'failed'],
      [failing.seller, 'failed'],
      [next.seller, 'done'],
    ])
    await expectSettled(job, who.workspace)
    await stopAll(one)
  })

  it('stops a cancelled job’s calls, keeps what finished charged and gives back the rest', async () => {
    const queue = newQueue()
    const who = await memberOf()
    const seller = testSeller(newSeller('a'), [{ afterMs: 0 }], { afterMs: 5_000, timeoutMs: 20_000 })
    const input = await stepsOf([seller], 6)
    const one = await worker(queue)
    const job = await save(who, queue, input)
    await vi.waitFor(async () => expect((await callsOf(job)).some((c) => c.state === 'done')).toBe(true), {
      timeout: 10_000,
    })
    expect(await cancelJob(db, who.workspace, job)).toBe(true)
    await waitForJob(job, 'cancelled')
    const states = (await callsOf(job)).map((c) => c.state)
    expect(states).toContain('done')
    expect(states).toContain('unknown')
    await expectSettled(job, who.workspace)
    await stopAll(one)
  })

  it('finishes a job on a second worker after the first stops gracefully mid-job, charging each call once', async () => {
    const queue = newQueue()
    const who = await memberOf()
    const input = await stepsOf([testSeller(newSeller('a'), [], { afterMs: 2_000, timeoutMs: 20_000 })], 2)
    const first = await worker(queue)
    const job = await save(who, queue, input)
    await waitForJob(job, 'running')
    await first.steps.stop('graceful', 1_000)
    const second = await worker(queue)
    const done = await waitForJob(job, 'done', 45_000)
    expect(done.attempt).toBe(2)
    await expectSettled(job, who.workspace)
    await stopAll(second)
  })

  it('finishes a job on a second worker after the first stops hard mid-job, charging each call once', async () => {
    const queue = newQueue()
    const who = await memberOf()
    const input = await stepsOf([testSeller(newSeller('a'), [], { afterMs: 1_500, timeoutMs: 20_000 })], 6)
    const first = await worker(queue)
    const job = await save(who, queue, input)
    await vi.waitFor(async () => expect((await callsOf(job)).some((c) => c.state === 'done')).toBe(true), {
      timeout: 10_000,
    })
    await first.steps.stop('hard')
    const second = await worker(queue)
    const done = await waitForJob(job, 'done', 45_000)
    expect(done.attempt).toBe(2)
    await expectSettled(job, who.workspace)
    await stopAll(second)
  })

  it('charges each call once when two runs of one job overlap', async () => {
    const queue = newQueue()
    const who = await memberOf()
    const input = await stepsOf([testSeller(newSeller('a'), [], { afterMs: 1_000, timeoutMs: 20_000 })], 4)
    const first = await worker(queue)
    const job = await save(who, queue, input)
    await waitForJob(job, 'running')
    // A second run, as a worker that took the job back after an expired claim would start one.
    const boss = await newBoss()
    const row = await jobRow(job)
    const second = await startRun(db, boss, { job, queue, queueJobId: row.queueJobId ?? '' })
    if (!second.run) throw new Error('the second run did not start')
    const outputs = await runAttempt({ db, storage }, limiter(8), {
      job,
      workspace: who.workspace,
      attempt: second.attempt,
      input,
      signal: new AbortController().signal,
    })
    expect(await endJob(db, job, second.attempt, { state: 'done', output: { outputs } })).toBe(true)
    await vi.waitFor(async () => expect((await callsOf(job)).every((c) => c.state !== 'running')).toBe(true), {
      timeout: 15_000,
    })
    await expectSettled(job, who.workspace)
    await boss.stop({ graceful: false })
    await stopAll(first)
  })

  it('fails a job whose call fails for good, with no pg-boss retry', async () => {
    const queue = newQueue()
    const who = await memberOf()
    const input = await stepsOf([testSeller(newSeller('a'), [{ fail: 400 }])])
    const one = await worker(queue)
    const job = await save(who, queue, input)
    const failed = await waitForJob(job, 'failed')
    expect(failed.error).toMatch(/refused/)
    expect(failed.attempt).toBe(1)
    const [queued] = await one.boss.findJobs(queue, { id: failed.queueJobId ?? '' })
    expect(queued?.state).toBe('completed')
    await expectSettled(job, who.workspace)
    await stopAll(one)
  })
})

describe('sweepJobs', () => {
  it('fails a job whose worker stopped hard on its last try, and gives back its hold', async () => {
    const queue = newQueue()
    const who = await memberOf()
    const boss = await newBoss()
    await boss.createQueue(queue, { retryLimit: 0, expireInSeconds: 1800, heartbeatSeconds: 30 })
    const input = await stepsOf([testSeller(newSeller('a'), [], { afterMs: 5_000, timeoutMs: 20_000 })])
    const first = await worker(queue)
    const job = await save(who, queue, input)
    await waitForJob(job, 'running')
    await first.steps.stop('hard')
    await vi.waitFor(async () => expect(await sweepJobs(db, boss, queue)).toBe(1), { timeout: 15_000, interval: 500 })
    const failed = await waitForJob(job, 'failed')
    expect(failed.error).toBe('its run was lost')
    await expectSettled(job, who.workspace)
    await boss.stop({ graceful: false })
  })
})

describe('the job limit', () => {
  it('holds a fourth job back, and lets it start once the limit is raised, without a restart', async () => {
    const queue = newQueue()
    const who = await memberOf()
    const input = await stepsOf([testSeller(newSeller('a'), [], { afterMs: 20_000, timeoutMs: 60_000 })])
    const one = await worker(queue)
    const jobs = [
      await save(who, queue, input),
      await save(who, queue, input),
      await save(who, queue, input),
      await save(who, queue, input),
    ]
    const states = async () => (await Promise.all(jobs.map(jobRow))).map((row) => row.state).sort()
    try {
      await vi.waitFor(async () => expect(await states()).toEqual(['running', 'running', 'running', 'waiting']), {
        timeout: 15_000,
      })
      await new Promise((resolve) => setTimeout(resolve, 2_000))
      expect(await states()).toEqual(['running', 'running', 'running', 'waiting'])
      await db.update(aiSettings).set({ jobLimit: 4 })
      await vi.waitFor(async () => expect(await states()).toEqual(['running', 'running', 'running', 'running']), {
        timeout: 20_000,
      })
    } finally {
      await db.update(aiSettings).set({ jobLimit: 3 })
      for (const job of jobs) await cancelJob(db, who.workspace, job)
      await stopAll(one)
    }
  })
})

describe('saveJob', () => {
  it('refuses a Reviewer', async () => {
    const boss = await newBoss()
    const who = await memberOf('reviewer')
    const input = await stepsOf([testSeller(newSeller('a'))])
    const saved = await db.transaction((tx) => saveJob(tx, boss, { ...who, kind: 'ai-steps', input }))
    expect(saved).toEqual({ ok: false, refusal: 'not-allowed' })
    await boss.stop({ graceful: false })
  })

  it('refuses a job once the day’s spending stop is reached', async () => {
    const boss = await newBoss()
    const who = await memberOf()
    const input = await stepsOf([testSeller(newSeller('a'))])
    const refused = await db
      .transaction(async (tx) => {
        const [settings] = await tx.select().from(aiSettings)
        // Today's spend at the stop, seen only inside this transaction, which is rolled back.
        await tx.insert(aiCalls).values({
          id: newId(),
          jobId: 'spent',
          workspaceId: 'spent',
          callIndex: 0,
          try: 1,
          attempt: 1,
          step: 'read',
          model: 'test',
          seller: 'test',
          state: 'done',
          realCost: settings?.spendingStop ?? 0n,
        })
        const result = await saveJob(tx, boss, { ...who, kind: 'ai-steps', input })
        throw Object.assign(new Error('roll back'), { result })
      })
      .catch((error: { result?: unknown }) => error.result)
    expect(refused).toEqual({ ok: false, refusal: 'stopped' })
    expect(await db.select().from(aiCalls).where(eq(aiCalls.jobId, 'spent'))).toEqual([])
    await boss.stop({ graceful: false })
  })
})
