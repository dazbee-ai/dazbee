// The daily check: for each seller and each of the UTC days before, our call log's cost against the seller's
// own figure, both in the seller's currency before GST or fee. A seller-day that differs by more than 2% and
// more than ₹1 is red. Modal's figure also covers GPU time outside our calls (cold starts, idle containers),
// which is kept apart and never red. A seller with no figure for a day yet is waiting.
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'

import { aiCalls, aiDailyChecks, type Db } from '@dazbee/db'
import type { DailyCheckSource, DailyCheckState } from '@dazbee/schema'

import { currencyRate } from './price-list.ts'

/** A seller's own figure for a day: its currency and its cost, in that currency, before GST or fee. */
export interface SellerDay {
  currency: string
  cost: number
}

/** Reads a seller's own figure for a UTC day (YYYY-MM-DD); null while the seller has none yet. */
export type CostReport = (day: string) => Promise<SellerDay | null>

/** One seller-day as the check wrote it. */
export interface CheckedDay {
  seller: string
  day: string
  state: DailyCheckState
}

/** How many days before today each daily check looks at, so a seller's late figures are caught. */
export const DAYS_CHECKED = 3

/** The share past which a seller-day is red, in millionths (2%). */
const RED_SHARE = 20_000n

/** The difference in rupees, in millionths, under which a seller-day is never red (₹1). */
const RED_FLOOR = 1_000_000n

/** The sellers whose figure includes cost outside our calls, kept apart rather than red. */
const OUTSIDE_CALLS = new Set(['modal'])

/**
 * Checks each seller of `reports` for each of the `DAYS_CHECKED` UTC days before `today`, writing a row per
 * seller-day; what it wrote. A report that fails leaves its day waiting.
 */
export async function runDailyCheck(
  db: Db,
  reports: Map<string, CostReport>,
  today: Date = new Date(),
): Promise<CheckedDay[]> {
  const checked: CheckedDay[] = []
  for (const day of daysBefore(today, DAYS_CHECKED)) {
    for (const [seller, report] of reports) {
      const figure = await report(day).catch(() => null)
      checked.push(await checkDay(db, seller, day, figure, 'report'))
    }
  }
  return checked
}

/**
 * Compares our cost for `seller` on `day` with `figure`, the seller's own, and writes the day's row, in place
 * of any before it; the row's state. Without a figure, the day is waiting.
 */
export async function checkDay(
  db: Db,
  seller: string,
  day: string,
  figure: SellerDay | null,
  source: DailyCheckSource,
): Promise<CheckedDay> {
  const ours = await ourCost(db, seller, day)
  const currency = figure?.currency ?? ours.currency ?? 'USD'
  const theirs = figure ? BigInt(Math.round(figure.cost * 1e6)) : null
  let state: DailyCheckState = 'waiting'
  let outside: bigint | null = null
  if (theirs !== null) {
    if (OUTSIDE_CALLS.has(seller)) {
      outside = theirs - ours.cost
      state = 'ok'
    } else {
      state = (await isRed(db, currency, ours.cost, theirs)) ? 'red' : 'ok'
    }
  }
  const row = {
    seller,
    day,
    currency,
    ourCost: ours.cost,
    sellerCost: theirs,
    outsideCalls: outside,
    state,
    source: figure ? source : null,
    checkedAt: new Date(),
  }
  await db
    .insert(aiDailyChecks)
    .values(row)
    .onConflictDoUpdate({ target: [aiDailyChecks.seller, aiDailyChecks.day], set: row })
  return { seller, day, state }
}

/**
 * Our cost for `seller` on UTC `day`: every call the seller made, done or settled, in millionths of its
 * currency before GST or fee, and that currency.
 */
export async function ourCost(db: Db, seller: string, day: string): Promise<{ cost: bigint; currency: string | null }> {
  const start = new Date(`${day}T00:00:00Z`)
  const [row] = await db
    .select({
      cost: sql<string>`coalesce(sum(${aiCalls.sellerCost}), 0)`,
      currency: sql<string | null>`max(${aiCalls.currency})`,
    })
    .from(aiCalls)
    .where(
      and(
        eq(aiCalls.seller, seller),
        inArray(aiCalls.state, ['done']),
        gte(aiCalls.startedAt, start),
        lt(aiCalls.startedAt, new Date(start.getTime() + 86_400_000)),
      ),
    )
  return { cost: BigInt(row?.cost ?? 0), currency: row?.currency ?? null }
}

/** The `count` UTC days before `today`'s, oldest first, as YYYY-MM-DD. */
export function daysBefore(today: Date, count: number): string[] {
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  return Array.from({ length: count }, (_, i) =>
    new Date(midnight - (count - i) * 86_400_000).toISOString().slice(0, 10),
  )
}

/** Whether `ours` and `theirs` differ by more than 2% of the seller's figure and by more than ₹1. */
async function isRed(db: Db, currency: string, ours: bigint, theirs: bigint): Promise<boolean> {
  const difference = ours > theirs ? ours - theirs : theirs - ours
  const base = theirs > 0n ? theirs : ours
  if (difference * 1_000_000n <= base * RED_SHARE) return false
  const rate = await currencyRate(db, currency.toUpperCase()).catch(() => 1_000_000n)
  return (difference * rate) / 1_000_000n > RED_FLOOR
}
