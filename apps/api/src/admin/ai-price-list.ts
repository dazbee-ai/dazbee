// The price list as an admin reads and sets it: the currency rates, each seller's prices for each model and
// the order a model's sellers are tried in, and the units each model is priced in, which say what kind of
// model it is. Amounts come and go as decimals and are kept as whole millionths.
// A call keeps the cost it was priced at, so a change here reaches only calls made after it.
import { and, asc, eq, ne } from 'drizzle-orm'

import { aiPrices, currencyRates, type Db, modelSellers } from '@dazbee/db'
import {
  type AiPriceInput,
  type AiPriceView,
  type CurrencyRateView,
  fromMillionths,
  type ModelSellersInput,
  type ModelSellersView,
  toMillionths,
  type UsageUnit,
} from '@dazbee/schema'

/** Why a change to the price list was refused. */
export class PriceListRefused extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PriceListRefused'
  }
}

/** Every currency's rate in rupees. */
export async function listCurrencyRates(db: Db): Promise<CurrencyRateView[]> {
  const rows = await db.select().from(currencyRates).orderBy(asc(currencyRates.currency))
  return rows.map((row) => ({
    currency: row.currency,
    rate: fromMillionths(row.rate),
    updatedAt: row.updatedAt.toISOString(),
  }))
}

/** Sets `currency`'s rate in rupees, adding the currency when it has none; a rupee is always worth 1. */
export async function setCurrencyRate(db: Db, currency: string, rate: number): Promise<void> {
  const millionths = toMillionths(rate)
  if (currency === 'INR' && millionths !== 1_000_000n) throw new PriceListRefused('A rupee is always worth 1')
  if (millionths <= 0n) throw new PriceListRefused('A rate is more than 0')
  const row = { currency, rate: millionths, updatedAt: new Date() }
  await db
    .insert(currencyRates)
    .values(row)
    .onConflictDoUpdate({ target: currencyRates.currency, set: { rate: row.rate, updatedAt: row.updatedAt } })
}

/** The whole price list, by seller, model and unit. */
export async function listPrices(db: Db): Promise<AiPriceView[]> {
  const rows = await db.select().from(aiPrices).orderBy(asc(aiPrices.model), asc(aiPrices.seller), asc(aiPrices.unit))
  return rows.map((row) => ({
    seller: row.seller,
    model: row.model,
    unit: row.unit,
    currency: row.currency,
    pricePerMillion: fromMillionths(row.pricePerMillion),
    fee: row.fee / 1e6,
    updatedAt: row.updatedAt.toISOString(),
  }))
}

/**
 * Sets one price, adding the row when the seller has no price for the model in that unit yet. Refuses a
 * currency with no rate, and one other than the seller's other prices for the model are in.
 */
export async function setPrice(db: Db, price: AiPriceInput): Promise<void> {
  const [rate] = await db.select().from(currencyRates).where(eq(currencyRates.currency, price.currency))
  if (!rate) throw new PriceListRefused(`${price.currency} has no rate; set its rate first`)
  const [other] = await db
    .select({ currency: aiPrices.currency })
    .from(aiPrices)
    .where(
      and(
        eq(aiPrices.seller, price.seller),
        eq(aiPrices.model, price.model),
        ne(aiPrices.unit, price.unit),
        ne(aiPrices.currency, price.currency),
      ),
    )
    .limit(1)
  if (other) {
    throw new PriceListRefused(`${price.seller}'s other prices for ${price.model} are in ${other.currency}`)
  }
  const values = {
    seller: price.seller,
    model: price.model,
    unit: price.unit,
    currency: price.currency,
    pricePerMillion: toMillionths(price.pricePerMillion),
    fee: Math.round(price.fee * 1e6),
    updatedAt: new Date(),
  }
  await db
    .insert(aiPrices)
    .values(values)
    .onConflictDoUpdate({
      target: [aiPrices.seller, aiPrices.model, aiPrices.unit],
      set: {
        currency: values.currency,
        pricePerMillion: values.pricePerMillion,
        fee: values.fee,
        updatedAt: values.updatedAt,
      },
    })
}

/** Takes one price off the list; whether there was one. */
export async function removePrice(
  db: Db,
  { seller, model, unit }: { seller: string; model: string; unit: UsageUnit },
): Promise<boolean> {
  const removed = await db
    .delete(aiPrices)
    .where(and(eq(aiPrices.seller, seller), eq(aiPrices.model, model), eq(aiPrices.unit, unit)))
    .returning({ seller: aiPrices.seller })
  return removed.length > 0
}

/** Every model's sellers, in the order each is tried. */
export async function listModelSellers(db: Db): Promise<ModelSellersView[]> {
  const rows = await db.select().from(modelSellers).orderBy(asc(modelSellers.model), asc(modelSellers.position))
  const byModel = new Map<string, ModelSellersView>()
  for (const row of rows) {
    const model = byModel.get(row.model) ?? { model: row.model, sellers: [] }
    model.sellers.push({ seller: row.seller, sellerModel: row.sellerModel })
    byModel.set(row.model, model)
  }
  return [...byModel.values()]
}

/** Sets the sellers of `model` and their order, in place of the ones before; a model not sold yet is added. */
export async function setModelSellers(db: Db, model: string, { sellers }: ModelSellersInput): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.delete(modelSellers).where(eq(modelSellers.model, model))
    await tx
      .insert(modelSellers)
      .values(sellers.map((s, i) => ({ model, seller: s.seller, position: i + 1, sellerModel: s.sellerModel })))
  })
}

/**
 * The units each model is priced in by the sellers in its seller order, by model. A model none of its sellers
 * has a price for is left out, as no AI step can run it.
 */
export async function pricedUnits(db: Db): Promise<Map<string, UsageUnit[]>> {
  const rows = await db
    .select({ model: aiPrices.model, unit: aiPrices.unit })
    .from(aiPrices)
    .innerJoin(modelSellers, and(eq(modelSellers.model, aiPrices.model), eq(modelSellers.seller, aiPrices.seller)))
    .orderBy(asc(aiPrices.model), asc(aiPrices.unit))
  const units = new Map<string, UsageUnit[]>()
  for (const { model, unit } of rows) {
    const each = units.get(model) ?? []
    if (!each.includes(unit)) each.push(unit)
    units.set(model, each)
  }
  return units
}
