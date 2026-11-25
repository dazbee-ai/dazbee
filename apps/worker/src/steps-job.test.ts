// The worker running saved `ai-steps` jobs on a real pg-boss in the test database, with test sellers: each
// case on its own queue and workspace. A crash is a worker in a process of its own, killed.
import { eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { cancelJob, endJob, saveJob, startAttempt, sweepJobs } from '@dazbee/ai'
import { testSeller } from '@dazbee/ai/test-sellers'
import { aiCalls, aiSettings, newId } from '@dazbee/db'
import type { AiStepsInput } from '@dazbee/schema'

import { limiter, runAttempt, startStepsWorker, type StepsWorker, workspaceFiles } from './steps-job.ts'
import {
  callsOf,
  crashingWorker,
  crashQueue,
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
async function worker(queue: string, options: { jobsAtOnce?: number } = {}) {
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

const someDone = (job: string) =>
  vi.waitFor(async () => expect((await callsOf(job)).some((c) => c.state === 'done')).toBe(true), { timeout: 15_000 })

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

  it('finishes a job on its backup seller when the first is out of money', async () => {
    const queue = newQueue()
    const who = await memberOf()
    const down = testSeller(newSeller('a'), [{ fail: 402 }])
    const backup = testSeller(newSeller('b'))
    const input = await stepsOf([down, backup])
    const one = await worker(queue)
    const job = await save(who, queue, input)
    await waitForJob(job, 'done')
    expect((await callsOf(job)).map((c) => [c.seller, c.state])).toEqual([
      [down.seller, 'failed'],
      [backup.seller, 'done'],
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
    await someDone(job)
    expect(await cancelJob(db, who.workspace, job)).toBe(true)
    await waitForJob(job, 'cancelled')
    const states = (await callsOf(job)).map((c) => c.state)
    expect(states).toContain('done')
    expect(states).toContain('unknown')
    expect(states).not.toContain('failed')
    await expectSettled(job, who.workspace)
    await stopAll(one)
  })

  it('sends a job again when it stops gracefully mid-job, so a second worker finishes it with no try spent', async () => {
    const queue = newQueue()
    const who = await memberOf()
    const seller = testSeller(newSeller('a'), [{ afterMs: 0 }], { afterMs: 3_000, timeoutMs: 20_000 })
    const input = await stepsOf([seller], 4)
    const first = await worker(queue)
    const job = await save(who, queue, input)
    await someDone(job)
    const sent = (await jobRow(job)).queueJobId ?? ''
    await first.steps.stop('graceful', 1_000)
    const second = await worker(queue)
    const [original] = await second.boss.findJobs(queue, { id: sent })
    expect(original?.state).toBe('completed')
    const done = await waitForJob(job, 'done')
    expect(done.attempt).toBe(2)
    expect(done.queueJobId).not.toBe(sent)
    await expectSettled(job, who.workspace)
    await stopAll(second)
  })

  it('finishes a job on a second worker after the first crashes mid-job, charging each call once', async () => {
    const queue = newQueue()
    const who = await memberOf()
    const boss = await newBoss()
    await crashQueue(boss, queue)
    const seller = testSeller(newSeller('a'), [], { afterMs: 1_500, timeoutMs: 20_000 })
    const input = await stepsOf([seller], 6)
    const crashing = await crashingWorker(queue, input.calls[0]?.step ?? '', seller.seller, 1_500)
    const job = await save(who, queue, input)
    await someDone(job)
    await crashing.kill()
    const second = await worker(queue)
    const done = await waitForJob(job, 'done', 60_000)
    expect(done.attempt).toBe(2)
    await expectSettled(job, who.workspace)
    await stopAll(second)
    await boss.stop({ graceful: false })
  }, 90_000)

  it('fails a job whose call fails for good, with no pg-boss retry', async () => {
    const queue = newQueue()
    const who = await memberOf()
    const input = await stepsOf([testSeller(newSeller('a'), [{ fail: 400 }])])
    const one = await worker(queue)
    const job = await save(who, queue, input)
    const failed = await waitForJob(job, 'failed')
    expect(failed.error).toMatch(/refused/)
    expect(failed.attempt).toBe(1)
    // pg-boss completes its job once the handler returns, just after the AI job ends.
    await vi.waitFor(async () => {
      const [queued] = await one.boss.findJobs(queue, { id: failed.queueJobId ?? '' })
      expect(queued?.state).toBe('completed')
    })
    await expectSettled(job, who.workspace)
    await stopAll(one)
  })

  it('leaves a job whose worker crashed on its last try to the sweep, which fails it and gives back its hold', async () => {
    const queue = newQueue()
    const who = await memberOf()
    const boss = await newBoss()
    await crashQueue(boss, queue, 0)
    const seller = testSeller(newSeller('a'), [], { afterMs: 20_000, timeoutMs: 60_000 })
    const input = await stepsOf([seller])
    const crashing = await crashingWorker(queue, input.calls[0]?.step ?? '', seller.seller, 20_000)
    const job = await save(who, queue, input)
    await vi.waitFor(async () => expect((await callsOf(job)).map((c) => c.state)).toEqual(['running']), {
      timeout: 15_000,
    })
    await crashing.kill()
    await vi.waitFor(async () => expect(await sweepJobs(db, boss, queue)).toBe(1), { timeout: 40_000, interval: 1_000 })
    const failed = await waitForJob(job, 'failed')
    expect(failed.error).toBe('its worker was lost')
    expect((await callsOf(job)).map((c) => c.state)).toEqual(['unknown'])
    await expectSettled(job, who.workspace)
    await boss.stop({ graceful: false })
  }, 90_000)

  it('holds a workspace’s fourth job back, and starts it once the job limit is raised, without a restart', async () => {
    const queue = newQueue()
    const who = await memberOf()
    const input = await stepsOf([testSeller(newSeller('a'), [], { afterMs: 20_000, timeoutMs: 60_000 })])
    const one = await worker(queue, { jobsAtOnce: 8 })
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

  it('takes no job from a Reviewer, nor once the day’s spending stop is reached', async () => {
    const boss = await newBoss()
    const reviewer = await memberOf('reviewer')
    const input = await stepsOf([testSeller(newSeller('a'))])
    const refusedReviewer = await db.transaction((tx) => saveJob(tx, boss, { ...reviewer, kind: 'ai-steps', input }))
    expect(refusedReviewer).toEqual({ ok: false, refusal: 'not-allowed' })
    const who = await memberOf()
    const refused = await db
      .transaction(async (tx) => {
        const [settings] = await tx.select().from(aiSettings)
        // Today's spend at the stop, seen only inside this transaction, which is rolled back.
        const spent = { id: newId(), jobId: 'spent', workspaceId: 'spent', callIndex: 0, try: 1, attempt: 1 }
        await tx.insert(aiCalls).values({
          ...spent,
          step: 'flow.read',
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

describe('runAttempt', () => {
  it('charges each call once when two attempts of one job overlap', async () => {
    const queue = newQueue()
    const who = await memberOf()
    const input = await stepsOf([testSeller(newSeller('a'), [], { afterMs: 1_000, timeoutMs: 20_000 })], 4)
    const first = await worker(queue)
    const job = await save(who, queue, input)
    await waitForJob(job, 'running')
    // A second attempt, as a worker that took the job back after an expired claim would start one.
    const boss = await newBoss()
    const second = await startAttempt(db, boss, { job, queue, queueJobId: (await jobRow(job)).queueJobId ?? '' })
    if (!second.make) throw new Error('the second attempt did not start')
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
})

describe('limiter', () => {
  it('runs at most its size at once, and the rest in turn', async () => {
    const limit = limiter(2)
    let active = 0
    let most = 0
    const task = async () => {
      most = Math.max(most, ++active)
      await new Promise((resolve) => setTimeout(resolve, 20))
      active--
    }
    await Promise.all(Array.from({ length: 6 }, () => limit.run(task)))
    expect(most).toBe(2)
  })
})

describe('workspaceFiles', () => {
  it('stores a made picture once by its SHA-256 and reads only the workspace’s own pictures', async () => {
    const workspace = `ws-${newId()}`
    const files = workspaceFiles(storage, workspace)
    const bytes = new TextEncoder().encode(`picture ${newId()}`)
    const key = await files.save(bytes, 'image/png')
    expect(key).toMatch(new RegExp(`^workspaces/${workspace}/originals/[0-9a-f]{64}$`))
    expect(await files.save(bytes, 'image/png')).toBe(key)
    expect(await files.read(key)).toEqual(bytes)
    await expect(workspaceFiles(storage, 'other').read(key)).rejects.toThrow('not the workspace’s')
  })
})
