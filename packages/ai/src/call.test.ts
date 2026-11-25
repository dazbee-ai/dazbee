// The call function against Postgres from Docker Compose and test sellers: each case on a job and model of its own.
import { and, asc, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { aiCalls, aiLedger } from '@dazbee/db'
import type { CallInput } from '@dazbee/schema'

import { type AiCall, callAi, CallFailed } from './call.ts'
import { endHold, hold, left } from './ledger.ts'
import { testSeller } from './sellers/test-sellers.ts'
import { addGrant, addJob, addStep, db, newSeller, newWorkspace, RUPEE, setJob } from './test-ai.ts'

const TEXT: CallInput = { kind: 'text', instructions: 'Plan the round.', prompt: 'A coffee ad.', pictures: [] }

/** A workspace with ₹100 and a running job holding ₹10 on it. */
async function heldJob() {
  const workspace = newWorkspace()
  await addGrant(workspace, 100n * RUPEE)
  const id = await addJob(workspace)
  await db.transaction((tx) => hold(tx, { workspace, job: id, cost: 10n * RUPEE }))
  return { id, workspaceId: workspace }
}

function callOf(job: { id: string; workspaceId: string }, step: string, more: Partial<AiCall> = {}): AiCall {
  return { job, attempt: 1, callIndex: 0, step, input: TEXT, signal: new AbortController().signal, ...more }
}

/** The job's call-log rows, oldest try first, as seller, state and error. */
async function callRows(job: string) {
  return db
    .select({
      id: aiCalls.id,
      seller: aiCalls.seller,
      state: aiCalls.state,
      error: aiCalls.error,
      realCost: aiCalls.realCost,
    })
    .from(aiCalls)
    .where(eq(aiCalls.jobId, job))
    .orderBy(asc(aiCalls.try))
}

/** The charge rows of call-log row `call`. */
function chargesOf(call: string) {
  return db
    .select({ amount: aiLedger.amount })
    .from(aiLedger)
    .where(and(eq(aiLedger.callId, call), eq(aiLedger.kind, 'charge')))
}

describe('callAi', () => {
  it('logs a done call once, at its real cost, and charges it once', async () => {
    const seller = testSeller(newSeller('a'), [
      { usage: { 'input-token': 1000, 'output-token': 500 }, requestId: 'req-1' },
    ])
    const { step, model } = await addStep([seller])
    const job = await heldJob()
    const output = await callAi(db, callOf(job, step))
    expect(output).toEqual({ kind: 'text', text: 'test answer' })
    const rows = await db.select().from(aiCalls).where(eq(aiCalls.jobId, job.id))
    // US$0.002 at ₹96.1722 with no fee.
    expect(rows).toMatchObject([
      {
        step,
        model,
        seller: seller.seller,
        state: 'done',
        sellerRequestId: 'req-1',
        usage: { 'input-token': 1000, 'output-token': 500 },
        currency: 'USD',
        sellerCost: 2_000n,
        realCost: 192_344n,
        chargeCost: 192_344n,
      },
    ])
    expect(await chargesOf(rows[0]?.id ?? '')).toEqual([{ amount: -192_344n }])
  })

  it('tries a seller that fails with a 5xx once more, then the next seller, and charges only the call made', async () => {
    const first = testSeller(newSeller('a'), [{ fail: 503 }, { fail: 500 }])
    const second = testSeller(newSeller('b'))
    const { step } = await addStep([first, second])
    const job = await heldJob()
    await callAi(db, callOf(job, step))
    const rows = await callRows(job.id)
    expect(rows.map((r) => [r.seller, r.state])).toEqual([
      [first.seller, 'failed'],
      [first.seller, 'failed'],
      [second.seller, 'done'],
    ])
    expect(await chargesOf(rows[0]?.id ?? '')).toEqual([])
    expect(await chargesOf(rows[2]?.id ?? '')).toHaveLength(1)
  })

  it('goes to the next seller at once when a seller is out of money', async () => {
    const broke = testSeller(newSeller('a'), [{ fail: 429, code: 'insufficient_quota' }])
    const unpaid = testSeller(newSeller('b'), [{ fail: 402 }])
    const paid = testSeller(newSeller('c'))
    const { step } = await addStep([broke, unpaid, paid])
    const job = await heldJob()
    await callAi(db, callOf(job, step))
    expect((await callRows(job.id)).map((r) => [r.seller, r.state, r.error?.slice(0, 12) ?? null])).toEqual([
      [broke.seller, 'failed', 'out of money'],
      [unpaid.seller, 'failed', 'out of money'],
      [paid.seller, 'done', null],
    ])
  })

  it('fails a call a seller refuses with a 400, with no next seller', async () => {
    const refusing = testSeller(newSeller('a'), [{ fail: 400 }])
    const next = testSeller(newSeller('b'))
    const { step } = await addStep([refusing, next])
    const job = await heldJob()
    await expect(callAi(db, callOf(job, step))).rejects.toMatchObject({ reason: 'refused' })
    expect(next.requests).toHaveLength(0)
    expect((await callRows(job.id)).map((r) => r.state)).toEqual(['failed'])
  })

  it('fails a call no seller made', async () => {
    const seller = testSeller(newSeller('a'), [{ fail: 500 }, { fail: 500 }])
    const { step } = await addStep([seller])
    const job = await heldJob()
    await expect(callAi(db, callOf(job, step))).rejects.toBeInstanceOf(CallFailed)
  })

  it('logs a try that timed out as unknown and tries again', async () => {
    const seller = testSeller(newSeller('a'), [{ timeOut: true }])
    const { step } = await addStep([seller])
    const job = await heldJob()
    await callAi(db, callOf(job, step))
    expect((await callRows(job.id)).map((r) => [r.state, r.error])).toEqual([
      ['unknown', 'timed out'],
      ['done', null],
    ])
  })

  it('skips a seller with no price for the model, or no adapter', async () => {
    const unpriced = testSeller(newSeller('a'))
    const priced = testSeller(newSeller('b'))
    const { step } = await addStep([
      { seller: unpriced.seller, adapter: unpriced, prices: [] },
      { seller: newSeller('gone') },
      priced,
    ])
    const job = await heldJob()
    await callAi(db, callOf(job, step))
    expect(unpriced.requests).toHaveLength(0)
    expect((await callRows(job.id)).map((r) => r.seller)).toEqual([priced.seller])
  })

  it('tries only the sellers it is told to, in that order', async () => {
    const first = testSeller(newSeller('a'))
    const second = testSeller(newSeller('b'))
    const { step } = await addStep([first, second])
    const job = await heldJob()
    await callAi(db, callOf(job, step, { sellers: [second.seller] }))
    expect(first.requests).toHaveLength(0)
    expect(second.requests).toHaveLength(1)
  })

  it('charges nothing for a job no longer running on the call’s attempt', async () => {
    const seller = testSeller(newSeller('a'))
    const { step } = await addStep([seller])
    const moved = await heldJob()
    await setJob(moved.id, { attempt: 2 })
    const cancelled = await heldJob()
    await setJob(cancelled.id, { state: 'cancelled' })
    for (const job of [moved, cancelled]) {
      await callAi(db, callOf(job, step))
      const [row] = await callRows(job.id)
      expect(row?.state).toBe('done')
      expect(await chargesOf(row?.id ?? '')).toEqual([])
    }
  })

  it('has the unique charge index refuse a second charge for one call', async () => {
    const seller = testSeller(newSeller('a'))
    const { step } = await addStep([seller])
    const job = await heldJob()
    await callAi(db, callOf(job, step))
    const [row] = await db
      .select()
      .from(aiLedger)
      .where(and(eq(aiLedger.jobId, job.id), eq(aiLedger.kind, 'charge')))
    const again = {
      grantId: row?.grantId ?? '',
      jobId: job.id,
      callId: row?.callId ?? '',
      kind: 'charge' as const,
      amount: -1n,
    }
    await expect(db.insert(aiLedger).values(again)).rejects.toThrow()
  })

  it('logs an aborted call as unknown and charges no workspace', async () => {
    const seller = testSeller(newSeller('a'), [{ timeOut: true }])
    const { step } = await addStep([seller])
    const job = await heldJob()
    const controller = new AbortController()
    setTimeout(() => controller.abort(new Error('cancelled')), 50)
    await expect(callAi(db, callOf(job, step, { signal: controller.signal }))).rejects.toThrow('cancelled')
    const rows = await callRows(job.id)
    expect(rows.map((r) => [r.state, r.error])).toEqual([['unknown', 'aborted']])
    await db.transaction((tx) => endHold(tx, { workspace: job.workspaceId, job: job.id }))
    expect(await left(db, job.workspaceId)).toBe(100n * RUPEE)
  })

  it('marks a call it can’t price unknown, keeping the usage, and fails it for good', async () => {
    const seller = testSeller(newSeller('a'), [{ usage: { 'cached-input-token': 100 } }])
    const { step } = await addStep([seller])
    const job = await heldJob()
    await expect(callAi(db, callOf(job, step))).rejects.toMatchObject({ reason: 'lost' })
    const [row] = await db.select().from(aiCalls).where(eq(aiCalls.jobId, job.id))
    expect(row).toMatchObject({ state: 'unknown', usage: { 'cached-input-token': 100 } })
    expect(row?.error).toMatch(/^not kept: .*cached-input-token/)
  })

  it('logs a call aborted while it waits its turn as failed, since it was never sent', async () => {
    const seller = testSeller(newSeller('a'))
    seller.perMinute = { text: 1 }
    const { step } = await addStep([seller])
    const job = await heldJob()
    await callAi(db, callOf(job, step))
    const controller = new AbortController()
    setTimeout(() => controller.abort(new Error('cancelled')), 50)
    await expect(callAi(db, callOf(job, step, { callIndex: 1, signal: controller.signal }))).rejects.toThrow(
      'cancelled',
    )
    expect((await callRows(job.id)).map((r) => [r.state, r.error])).toEqual([
      ['done', null],
      ['failed', 'aborted before it was sent'],
    ])
  })

  it('gives a done call’s output again without calling the seller', async () => {
    const seller = testSeller(newSeller('a'))
    const { step } = await addStep([seller])
    const job = await heldJob()
    const first = await callAi(db, callOf(job, step))
    expect(await callAi(db, callOf(job, step))).toEqual(first)
    expect(seller.requests).toHaveLength(1)
    const [row] = await callRows(job.id)
    expect(await chargesOf(row?.id ?? '')).toHaveLength(1)
  })

  it('never charges a second try of one AI call, even one done later by an earlier run', async () => {
    const seller = testSeller(newSeller('a'))
    const { step, model } = await addStep([seller])
    const job = await heldJob()
    await callAi(db, callOf(job, step))
    // An earlier run's try of the same call, done after the charged one.
    const late = { id: `${job.id}-late`, jobId: job.id, workspaceId: job.workspaceId, callIndex: 0, try: 9, attempt: 0 }
    await db.insert(aiCalls).values({ ...late, step, model, seller: seller.seller, state: 'done', chargeCost: 5n })
    await setJob(job.id, { attempt: 2 })
    await callAi(db, callOf(job, step, { attempt: 2 }))
    const charged = await db.select({ id: aiLedger.callId }).from(aiLedger).where(eq(aiLedger.jobId, job.id))
    expect(charged.map((r) => r.id).filter((id) => id === late.id)).toEqual([])
    await expect(db.update(aiCalls).set({ chargedAt: new Date() }).where(eq(aiCalls.id, late.id))).rejects.toThrow()
  })

  it('asks a resumable seller about an earlier attempt’s call by its request id instead of calling again', async () => {
    const seller = testSeller(newSeller('a'), [], { resumable: true })
    const { step, model } = await addStep([seller])
    const job = await heldJob()
    await setJob(job.id, { attempt: 2 })
    const earlier = { id: `${job.id}-earlier`, jobId: job.id, workspaceId: job.workspaceId, callIndex: 0, try: 1 }
    await db.insert(aiCalls).values({
      ...earlier,
      attempt: 1,
      step,
      model,
      seller: seller.seller,
      state: 'unknown',
      sellerRequestId: 'req-x',
    })
    await callAi(db, callOf(job, step, { attempt: 2 }))
    expect(seller.requests.map((r) => r.resumeId)).toEqual(['req-x'])
    const rows = await db
      .select({ state: aiCalls.state, error: aiCalls.error })
      .from(aiCalls)
      .where(eq(aiCalls.jobId, job.id))
      .orderBy(asc(aiCalls.try))
    expect(rows).toEqual([
      { state: 'failed', error: 'resumed by a later try' },
      { state: 'done', error: null },
    ])
  })

  it('asks a resumable seller about a timed-out try’s request on the next try, instead of sending it again', async () => {
    const seller = testSeller(newSeller('a'), [{ timeOut: true, requestId: 'req-slow' }], { resumable: true })
    const { step } = await addStep([seller])
    const job = await heldJob()
    await callAi(db, callOf(job, step))
    expect(seller.requests.map((r) => r.resumeId)).toEqual([undefined, 'req-slow'])
    expect((await callRows(job.id)).map((r) => [r.state, r.error])).toEqual([
      ['failed', 'resumed by a later try'],
      ['done', null],
    ])
  })

  it('logs one request once when a later attempt takes it over while the earlier one still waits on it', async () => {
    const seller = testSeller(newSeller('a'), [{ afterMs: 400 }, { afterMs: 0 }], { resumable: true, timeoutMs: 5_000 })
    const { step } = await addStep([seller])
    const job = await heldJob()
    const earlier = callAi(db, callOf(job, step))
    await vi.waitFor(async () => expect(await callRows(job.id)).toHaveLength(1))
    await db.update(aiCalls).set({ sellerRequestId: 'req-shared' }).where(eq(aiCalls.jobId, job.id))
    await setJob(job.id, { attempt: 2 })
    await callAi(db, callOf(job, step, { attempt: 2 }))
    await earlier
    expect((await callRows(job.id)).map((r) => [r.state, r.error])).toEqual([
      ['failed', 'resumed by a later try'],
      ['done', null],
    ])
  })

  it('sends a request again when the seller refuses to answer about an earlier attempt’s', async () => {
    const seller = testSeller(newSeller('a'), [{ fail: 404 }], { resumable: true })
    const { step, model } = await addStep([seller])
    const job = await heldJob()
    await setJob(job.id, { attempt: 2 })
    const earlier = { id: `${job.id}-earlier`, jobId: job.id, workspaceId: job.workspaceId, callIndex: 0, try: 1 }
    await db.insert(aiCalls).values({
      ...earlier,
      attempt: 1,
      step,
      model,
      seller: seller.seller,
      state: 'unknown',
      sellerRequestId: 'req-gone',
    })
    await callAi(db, callOf(job, step, { attempt: 2 }))
    expect(seller.requests.map((r) => r.resumeId)).toEqual(['req-gone', undefined])
  })

  it('charges a call an earlier run made but could not charge, once, on the run that reuses it', async () => {
    const seller = testSeller(newSeller('a'))
    const { step } = await addStep([seller])
    const job = await heldJob()
    await setJob(job.id, { attempt: 2 })
    await callAi(db, callOf(job, step, { attempt: 1 }))
    const [row] = await callRows(job.id)
    expect(await chargesOf(row?.id ?? '')).toEqual([])
    await callAi(db, callOf(job, step, { attempt: 2 }))
    await callAi(db, callOf(job, step, { attempt: 2 }))
    expect(seller.requests).toHaveLength(1)
    expect(await chargesOf(row?.id ?? '')).toHaveLength(1)
  })
})
