// Prices an AI call's usage from the price list: its cost in the seller's currency, and its real cost in
// rupees, with the seller's GST or fee and the currency's rate. Amounts are whole millionths, rounded once.
import { and, eq } from 'drizzle-orm'

import { aiPrices, currencyRates, type Db, type Tx } from '@dazbee/db'
import type { Usage, UsageUnit } from '@dazbee/schema'

/** What a call cost: in millionths of the seller's currency, before GST or fee, and in millionths of a rupee. */
export interface Priced {
  currency: string
  sellerCost: bigint
  realCost: bigint
}

/** One price row as pricing reads it. */
export interface PriceRow {
  unit: UsageUnit
  currency: string
  pricePerMillion: bigint
  fee: number
}

const MILLION = 1_000_000n

/**
 * Prices `usage` of `model` at `seller`. Fails when a unit used has no price, or the seller's prices for
 * the model are in more than one currency or one with no rate.
 */
export async function priceUsage(db: Db | Tx, seller: string, model: string, usage: Usage): Promise<Priced> {
  const rows = await pricesOf(db, seller, model)
  const currency = rows[0]?.currency
  if (!currency) throw new Error(`no price for ${model} at ${seller}`)
  return priceRows(rows, await currencyRate(db, currency), usage, `${model} at ${seller}`)
}

/** What one unit of `currency` costs in millionths of a rupee; fails for a currency with no rate. */
export async function currencyRate(db: Db | Tx, currency: string): Promise<bigint> {
  const [row] = await db
    .select({ rate: currencyRates.rate })
    .from(currencyRates)
    .where(eq(currencyRates.currency, currency))
  if (!row) throw new Error(`no rate for ${currency}`)
  return row.rate
}

/** The price rows of `model` at `seller`, empty when it has none. */
export function pricesOf(db: Db | Tx, seller: string, model: string): Promise<PriceRow[]> {
  return db
    .select({
      unit: aiPrices.unit,
      currency: aiPrices.currency,
      pricePerMillion: aiPrices.pricePerMillion,
      fee: aiPrices.fee,
    })
    .from(aiPrices)
    .where(and(eq(aiPrices.seller, seller), eq(aiPrices.model, model)))
}

/**
 * Prices `usage` with `rows`, all in one currency worth `rate` millionths of a rupee. Each amount is kept
 * exact (usage in millionths times the price per million in millionths gives 10⁻¹⁸ of the currency) and
 * rounded half up only at the end.
 */
export function priceRows(rows: PriceRow[], rate: bigint, usage: Usage, what: string): Priced {
  const currency = rows[0]?.currency ?? ''
  if (rows.some((row) => row.currency !== currency)) throw new Error(`${what} is priced in more than one currency`)
  let exact = 0n
  let withFee = 0n
  for (const [unit, amount] of Object.entries(usage) as [UsageUnit, number][]) {
    if (amount === 0) continue
    const row = rows.find((r) => r.unit === unit)
    if (!row) throw new Error(`${what} has no price for ${unit}`)
    const cost = BigInt(Math.round(amount * 1e6)) * row.pricePerMillion
    exact += cost
    withFee += cost * (MILLION + BigInt(row.fee))
  }
  return {
    currency,
    sellerCost: divideRounded(exact, 10n ** 12n),
    realCost: divideRounded(withFee * rate, 10n ** 24n),
  }
}

/** `value` ÷ `by`, rounded half up; `value` is never below zero. */
function divideRounded(value: bigint, by: bigint): bigint {
  return (value + by / 2n) / by
}
