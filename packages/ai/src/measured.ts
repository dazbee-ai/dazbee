// What a preset's own calls measured: the cost and the seconds its hold and its wait are worked out from, and how
// many of its calls were done, cut off and failed, as the admin page shows them beside each other.
import { and, desc, eq, inArray, isNotNull, isNull, not, or, sql } from 'drizzle-orm'

import { aiCalls, type Db, type Tx } from '@dazbee/db'
import { SELLERS } from '@dazbee/schema'

import { CUT_OFF, RESUMED } from './call-log.ts'
import type { Preset } from './functions/types.ts'

/** A preset's cost in millionths of a rupee of real cost, its seconds, and how many done calls they come from. */
export interface PresetNumbers {
  cost: bigint
  seconds: number
  /** The preset's done calls counted, at most `LATEST`; with none, the cost and seconds are its first guess. */
  calls: number
}

/** A preset's numbers with every call our sellers made of it counted: its done calls, its cut-offs and its failures. */
export interface PresetMeasured extends PresetNumbers {
  /** Every done call of the preset, of which `calls` counts the latest. */
  done: number
  /** Its tries cut off at their ceiling. */
  cutOffs: number
  /** Its tries that failed any other way, a try whose request a later try took over left out. */
  failures: number
}

/** How many of a preset's latest done calls are counted. */
const LATEST = 200

/** From how many done calls on the 95th percentile is taken, in place of the highest seen. */
const ENOUGH = 20

/** The request id of a call answered from an AI recording starts with this; such a call was made by no seller. */
const REPLAYED = 'replayed:'

/** A done call as the numbers count it: ended, with its real cost. */
const DONE = and(eq(aiCalls.state, 'done'), isNotNull(aiCalls.realCost), isNotNull(aiCalls.endedAt))

/**
 * The cost and seconds of one call of `preset`: its first guess while it has no done call; the highest of its
 * done calls while it has fewer than 20; from then on the 95th percentile of its latest 200. Calls that failed
 * or were cut off are not done, and only a call one of our sellers made counts: a replayed call is left out, and
 * so is one made by a seller that is none of ours, as a test's is. The cost is what the calls really cost us: a
 * function with a fixed charge is held at that charge, not at this cost. One number stands for every call of the
 * preset, since a picture call asks for about a megapixel whatever its frame's size.
 */
export async function presetNumbers(db: Db | Tx, fn: string, name: string, preset: Preset): Promise<PresetNumbers> {
  const rows = await db
    .select({
      cost: aiCalls.realCost,
      seconds: sql<number>`extract(epoch from ${aiCalls.endedAt} - ${aiCalls.startedAt})::float8`,
    })
    .from(aiCalls)
    .where(and(madeByOurs(fn, name), DONE))
    .orderBy(desc(aiCalls.endedAt))
    .limit(LATEST)
  if (rows.length === 0) return { ...preset.guess, calls: 0 }
  const costs = rows.map((row) => row.cost ?? 0n).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  const seconds = rows.map((row) => Number(row.seconds)).sort((a, b) => a - b)
  return { cost: taken(costs) ?? 0n, seconds: Math.ceil(taken(seconds) ?? 0), calls: rows.length }
}

/**
 * What `preset`'s calls measured, for the admin page: the cost and seconds `presetNumbers` gives its hold and its
 * wait, with how many of its calls were done, how many of its tries were cut off at their ceiling, and how many
 * failed any other way. A try whose request a later try took over is no failure: its one request went on under
 * the later try. The same calls count as there: those our sellers made, with no replayed call.
 */
export async function presetMeasured(db: Db | Tx, fn: string, name: string, preset: Preset): Promise<PresetMeasured> {
  const numbers = await presetNumbers(db, fn, name, preset)
  const failed = sql`${aiCalls.state} = 'failed'`
  const otherwise = sql`${aiCalls.error} is null or ${aiCalls.error} not in (${CUT_OFF}, ${RESUMED})`
  const [counts] = await db
    .select({
      done: sql<number>`(count(*) filter (where ${DONE}))::int`,
      cutOffs: sql<number>`(count(*) filter (where ${failed} and ${aiCalls.error} = ${CUT_OFF}))::int`,
      failures: sql<number>`(count(*) filter (where ${failed} and (${otherwise})))::int`,
    })
    .from(aiCalls)
    .where(madeByOurs(fn, name))
  return { ...numbers, done: counts?.done ?? 0, cutOffs: counts?.cutOffs ?? 0, failures: counts?.failures ?? 0 }
}

/** The tries of `fn`'s preset `name` that one of our sellers made: none replayed from an AI recording. */
function madeByOurs(fn: string, name: string) {
  return and(
    eq(aiCalls.function, fn),
    eq(aiCalls.preset, name),
    inArray(aiCalls.seller, [...SELLERS]),
    or(isNull(aiCalls.sellerRequestId), not(sql`starts_with(${aiCalls.sellerRequestId}, ${REPLAYED})`)),
  )
}

/** Of `sorted`, lowest first: the highest while there are fewer than `ENOUGH`, then the 95th percentile. */
function taken<T>(sorted: T[]): T | undefined {
  const at = sorted.length < ENOUGH ? sorted.length - 1 : Math.ceil(sorted.length * 0.95) - 1
  return sorted[at]
}
