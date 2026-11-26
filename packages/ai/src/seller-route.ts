// Which sellers can take a model's call, in order, and which kinds of call a model can take: a model's kind is
// read from the units its price rows count usage in.
import { asc, eq } from 'drizzle-orm'

import { type Db, modelSellers, type Tx } from '@dazbee/db'
import type { CallKind, UsageUnit } from '@dazbee/schema'

import { pricesOf } from './price-list.ts'
import { type SellerAdapter, sellerAdapter } from './sellers/seller.ts'
import { FAST_UNITS, type Tier, tierOf } from './sellers/tiers.ts'
import { declaredUnits } from './sellers/units.ts'

/** A seller that can take a call: its adapter and its own name for the model. */
export interface RouteSeller {
  seller: string
  sellerModel: string
  adapter: SellerAdapter
}

/** The model a call runs, the settings it passes its seller, and the sellers that can take it, in order. */
export interface SellerRoute {
  model: string
  settings: Record<string, unknown>
  sellers: RouteSeller[]
}

/** The units that mark a model priced in them as one that makes pictures. */
const PICTURE_UNITS: readonly UsageUnit[] = ['picture', 'image-output-token']

/** The units a text model is priced in; a model priced only in these is a text model. */
const TEXT_UNITS: readonly UsageUnit[] = [
  'input-token',
  'cached-input-token',
  'output-token',
  ...Object.values(FAST_UNITS),
  'image-input-token',
]

/**
 * The kinds of call a model priced in `units` can take: one priced in pictures or image output tokens makes
 * pictures, from reference pictures or none; one priced in GPU seconds is the layer split; one priced only in text tokens is
 * text. A model priced in none of those, or in no unit, takes none.
 */
export function modelKinds(units: Iterable<UsageUnit>): CallKind[] {
  const priced = new Set(units)
  if (PICTURE_UNITS.some((unit) => priced.has(unit))) return ['picture']
  if (priced.has('gpu-second')) return ['layer-split']
  if (priced.size > 0 && [...priced].every((unit) => TEXT_UNITS.includes(unit))) return ['text']
  return []
}

/**
 * The sellers that can take a `kind` call of `model` with `settings`, in the model's order: `only`, when given, in
 * its order. A seller with no adapter in use, or not priced for the model at the speed tier the settings ask for (a
 * unit it reports has no price), is skipped, and logged, so no call is sent that would fail once the seller has
 * billed it.
 */
export async function routeModel(
  db: Db | Tx,
  { model, kind, settings }: { model: string; kind: CallKind; settings: Record<string, unknown> },
  only?: string[],
): Promise<SellerRoute> {
  const order = await sellersOf(db, model, only)
  const tier = tierOf(settings)
  const sellers: RouteSeller[] = []
  for (const { seller, sellerModel } of order) {
    const adapter = sellerAdapter(seller)
    const check = adapter ? await priceCheck(db, seller, model, sellerModel ?? model, kind, tier) : null
    const why = !adapter ? 'no adapter' : check && !check.priced ? unpricedReason(check.missing) : null
    if (why || !adapter) {
      console.warn(JSON.stringify({ msg: 'AI seller skipped', model, seller, why }))
      continue
    }
    sellers.push({ seller, sellerModel: sellerModel ?? model, adapter })
  }
  return { model, settings, sellers }
}

/**
 * How `model`'s sellers are priced for `kind` calls that ask for `tier`: how many are, and those that price it in
 * some units but not in every unit they report, each with the units missing. A seller with no price for the
 * model at all doesn't sell it here, and no call goes to it.
 */
export async function sellerPricing(
  db: Db | Tx,
  model: string,
  kind: CallKind,
  tier: Tier = 'standard',
): Promise<{ priced: number; unpriced: { seller: string; units: UsageUnit[] }[] }> {
  let priced = 0
  const unpriced: { seller: string; units: UsageUnit[] }[] = []
  for (const { seller, sellerModel } of await sellersOf(db, model)) {
    const check = await priceCheck(db, seller, model, sellerModel ?? model, kind, tier)
    if (check.priced) priced++
    else if (check.rows.length > 0) unpriced.push({ seller, units: check.missing })
  }
  return { priced, unpriced }
}

/** `model`'s sellers in order, each with its own name for the model where it has one: `only`, when given. */
async function sellersOf(db: Db | Tx, model: string, only?: string[]) {
  const sellers = await db
    .select({ seller: modelSellers.seller, sellerModel: modelSellers.sellerModel })
    .from(modelSellers)
    .where(eq(modelSellers.model, model))
    .orderBy(asc(modelSellers.position))
  // Sellers named in `only` keep their own names for the model, where the model's sellers give one.
  return only
    ? only.map((seller) => ({ seller, sellerModel: sellers.find((s) => s.seller === seller)?.sellerModel ?? null }))
    : sellers
}

/**
 * Whether `seller` is priced for `kind` calls of `model` that ask for `tier`: it has a price for every unit it
 * reports for them (a seller with no declared units, only tests', for any unit at all); its price rows, the
 * units a call is priced in there, and those with no price.
 */
async function priceCheck(db: Db | Tx, seller: string, model: string, sellerModel: string, kind: CallKind, tier: Tier) {
  const rows = await pricesOf(db, seller, model)
  const has = new Set(rows.map((row) => row.unit))
  const declared = declaredUnits(seller, kind, sellerModel, tier)
  const units = new Set(declared ?? has)
  const missing = declared ? declared.filter((unit) => !has.has(unit)) : []
  return { rows, units, missing, priced: rows.length > 0 && units.size > 0 && missing.length === 0 }
}

/** Why a seller is not priced, as the route logs it. */
function unpricedReason(missing: UsageUnit[]): string {
  return missing.length > 0 ? `no price for ${missing.join(', ')}` : 'no price'
}
