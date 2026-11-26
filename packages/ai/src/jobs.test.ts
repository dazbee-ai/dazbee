// Saving an AI job with its hold, against Postgres from Docker Compose and a real pg-boss.
import { eq, sql } from 'drizzle-orm'
import { fromDrizzle, PgBoss } from 'pg-boss'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { aiCalls, aiJobs, aiLedger, aiPicks, brands, memberships, newId, users, workspaces } from '@dazbee/db'
import type { CallInput, CallsInput, MemberRole, RoundInput } from '@dazbee/schema'

import { callAi } from './call.ts'
import { cancelJob, ensureQueue, FLOW_QUEUE, readJob, saveJob } from './jobs.ts'
import { giveGrant, left } from './ledger.ts'
import { testSeller } from './sellers/test-sellers.ts'
import { aiSettingsOf } from './settings.ts'
import { addFunction, addJob, db, newSeller, newWorkspace, RUPEE, TEST_PRESET } from './test-ai.ts'
import { DATABASE_URL } from './test-database.ts'

const boss = new PgBoss({ connectionString: DATABASE_URL, max: 2, supervise: false, schedule: false })
const queue = `ai-calls-${newId()}`
let input: CallsInput

beforeAll(async () => {
  await boss.start()
  await ensureQueue(boss, queue)
  const { fn } = await addFunction([testSeller(newSeller('a'))])
  input = {
    calls: [
      {
        function: fn,
        preset: TEST_PRESET,
        input: { kind: 'text', instructions: 'Read.', prompt: 'An ad.', pictures: [] },
      },
    ],
  }
})

afterAll(() => boss.stop({ graceful: false }))

/** A workspace with a member of `role` and, unless told otherwise, ₹10 of allowance. */
async function memberOf(role: MemberRole, allowance = 10n * RUPEE) {
  const workspace = `ws-${newId()}`
  const member = `user-${newId()}`
  await db.insert(workspaces).values({ id: workspace, name: 'Harbour' })
  await db.insert(users).values({ id: member, workosUserId: `workos-${member}`, email: `${member}@example.com` })
  await db.insert(memberships).values({ workspaceId: workspace, userId: member, role })
  if (allowance > 0n) {
    await giveGrant(db, { workspace, amount: allowance, expiresAt: new Date(Date.now() + 86_400_000) })
  }
  return { workspace, member }
}

const save = (who: { workspace: string; member: string }, to = queue) =>
  db.transaction((tx) => saveJob(tx, boss, { ...who, kind: 'calls', input, queue: to }))

describe('saveJob', () => {
  it('saves the job, its hold and its pg-boss job together', async () => {
    const who = await memberOf('editor')
    const saved = await save(who)
    if (!saved.ok) throw new Error(saved.refusal)
    const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, saved.job))
    // A calls job names each call's preset itself, so it saves no mode and no presets.
    expect(job).toMatchObject({ state: 'waiting', attempt: 0, workspaceId: who.workspace, mode: null, presets: null })
    expect(await boss.findJobs(queue, { id: job?.queueJobId ?? '' })).toHaveLength(1)
    // Its one call's first guess, ₹0.10, times 1.25.
    expect(await left(db, who.workspace)).toBe(10n * RUPEE - 125_000n)
  })

  it('keeps nothing when the pg-boss job can’t be sent', async () => {
    const who = await memberOf('owner')
    await expect(save(who, `no-such-queue-${newId()}`)).rejects.toThrow()
    expect(await db.select().from(aiJobs).where(eq(aiJobs.workspaceId, who.workspace))).toEqual([])
    expect(await left(db, who.workspace)).toBe(10n * RUPEE)
  })

  it('refuses a Reviewer, and a workspace whose allowance is used up', async () => {
    expect(await save(await memberOf('reviewer'))).toEqual({ ok: false, refusal: 'not-allowed' })
    expect(await save(await memberOf('admin', 0n))).toEqual({ ok: false, refusal: 'used-up' })
  })

  it('throws on a picture call the schema refuses, before anything is held', async () => {
    const who = await memberOf('editor')
    const picture = { kind: 'picture', prompt: 'A cup.', width: 1024, height: 1024 } as const
    const bad = [
      { ...picture, pictures: [], marks: 'test/marks' },
      { ...picture, pictures: Array.from({ length: 16 }, (_, i) => `test/${i}`), marks: 'test/marks' },
    ]
    for (const call of bad) {
      const saving = db.transaction((tx) =>
        saveJob(tx, boss, {
          ...who,
          kind: 'calls',
          input: { calls: [{ function: 'refine-edit', preset: 'seedream', input: call }] },
          queue,
        }),
      )
      await expect(saving).rejects.toThrow()
    }
    expect(await left(db, who.workspace)).toBe(10n * RUPEE)
  })

  it('sends a flow job to the ai-flow queue, held by its job kind, and throws on an input of another job kind', async () => {
    const who = await memberOf('editor')
    const brandId = `brand-${newId()}`
    await db.insert(brands).values({ id: brandId, workspaceId: who.workspace, name: 'Harbour' })
    const target = { frameId: newId(), pictureLayerId: newId() }
    const size = { frameId: newId(), pictureLayerId: newId(), width: 1080, height: 1080 }
    const input = {
      brandId,
      designId: newId(),
      sectionId: newId(),
      pictureKey: 'workspaces/w/originals/a',
      sizes: [size],
    }
    await ensureQueue(boss, FLOW_QUEUE)
    // Taken off the shared queue in the transaction that sends it, so no worker running on this database sees it.
    const { saved, taken } = await db.transaction(async (tx) => {
      const saved = await saveJob(tx, boss, { ...who, kind: 'resize', input })
      if (!saved.ok) return { saved, taken: 0 }
      const [row] = await tx.select({ queueJobId: aiJobs.queueJobId }).from(aiJobs).where(eq(aiJobs.id, saved.job))
      const deleted = await boss.deleteJob(FLOW_QUEUE, row?.queueJobId ?? '', { db: fromDrizzle(tx, sql) })
      return { saved, taken: deleted.affected }
    })
    if (!saved.ok) throw new Error(saved.refusal)
    expect(taken).toBe(1)
    const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, saved.job))
    // No mode changes a resize, and it saves the preset of the one AI function it calls.
    expect(job).toMatchObject({ kind: 'resize', queue: FLOW_QUEUE, input, mode: null })
    expect(job?.presets).toEqual({ resize: 'seedream' })
    expect(await readJob(db, who.workspace, saved.job)).toMatchObject({ kind: 'resize', output: null, calls: [] })
    const wrong = { ...input, frame: target }
    await expect(
      db.transaction((tx) => saveJob(tx, boss, { ...who, kind: 'try-again', input: wrong as never })),
    ).rejects.toThrow()
  })

  it('keeps a job’s presets and its hold when a pick is made after it is saved, and gives the next job the pick', async () => {
    const who = await memberOf('editor', 100n * RUPEE)
    const target = () => ({ frameId: newId(), pictureLayerId: newId() })
    const round = (): RoundInput => ({
      brandId: `brand-${newId()}`,
      designId: newId(),
      briefId: newId(),
      sectionId: newId(),
      frames: [target(), target(), target(), target()],
      words: 'Harbour Coffee, fresh every morning',
      pictures: [],
      size: { width: 1080, height: 1080 },
      mode: 'precise',
      brand: { name: '', colors: [], fonts: [], voice: '' },
    })
    // In a transaction that is rolled back, so no other test's Precise round ever reads the pick.
    const read = await db
      .transaction(async (tx) => {
        const saveRound = async () => {
          const saved = await saveJob(tx, boss, { ...who, kind: 'round', input: round(), queue })
          if (!saved.ok) throw new Error(saved.refusal)
          return saved.job
        }
        const held = async (job: string) =>
          (await tx.select().from(aiLedger).where(eq(aiLedger.jobId, job))).map((row) => row.amount)
        const presets = async (job: string) => (await tx.select().from(aiJobs).where(eq(aiJobs.id, job)))[0]?.presets
        const before = await saveRound()
        await tx
          .insert(aiPicks)
          .values({ function: 'round-plan', mode: 'precise', preset: 'light-luna', setBy: 'admin' })
        const after = await saveRound()
        const result = {
          before: { presets: await presets(before), held: await held(before) },
          after: { presets: await presets(after), held: await held(after) },
        }
        throw Object.assign(new Error('roll back'), { result })
      })
      .catch((error: { result?: unknown }) => error.result)
    expect(read).toEqual({
      // The full plan and four drafts at their first guesses, times 1.25; only the AI functions a round calls.
      before: { presets: { 'round-plan': 'full-terra', draft: 'gpt-image-medium' }, held: [-12_325_000n] },
      after: { presets: { 'round-plan': 'light-luna', draft: 'gpt-image-medium' }, held: [-6_950_000n] },
    })
  })

  it('refuses every job once the day’s real cost reaches the spending stop', async () => {
    const who = await memberOf('editor')
    const refused = await db
      .transaction(async (tx) => {
        const { spendingStop } = await aiSettingsOf(tx)
        // A call that cost the whole stop today, seen only inside this transaction, which is rolled back.
        await tx.insert(aiCalls).values({
          id: newId(),
          jobId: 'spent',
          workspaceId: 'spent',
          callIndex: 0,
          try: 1,
          attempt: 1,
          function: 'reading',
          preset: 'luna',
          model: 'test',
          seller: 'test',
          state: 'done',
          realCost: spendingStop,
        })
        const result = await saveJob(tx, boss, { ...who, kind: 'calls', input, queue })
        throw Object.assign(new Error('roll back'), { result })
      })
      .catch((error: { result?: unknown }) => error.result)
    expect(refused).toEqual({ ok: false, refusal: 'stopped' })
  })
})

describe('readJob', () => {
  it('gives the workspace’s own job, and nothing for another workspace', async () => {
    const who = await memberOf('editor')
    const saved = await save(who)
    if (!saved.ok) throw new Error(saved.refusal)
    expect(await readJob(db, who.workspace, saved.job)).toMatchObject({ id: saved.job, state: 'waiting', output: null })
    expect(await readJob(db, 'another', saved.job)).toBeNull()
  })

  it('gives each started call: one made with its output, one that failed for good, one still being made', async () => {
    const workspace = newWorkspace()
    const job = await addJob(workspace)
    const made = await addFunction([testSeller(newSeller('made'))])
    const refused = await addFunction([testSeller(newSeller('refused'), [{ fail: 400 }])])
    const slow = await addFunction([testSeller(newSeller('slow'), [], { afterMs: 5000, timeoutMs: 10_000 })])
    const text: CallInput = { kind: 'text', instructions: 'Read.', prompt: 'An ad.', pictures: [] }
    const call = (callIndex: number, fn: string, signal = new AbortController().signal) =>
      callAi(db, {
        job: { id: job, workspaceId: workspace },
        attempt: 1,
        callIndex,
        feature: 'calls',
        function: fn,
        preset: TEST_PRESET,
        input: text,
        signal,
      })
    await call(0, made.fn)
    await expect(call(1, refused.fn)).rejects.toThrow()
    const stop = new AbortController()
    const making = call(2, slow.fn, stop.signal).catch(() => null)
    await vi.waitFor(async () => expect((await readJob(db, workspace, job))?.calls).toHaveLength(3))
    expect((await readJob(db, workspace, job))?.calls).toEqual([
      // Each call names its AI function, and as `step` too, for a tab built when a call named its AI step.
      { index: 0, function: made.fn, step: made.fn, state: 'done', output: { kind: 'text', text: 'test answer' } },
      { index: 1, function: refused.fn, step: refused.fn, state: 'failed', failure: 'not-made' },
      { index: 2, function: slow.fn, step: slow.fn, state: 'running' },
    ])
    stop.abort()
    await making
  })
})

describe('cancelJob', () => {
  it('cancels a job that hasn’t started and gives back its hold at once', async () => {
    const who = await memberOf('editor')
    const saved = await save(who)
    if (!saved.ok) throw new Error(saved.refusal)
    expect(await cancelJob(db, who.workspace, saved.job)).toBe(true)
    expect(await cancelJob(db, who.workspace, saved.job)).toBe(false)
    expect(await readJob(db, who.workspace, saved.job)).toMatchObject({ state: 'cancelled' })
    expect(await left(db, who.workspace)).toBe(10n * RUPEE)
    const rows = await db.select().from(aiLedger).where(eq(aiLedger.jobId, saved.job))
    expect(rows.map((r) => r.kind)).toEqual(['hold', 'give-back'])
  })
})
