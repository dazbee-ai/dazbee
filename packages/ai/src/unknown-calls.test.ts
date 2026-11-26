// Settling unknown calls, against Postgres from Docker Compose and Pixazo's recorded statuses: the case's calls
// are on a day of their own, long past, so no other call is settled.
import { eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { aiCalls, aiJobs, newId } from '@dazbee/db'

import { pixazoSeller } from './sellers/pixazo.ts'
import { useSeller } from './sellers/seller.ts'
import { fakeFetch, fixture } from './sellers/test-fetch.ts'
import { db, newWorkspace } from './test-ai.ts'
import { settleUnknownCalls } from './unknown-calls.ts'

/** The day the case's calls were made, and the next day, when they are settled. */
const DAY = new Date('2001-01-01T10:00:00Z')
const NEXT_DAY = new Date('2001-01-02T00:00:00Z')

describe('settleUnknownCalls', () => {
  it('settles Pixazo’s unknown calls from their status by request id, and keeps Meta’s as our cost', async () => {
    const run = newId()
    const done = `seedream-5-5_done-${run}`
    const failed = `seedream-5-5_failed-${run}`
    const { fetch } = fakeFetch([
      [done, { body: fixture('pixazo-status-completed.json') }],
      [failed, { body: JSON.stringify({ request_id: failed, status: 'ERROR', error: 'upstream', output: null }) }],
    ])
    useSeller(pixazoSeller('test-key', { fetch }))
    const workspace = newWorkspace()
    const job = newId()
    const edit = { kind: 'picture', prompt: 'Make it square.', pictures: ['k'], width: 1024, height: 1024 }
    await db.insert(aiJobs).values({
      id: job,
      workspaceId: workspace,
      memberId: 'member',
      kind: 'calls',
      state: 'done',
      input: {
        calls: [
          { function: 'refine-edit', preset: 'seedream', input: edit },
          { function: 'refine-edit', preset: 'seedream', input: edit },
          { function: 'draft', preset: 'gpt-image-medium', input: edit },
        ],
      },
    })
    const row = (callIndex: number, seller: string, model: string, requestId: string) => ({
      id: `${job}-${callIndex}`,
      jobId: job,
      workspaceId: workspace,
      callIndex,
      try: 1,
      attempt: 1,
      function: 'refine-edit',
      preset: 'seedream',
      model,
      seller,
      state: 'unknown' as const,
      sellerRequestId: requestId,
      startedAt: DAY,
    })
    await db
      .insert(aiCalls)
      .values([
        row(0, 'pixazo', 'seedream-5.5', done),
        row(1, 'pixazo', 'seedream-5.5', failed),
        row(2, 'meta', 'muse-image-1.0', `meta-${run}`),
      ])
    expect(await settleUnknownCalls(db, NEXT_DAY)).toEqual({ done: 1, failed: 1, waiting: 0 })
    const rows = await db
      .select({
        callIndex: aiCalls.callIndex,
        state: aiCalls.state,
        usage: aiCalls.usage,
        sellerCost: aiCalls.sellerCost,
      })
      .from(aiCalls)
      .where(inArray(aiCalls.jobId, [job]))
      .orderBy(aiCalls.callIndex)
    expect(rows).toEqual([
      { callIndex: 0, state: 'done', usage: { picture: 1, 'reference-picture': 1 }, sellerCost: 28_000n },
      { callIndex: 1, state: 'failed', usage: null, sellerCost: null },
      { callIndex: 2, state: 'unknown', usage: null, sellerCost: null },
    ])
    const [settled] = await db
      .select()
      .from(aiCalls)
      .where(eq(aiCalls.id, `${job}-0`))
    expect(settled?.chargedAt).toBeNull()
  })
})
