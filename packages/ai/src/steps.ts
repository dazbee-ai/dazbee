// The step list: each AI step's kind of call and the usage it is expected to report, which its hold is
// priced from. Adding an AI step is its name in `AI_STEPS` (packages/schema), its entry here and its model
// row in `ai_step_models`. Also which model an AI step runs and the sellers that can take its call, in order,
// and which models a step may run: a model's kind is read from the units its price rows count usage in.
import { asc, eq } from 'drizzle-orm'

import { aiStepModels, type Db, modelSellers, type Tx } from '@dazbee/db'
import { type AiStep, type CallInput, type CallKind, referenceCount, type Usage, type UsageUnit } from '@dazbee/schema'

import { currencyRate, type PriceRow, priceRows, pricesOf } from './price-list.ts'
import { type SellerAdapter, sellerAdapter } from './sellers/seller.ts'
import { type AiSettings, aiSettingsOf } from './settings.ts'

/** One AI step: its kind of call, the usage a call is expected to report, and its fixed amount, if it has one. */
export interface StepDef {
  kind: CallKind
  expected(input: CallInput): Usage
  /** The real cost the workspace is charged in place of the priced usage. */
  fixedCost?(settings: AiSettings, input: CallInput): bigint
}

/** A seller that can take a step's call: its adapter and its own name for the model. */
export interface StepSeller {
  seller: string
  sellerModel: string
  adapter: SellerAdapter
}

/** The model a step runs, its options, and the sellers that can take its call, in order. */
export interface StepRoute {
  model: string
  options: Record<string, unknown>
  sellers: StepSeller[]
}

/** The units that mark a model priced in them as one that makes pictures. */
const PICTURE_UNITS: readonly UsageUnit[] = ['picture', 'image-output-token']

/** The units a text model is priced in; a model priced only in these is a text model. */
const TEXT_UNITS: readonly UsageUnit[] = ['input-token', 'cached-input-token', 'output-token', 'image-input-token']

/** How much more than its expected cost a call holds. */
const HOLD_MARGIN = { times: 5n, per: 4n }

/**
 * The image input tokens one picture a model reads is taken to cost. OpenAI's images-vision guide (read 25 Nov
 * 2026) says GPT Image reads every input at high fidelity, at 65 + 129 per 512 px tile + 4,160 for a square
 * picture: 4,354 for 1024 px. An estimate, which the hold's margin covers.
 */
export const PICTURE_INPUT_TOKENS = 4354

/** About 1,056 output tokens for a medium-quality square picture of 1024 px, scaled by area. */
const pictureTokens = (input: CallInput) =>
  'width' in input ? Math.ceil((input.width * input.height * 1056) / (1024 * 1024)) : 1056

/** Every AI step, each in `AI_STEPS`; a test adds steps of its own. */
export const STEPS: Record<string, StepDef> = {
  'round-plan': { kind: 'text', expected: () => ({ 'input-token': 6000, 'output-token': 3000 }) },
  read: { kind: 'text', expected: () => ({ 'input-token': 8000, 'output-token': 2000 }) },
  'layer-plan': { kind: 'text', expected: () => ({ 'input-token': 8000, 'output-token': 4000 }) },
  'draft-fast': { kind: 'picture', expected: (input) => pictureUsage(input) },
  'draft-precise': { kind: 'picture', expected: (input) => pictureUsage(input) },
  refine: { kind: 'picture', expected: (input) => pictureUsage(input) },
  resize: { kind: 'picture', expected: (input) => pictureUsage(input) },
  'layer-split': {
    kind: 'layer-split',
    expected: () => ({ 'gpu-second': 20 }),
    fixedCost: (settings, input) =>
      input.kind === 'layer-split' && input.size === 512 ? settings.layerSplit512 : settings.layerSplit1024,
  },
} satisfies Record<AiStep, StepDef>

/** The step's entry in the step list; fails for a step not in it. */
export function stepDef(step: string): StepDef {
  const def = STEPS[step]
  if (!def) throw new Error(`no AI step ${step}`)
  return def
}

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

/** Whether `step` may run a model priced in `units`: the model takes the step's kind of call. */
export function stepTakes(step: string, units: Iterable<UsageUnit>): boolean {
  return modelKinds(units).includes(stepDef(step).kind)
}

/**
 * The model `step` runs and the sellers that can take its call, in order: `only`, when given, in its
 * order. A seller with no adapter in use or no price for the model is skipped, and logged.
 */
export async function routeStep(db: Db | Tx, step: string, only?: string[]): Promise<StepRoute> {
  const { choice, order } = await modelOf(db, step, only)
  const sellers: StepSeller[] = []
  for (const { seller, sellerModel } of order) {
    const adapter = sellerAdapter(seller)
    const why = !adapter ? 'no adapter' : (await pricesOf(db, seller, choice.model)).length === 0 ? 'no price' : null
    if (why || !adapter) {
      console.warn(JSON.stringify({ msg: 'AI seller skipped', step, model: choice.model, seller, why }))
      continue
    }
    sellers.push({ seller, sellerModel: sellerModel ?? choice.model, adapter })
  }
  return { model: choice.model, options: choice.options, sellers }
}

/**
 * What `calls` should hold, in millionths of a rupee of real cost: each call's expected usage priced at the
 * first of its model's sellers with prices for it (units that seller doesn't price are left out), or its
 * fixed amount, times 1.25. A call's own `sellers`, or else `only`, stands in for the model's sellers. It
 * reads only the price list, so a server that saves jobs needs no seller's key.
 */
export async function holdFor(
  db: Db | Tx,
  calls: { step: string; input: CallInput; sellers?: string[] | undefined }[],
  { sellers: only }: { sellers?: string[] } = {},
): Promise<bigint> {
  const settings = await aiSettingsOf(db)
  let total = 0n
  for (const { step, input, sellers } of calls) {
    const def = stepDef(step)
    if (def.fixedCost) {
      total += def.fixedCost(settings, input)
      continue
    }
    const { choice, order } = await modelOf(db, step, sellers ?? only)
    let priced: { seller: string; rows: PriceRow[] } | null = null
    for (const { seller } of order) {
      const rows = await pricesOf(db, seller, choice.model)
      if (rows.length === 0) continue
      priced = { seller, rows }
      break
    }
    if (!priced) throw new Error(`no seller has a price for the AI step ${step}`)
    const units = new Set(priced.rows.map((row) => row.unit))
    const usage = Object.fromEntries(Object.entries(def.expected(input)).filter(([unit]) => units.has(unit as never)))
    const rate = await currencyRate(db, priced.rows[0]?.currency ?? '')
    total += priceRows(priced.rows, rate, usage, `${choice.model} at ${priced.seller}`).realCost
  }
  return (total * HOLD_MARGIN.times + HOLD_MARGIN.per - 1n) / HOLD_MARGIN.per
}

/**
 * A picture call's expected usage: one picture, its tokens for a seller that counts them, and its reference
 * pictures, counted as each seller bills them: per picture, or as image input tokens.
 */
function pictureUsage(input: CallInput): Usage {
  const references = input.kind === 'picture' ? referenceCount(input) : 0
  return {
    picture: 1,
    'input-token': 1000,
    'image-output-token': pictureTokens(input),
    ...(references > 0
      ? { 'reference-picture': references, 'image-input-token': references * PICTURE_INPUT_TOKENS }
      : {}),
  }
}

/** The model `step` runs, with its options, and its sellers in order: `only`, when given. */
async function modelOf(db: Db | Tx, step: string, only?: string[]) {
  const [choice] = await db.select().from(aiStepModels).where(eq(aiStepModels.step, step))
  if (!choice) throw new Error(`no model is set for the AI step ${step}`)
  const sellers = await db
    .select({ seller: modelSellers.seller, sellerModel: modelSellers.sellerModel })
    .from(modelSellers)
    .where(eq(modelSellers.model, choice.model))
    .orderBy(asc(modelSellers.position))
  // Sellers named in `only` keep their own names for the model, where the model's sellers give one.
  const order = only
    ? only.map((seller) => ({ seller, sellerModel: sellers.find((s) => s.seller === seller)?.sellerModel ?? null }))
    : sellers
  return { choice, order }
}
