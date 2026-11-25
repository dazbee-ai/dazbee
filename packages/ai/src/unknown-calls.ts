// Settles unknown calls: each day, every unknown call of a seller that answers about a request by its id is
// asked about, and marked done at the cost the seller charged (our cost: no workspace is charged) or failed.
// A seller with no such answer (Meta) keeps its unknown calls, which count as our cost.
import { and, eq, gte, inArray, isNotNull, lt } from 'drizzle-orm'

import { aiCalls, aiJobs, type Db } from '@dazbee/db'
import { AiStepsInput } from '@dazbee/schema'

import { priceUsage } from './price-list.ts'
import { sellerAdapter } from './sellers/seller.ts'

/** How many unknown calls were settled done or failed, and how many are still waiting on their seller. */
export interface Settled {
  done: number
  failed: number
  waiting: number
}

/** A day, in milliseconds. */
const DAY_MS = 86_400_000

/** Settles the unknown calls started on the day before `before` (by default today, 00:00 UTC). */
export async function settleUnknownCalls(db: Db, before: Date = startOfUtcDay()): Promise<Settled> {
  const rows = await db
    .select({
      id: aiCalls.id,
      jobId: aiCalls.jobId,
      callIndex: aiCalls.callIndex,
      seller: aiCalls.seller,
      model: aiCalls.model,
      requestId: aiCalls.sellerRequestId,
    })
    .from(aiCalls)
    .where(
      and(
        eq(aiCalls.state, 'unknown'),
        isNotNull(aiCalls.sellerRequestId),
        gte(aiCalls.startedAt, new Date(before.getTime() - DAY_MS)),
        lt(aiCalls.startedAt, before),
      ),
    )
  const settled: Settled = { done: 0, failed: 0, waiting: 0 }
  const inputs = await jobInputs(db, [...new Set(rows.map((row) => row.jobId))])
  for (const row of rows) {
    const adapter = sellerAdapter(row.seller)
    const input = inputs.get(row.jobId)?.calls[row.callIndex]?.input
    if (!adapter?.status || !row.requestId || !input) continue
    const status = await adapter.status(row.requestId, input)
    if (status.state === 'pending') {
      settled.waiting++
      continue
    }
    if (status.state === 'failed') {
      await db
        .update(aiCalls)
        .set({ state: 'failed', error: 'settled: the seller made nothing' })
        .where(eq(aiCalls.id, row.id))
      settled.failed++
      continue
    }
    const priced = await priceUsage(db, row.seller, row.model, status.usage)
    await db
      .update(aiCalls)
      .set({
        state: 'done',
        usage: status.usage,
        currency: priced.currency,
        sellerCost: priced.sellerCost,
        realCost: priced.realCost,
        error: 'settled: made after it was given up, our cost',
      })
      .where(eq(aiCalls.id, row.id))
    settled.done++
  }
  return settled
}

/** The inputs of `jobs`, by job id. */
async function jobInputs(db: Db, jobs: string[]): Promise<Map<string, AiStepsInput>> {
  if (jobs.length === 0) return new Map()
  const rows = await db.select({ id: aiJobs.id, input: aiJobs.input }).from(aiJobs).where(inArray(aiJobs.id, jobs))
  return new Map(
    rows.flatMap((row) => {
      const parsed = AiStepsInput.safeParse(row.input)
      return parsed.success ? [[row.id, parsed.data] as const] : []
    }),
  )
}

function startOfUtcDay(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}
