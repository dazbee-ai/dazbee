// The call function against Postgres from Docker Compose and test sellers: each case on a job and model of its own.
import { and, asc, eq } from 'drizzle-orm'
import { describe, expect, it, vi } from 'vitest'

import { aiCalls, aiLedger, aiStepModels } from '@dazbee/db'
import type { CallInput } from '@dazbee/schema'

import { type AiCall, callAi, CallFailed } from './call.ts'
import { endHold, hold, left } from './ledger.ts'
import { openaiSeller } from './sellers/openai.ts'
import { fakeFetch, fixture } from './sellers/test-fetch.ts'
import { testSeller } from './sellers/test-sellers.ts'
import { STEPS } from './seller-route.ts'
import {
  addGrant,
  addJob,
  addStep,
  db,
  memoryFiles,
  newSeller,
  newWorkspace,
  pngOf,
  RUPEE,
  setJob,
  TIERED_PRICES,
} from './test-ai.ts'

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

/** The job's call-log rows, by call index, then oldest try first, as seller, state and error. */
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
    .orderBy(asc(aiCalls.callIndex), asc(aiCalls.try))
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
    // US$0.002 at ₹96.31 with no fee.
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
        realCost: 192_620n,
        chargeCost: 192_620n,
      },
    ])
    expect(await chargesOf(rows[0]?.id ?? '')).toEqual([{ amount: -192_620n }])
  })

  it('charges a fast call at the tier OpenAI says it ran on: at standard rates when it was moved to standard speed', async () => {
    const charged = []
    for (const ranOn of ['default', 'fast']) {
      const answer = { ...JSON.parse(fixture('openai-responses-text.json')), service_tier: ranOn }
      const { fetch, sent } = fakeFetch([['/responses', { body: JSON.stringify(answer) }]])
      const adapter = openaiSeller('test-key', { fetch })
      const { step } = await addStep([{ seller: 'openai', adapter, prices: TIERED_PRICES }])
      await db
        .update(aiStepModels)
        .set({ options: { effort: 'low', tier: 'fast' } })
        .where(eq(aiStepModels.step, step))
      const job = await heldJob()
      await callAi(db, callOf(job, step))
      expect(JSON.parse(String(sent[0]?.body))).toMatchObject({ reasoning: { effort: 'low' }, service_tier: 'fast' })
      const [row] = await db.select().from(aiCalls).where(eq(aiCalls.jobId, job.id))
      charged.push({ usage: row?.usage, charge: (await chargesOf(row?.id ?? '')).map((c) => c.amount) })
    }
    // 69 input and 109 output tokens at US$1 and US$2 a million at the standard tier, twice that at the fast
    // one, at ₹96.31 with no fee.
    expect(charged).toEqual([
      { usage: { 'input-token': 69, 'cached-input-token': 0, 'output-token': 109 }, charge: [-27_641n] },
      {
        usage: { 'fast-input-token': 69, 'fast-cached-input-token': 0, 'fast-output-token': 109 },
        charge: [-55_282n],
      },
    ])
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

  it('gives a step that writes a long answer its own longer time before a try times out', async () => {
    const seller = testSeller(newSeller('a'), [{ afterMs: 400 }], { timeoutMs: 200 })
    const { step } = await addStep([seller])
    const def = STEPS[step]
    if (def) def.timeoutMs = 2_000
    const job = await heldJob()
    await callAi(db, callOf(job, step))
    expect((await callRows(job.id)).map((r) => r.state)).toEqual(['done'])
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

  it('counts every step of one model at one seller under one pacing limit', async () => {
    const seller = testSeller(newSeller('a'))
    seller.perMinute = { text: 1 }
    const { step, model } = await addStep([seller])
    // A second step running the same model.
    const other = `${step}-other`
    STEPS[other] = { kind: 'text', expected: () => ({ 'input-token': 1000, 'output-token': 500 }) }
    await db.insert(aiStepModels).values({ step: other, model })
    const job = await heldJob()
    await callAi(db, callOf(job, step))
    const controller = new AbortController()
    setTimeout(() => controller.abort(new Error('cancelled')), 50)
    await expect(callAi(db, callOf(job, other, { callIndex: 1, signal: controller.signal }))).rejects.toThrow(
      'cancelled',
    )
    expect(seller.requests).toHaveLength(1)
  })

  it('gives a picture adapter its references, with the first one’s marked copy last, read once before any try', async () => {
    const seller = testSeller(newSeller('a'), [{ fail: 503 }])
    const { step } = await addStep([seller], { kind: 'picture' })
    const files = memoryFiles()
    files.saved.set('test/product', await pngOf(16, 16, [255, 0, 0, 255]))
    files.saved.set('test/logo', await pngOf(8, 8, [0, 255, 0, 255]))
    files.saved.set('test/marks', await pngOf(16, 16, [0, 0, 255, 255], { quarter: true }))
    const read = vi.spyOn(files, 'read')
    const input: CallInput = {
      kind: 'picture',
      prompt: 'Put the logo on the cup.',
      pictures: ['test/product', 'test/logo'],
      marks: 'test/marks',
      width: 1024,
      height: 1024,
    }
    await callAi(db, callOf(await heldJob(), step, { input, files }))
    expect(seller.requests).toHaveLength(2)
    const [first, second] = await Promise.all(seller.requests.map((request) => request.references()))
    expect(first).toHaveLength(3)
    expect(first?.slice(0, 2)).toEqual([files.saved.get('test/product'), files.saved.get('test/logo')])
    expect(first?.[2]).not.toEqual(files.saved.get('test/product'))
    expect(second).toBe(first)
    expect(read).toHaveBeenCalledTimes(3)
  })

  it('fails a call whose reference pictures can’t be read before any seller is tried', async () => {
    const seller = testSeller(newSeller('a'))
    const { step } = await addStep([seller], { kind: 'picture' })
    const files = memoryFiles()
    files.read = () => Promise.reject(new Error('storage is down'))
    const input: CallInput = { kind: 'picture', prompt: 'A cup.', pictures: ['test/x'], width: 1024, height: 1024 }
    const job = await heldJob()
    await expect(callAi(db, callOf(job, step, { input, files }))).rejects.toThrow('storage is down')
    expect(seller.requests).toHaveLength(0)
    expect(await callRows(job.id)).toEqual([])
  })

  it('sends a text call with its step’s ceiling as its output limit, or its own limit when smaller', async () => {
    const seller = testSeller(newSeller('a'))
    const { step } = await addStep([seller])
    const def = STEPS[step]
    if (def) def.sizes = { input: 1000, output: 500, ceiling: 2000 }
    const job = await heldJob()
    await callAi(db, callOf(job, step))
    await callAi(db, callOf(job, step, { callIndex: 1, input: { ...TEXT, maxOutputTokens: 900 } }))
    await callAi(db, callOf(job, step, { callIndex: 2, input: { ...TEXT, maxOutputTokens: 9000 } }))
    expect(seller.requests.map((r) => (r.input.kind === 'text' ? r.input.maxOutputTokens : null))).toEqual([
      2000, 900, 2000,
    ])
  })

  it('logs an answer cut off at its ceiling as our cost, charges nothing and tries no other seller', async () => {
    const first = testSeller(newSeller('a'), [{ cutOff: { 'input-token': 1000, 'output-token': 500 } }])
    const second = testSeller(newSeller('b'))
    const { step } = await addStep([first, second])
    const job = await heldJob()
    const failed = await callAi(db, callOf(job, step)).catch((e: unknown) => e)
    expect(failed).toBeInstanceOf(CallFailed)
    expect((failed as CallFailed).reason).toBe('cut-off')
    expect(first.requests).toHaveLength(1)
    expect(second.requests).toHaveLength(0)
    const rows = await db.select().from(aiCalls).where(eq(aiCalls.jobId, job.id))
    // US$0.002 at ₹96.31, as a done call of the same usage costs.
    expect(rows).toMatchObject([
      {
        seller: first.seller,
        state: 'failed',
        error: 'cut off at its ceiling',
        usage: { 'input-token': 1000, 'output-token': 500 },
        sellerCost: 2_000n,
        realCost: 192_620n,
        chargeCost: null,
        chargedAt: null,
      },
    ])
    expect(await chargesOf(rows[0]?.id ?? '')).toEqual([])
  })

  it('skips a seller with no price for a unit it reports before sending it anything', async () => {
    const unpriced = testSeller('pixazo')
    const priced = testSeller(newSeller('b'))
    const { step } = await addStep(
      [{ seller: 'pixazo', adapter: unpriced, prices: [{ unit: 'picture', pricePerMillion: 1_000_000n }] }, priced],
      { kind: 'picture' },
    )
    const input: CallInput = { kind: 'picture', prompt: 'A cup.', pictures: [], width: 1024, height: 1024 }
    const job = await heldJob()
    await callAi(db, callOf(job, step, { input, files: memoryFiles() }))
    expect(unpriced.requests).toHaveLength(0)
    expect(priced.requests).toHaveLength(1)
    expect((await callRows(job.id)).map((r) => r.seller)).toEqual([priced.seller])
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
