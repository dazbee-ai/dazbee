// What a preset's own calls measured: the cost and the seconds its hold and its wait are worked out from.
import { and, desc, eq, isNotNull, isNull, not, or, sql } from 'drizzle-orm'

import { aiCalls, type Db, type Tx } from '@dazbee/db'
import type { AiFunction } from '@dazbee/schema'

import type { Preset } from './functions/types.ts'

/** A preset's cost in millionths of a rupee of real cost, its seconds, and how many done calls they come from. */
export interface PresetNumbers {
  cost: bigint
  seconds: number
  /** The preset's done calls counted, at most `LATEST`; with none, the cost and seconds are its first guess. */
  calls: number
}

/** How many of a preset's latest done calls are counted. */
const LATEST = 200

/** From how many done calls on the 95th percentile is taken, in place of the highest seen. */
const ENOUGH = 20

/** The request id of a call answered from an AI recording starts with this; such a call was made by no seller. */
const REPLAYED = 'replayed:'

/**
 * The cost and seconds of one call of `preset`: its first guess while it has no done call; the highest of its
 * done calls while it has fewer than 20; from then on the 95th percentile of its latest 200. Calls that failed
 * or were cut off are not done, and a replayed call is left out. The cost is what the calls really cost us: a
 * function with a fixed charge is held at that charge, not at this cost. One number stands for every call of the
 * preset, since a picture call asks for about a megapixel whatever its frame's size.
 */
export async function presetNumbers(db: Db | Tx, fn: AiFunction, name: string, preset: Preset): Promise<PresetNumbers> {
  const rows = await db
    .select({
      cost: aiCalls.realCost,
      seconds: sql<number>`extract(epoch from ${aiCalls.endedAt} - ${aiCalls.startedAt})::float8`,
    })
    .from(aiCalls)
    .where(
      and(
        eq(aiCalls.function, fn),
        eq(aiCalls.preset, name),
        eq(aiCalls.state, 'done'),
        isNotNull(aiCalls.realCost),
        isNotNull(aiCalls.endedAt),
        or(isNull(aiCalls.sellerRequestId), not(sql`starts_with(${aiCalls.sellerRequestId}, ${REPLAYED})`)),
      ),
    )
    .orderBy(desc(aiCalls.endedAt))
    .limit(LATEST)
  if (rows.length === 0) return { ...preset.guess, calls: 0 }
  const costs = rows.map((row) => row.cost ?? 0n).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const seconds = rows.map((row) => Number(row.seconds)).sort((a, b) => a - b)
  return { cost: taken(costs) ?? 0n, seconds: Math.ceil(taken(seconds) ?? 0), calls: rows.length }
}

/** Of `sorted`, lowest first: the highest while there are fewer than `ENOUGH`, then the 95th percentile. */
function taken<T>(sorted: T[]): T | undefined {
  const at = sorted.length < ENOUGH ? sorted.length - 1 : Math.ceil(sorted.length * 0.95) - 1
  return sorted[at]
}
