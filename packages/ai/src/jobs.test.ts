// Saving an AI job with its hold, against Postgres from Docker Compose and a real pg-boss.
import { eq } from 'drizzle-orm'
import { PgBoss } from 'pg-boss'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { aiCalls, aiJobs, aiLedger, memberships, newId, users, workspaces } from '@dazbee/db'
import type { AiStepsInput, MemberRole } from '@dazbee/schema'

import { cancelJob, ensureQueue, readJob, saveJob } from './jobs.ts'
import { giveGrant, left } from './ledger.ts'
import { testSeller } from './sellers/test-sellers.ts'
import { aiSettingsOf } from './settings.ts'
import { addStep, db, newSeller, RUPEE } from './test-ai.ts'
import { DATABASE_URL } from './test-database.ts'

const boss = new PgBoss({ connectionString: DATABASE_URL, max: 2, supervise: false, schedule: false })
const queue = `ai-steps-${newId()}`
let input: AiStepsInput

beforeAll(async () => {
  await boss.start()
  await ensureQueue(boss, queue)
  const { step } = await addStep([testSeller(newSeller('a'))])
  input = { calls: [{ step, input: { kind: 'text', instructions: 'Read.', prompt: 'An ad.', pictures: [] } }] }
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
  db.transaction((tx) => saveJob(tx, boss, { ...who, kind: 'ai-steps', input, queue: to }))

describe('saveJob', () => {
  it('saves the job, its hold and its pg-boss job together', async () => {
    const who = await memberOf('editor')
    const saved = await save(who)
    if (!saved.ok) throw new Error(saved.refusal)
    const [job] = await db.select().from(aiJobs).where(eq(aiJobs.id, saved.job))
    expect(job).toMatchObject({ state: 'waiting', attempt: 0, workspaceId: who.workspace })
    expect(await boss.findJobs(queue, { id: job?.queueJobId ?? '' })).toHaveLength(1)
    expect(await left(db, who.workspace)).toBeLessThan(10n * RUPEE)
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
        saveJob(tx, boss, { ...who, kind: 'ai-steps', input: { calls: [{ step: 'refine', input: call }] }, queue }),
      )
      await expect(saving).rejects.toThrow()
    }
    expect(await left(db, who.workspace)).toBe(10n * RUPEE)
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
          step: 'read',
          model: 'test',
          seller: 'test',
          state: 'done',
          realCost: spendingStop,
        })
        const result = await saveJob(tx, boss, { ...who, kind: 'ai-steps', input, queue })
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
