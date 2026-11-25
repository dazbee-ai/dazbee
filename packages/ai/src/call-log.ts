// The call log's writes for each try of an AI call: its row when it starts, its seller's request id, and how
// it ended, failed, unknown or cut off at its ceiling, with what the seller billed.
import { and, eq, sql } from 'drizzle-orm'

import { aiCalls, type Db, newId } from '@dazbee/db'
import type { Usage } from '@dazbee/schema'

import type { AiCall } from './call.ts'
import { priceUsage } from './price-list.ts'
import type { SellerCutOff } from './sellers/seller.ts'

/** The error a try cut off at its ceiling is logged with, which the admin page counts. */
export const CUT_OFF = 'cut off at its ceiling'

/**
 * Takes the earlier try's request over for the new try `row`: the new row keeps its request id, and the earlier
 * row is marked failed, so the one request is logged once. Gives the request id to resume.
 */
export async function resumeTry(db: Db, resume: { row: string; requestId: string }, row: string): Promise<string> {
  await db.transaction(async (tx) => {
    await tx.update(aiCalls).set({ sellerRequestId: resume.requestId }).where(eq(aiCalls.id, row))
    await tx
      .update(aiCalls)
      .set({ state: 'failed', error: 'resumed by a later try', endedAt: new Date() })
      .where(eq(aiCalls.id, resume.row))
  })
  return resume.requestId
}

/** Writes the call-log row of a new try, as running; its id. */
export async function startTry(db: Db, call: AiCall, model: string, seller: string): Promise<string> {
  const id = newId()
  for (let clash = 0; ; clash++) {
    try {
      await db.insert(aiCalls).values({
        id,
        jobId: call.job.id,
        workspaceId: call.job.workspaceId,
        callIndex: call.callIndex,
        try: sql`(select coalesce(max(${aiCalls.try}), 0) + 1 from ${aiCalls} where ${aiCalls.jobId} = ${call.job.id} and ${aiCalls.callIndex} = ${call.callIndex})`,
        attempt: call.attempt,
        step: call.step,
        model,
        seller,
      })
      return id
    } catch (error) {
      // Another run of the job took the same try number at the same moment.
      if (clash >= 2 || !isUniqueViolation(error)) throw error
    }
  }
}

export function isUniqueViolation(error: unknown): boolean {
  const cause = error instanceof Error && 'cause' in error ? error.cause : error
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505'
}

export async function keepRequestId(db: Db, row: string, id: string): Promise<void> {
  await db.update(aiCalls).set({ sellerRequestId: id }).where(eq(aiCalls.id, row))
}

/** Marks a try's row failed or unknown, with why, and the usage the seller reported, if it answered. */
export async function endTry(
  db: Db,
  row: string,
  state: 'failed' | 'unknown',
  error: string,
  usage: Usage | null = null,
): Promise<void> {
  await db
    .update(aiCalls)
    .set({ state, error: error.slice(0, 1000), endedAt: new Date(), ...(usage ? { usage } : {}) })
    .where(and(eq(aiCalls.id, row), eq(aiCalls.state, 'running')))
}

/**
 * Logs a try cut off at its ceiling as failed, with the usage the seller billed and its cost, which is ours:
 * no workspace is charged, and the daily check counts it. A usage that can't be priced is logged unpriced.
 */
export async function endCutOff(
  db: Db,
  row: string,
  seller: string,
  model: string,
  cutOff: SellerCutOff,
): Promise<void> {
  const priced = await priceUsage(db, seller, model, cutOff.usage).catch(() => null)
  await db
    .update(aiCalls)
    .set({
      state: 'failed',
      error: CUT_OFF,
      endedAt: new Date(),
      usage: cutOff.usage,
      sellerRequestId: cutOff.requestId ?? sql`${aiCalls.sellerRequestId}`,
      ...(priced ? { currency: priced.currency, sellerCost: priced.sellerCost, realCost: priced.realCost } : {}),
    })
    .where(and(eq(aiCalls.id, row), eq(aiCalls.state, 'running')))
}

/** Try `row`'s request id, when the seller gave one, as a request to ask about again. */
export async function requestOf(db: Db, row: string): Promise<{ row: string; requestId: string } | null> {
  const [found] = await db.select({ requestId: aiCalls.sellerRequestId }).from(aiCalls).where(eq(aiCalls.id, row))
  return found?.requestId ? { row, requestId: found.requestId } : null
}
