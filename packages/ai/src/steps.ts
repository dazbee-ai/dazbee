// The step list: each AI step's kind of call and the usage it is expected to report, which its hold is
// priced from. Adding an AI step is its name in `AI_STEPS` (packages/schema) and its entry here; it runs its
// kind's default model (`ai_kind_models`), and gets a row in `ai_step_models` only for a model of its own. Also
// which model an AI step runs and the sellers that can take its call, in order, and which kinds of call a
// model can take: a model's kind is read from the units its price rows count usage in.
import { asc, eq } from 'drizzle-orm'

import { aiKindModels, aiStepModels, type Db, modelSellers, type Tx } from '@dazbee/db'
import { type AiStep, type CallInput, type CallKind, referenceCount, type Usage, type UsageUnit } from '@dazbee/schema'

import { currencyRate, priceRows, pricesOf } from './price-list.ts'
import { type SellerAdapter, sellerAdapter } from './sellers/seller.ts'
import { declaredUnits } from './sellers/units.ts'
import { type AiSettings, aiSettingsOf } from './settings.ts'

/**
 * A text step's sizes, set by a person from the measured sizes the admin page shows beside them: the input
 * and output tokens one call normally uses, and its ceiling, the most output tokens one call may write.
 */
export interface StepSizes {
  input: number
  output: number
  ceiling: number
}

/**
 * One AI step: its kind of call, the usage a call is expected to report, a text step's sizes, and its fixed
 * amount, if it has one.
 */
export interface StepDef {
  kind: CallKind
  expected(input: CallInput): Usage
  sizes?: StepSizes
  /** The real cost the workspace is charged in place of the priced usage. */
  fixedCost?(settings: AiSettings, input: CallInput): bigint
  /** How long one try may take, in place of the seller's or the kind's time, for a step that writes a long answer. */
  timeoutMs?: number
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

/**
 * The image input tokens one picture a model reads is taken to cost. OpenAI's images-vision guide (read 25 Nov
 * 2026) says GPT Image reads every input at high fidelity, at 65 + 129 per 512 px tile + 4,160 for a square
 * picture: 4,354 for 1024 px. An estimate, which the hold's margin covers.
 */
export const PICTURE_INPUT_TOKENS = 4354

/** The units that mark a model priced in them as one that makes pictures. */
const PICTURE_UNITS: readonly UsageUnit[] = ['picture', 'image-output-token']

/** The units a text model is priced in; a model priced only in these is a text model. */
const TEXT_UNITS: readonly UsageUnit[] = ['input-token', 'cached-input-token', 'output-token', 'image-input-token']

/** How long a round plan's try may take: the planners reason before they write four long prompts, past 60 s. */
const PLAN_TIMEOUT_MS = 240_000

/** How much more than its expected cost a call holds. */
const HOLD_MARGIN = { times: 5n, per: 4n }

/** A text step of `sizes`, expected to use its expected input and output tokens. */
const textStep = (sizes: StepSizes): StepDef => ({
  kind: 'text',
  sizes,
  expected: () => ({ 'input-token': sizes.input, 'output-token': sizes.output }),
})

/** About 1,056 output tokens for a medium-quality square picture of 1024 px, scaled by area. */
const pictureTokens = (input: CallInput) =>
  'width' in input ? Math.ceil((input.width * input.height * 1056) / (1024 * 1024)) : 1056

/** Every AI step, each in `AI_STEPS`; a test adds steps of its own. */
export const STEPS: Record<string, StepDef> = {
  // Ceilings start at 4 times the expected output, to be set from the measured sizes once calls are made.
  'flow.round-plan': { ...textStep({ input: 6000, output: 3000, ceiling: 12_000 }), timeoutMs: PLAN_TIMEOUT_MS },
  // The full round director (about 3,200 tokens), the brief and two pictures in; four ads of up to 1,300
  // characters each, with their ideas and arrangements, and the planner's reasoning out.
  'flow.round-plan-full': { ...textStep({ input: 12_000, output: 6000, ceiling: 24_000 }), timeoutMs: PLAN_TIMEOUT_MS },
  // The reference reader (about 700 tokens) and one picture in; one sentence, a yes or no and a kind out.
  'flow.reference-read': textStep({ input: 5500, output: 500, ceiling: 2000 }),
  // The refine editor (about 500 tokens), the message, the ad and its marked copy in; one paragraph, a few words
  // and a yes or no out.
  'flow.refine-plan': textStep({ input: 10_000, output: 1000, ceiling: 4000 }),
  'flow.read': textStep({ input: 8000, output: 2000, ceiling: 8000 }),
  'flow.layer-plan': textStep({ input: 8000, output: 4000, ceiling: 16_000 }),
  'flow.draft-fast': { kind: 'picture', expected: (input) => pictureUsage(input) },
  'flow.draft-precise': { kind: 'picture', expected: (input) => pictureUsage(input) },
  'flow.refine': { kind: 'picture', expected: (input) => pictureUsage(input) },
  'flow.resize': { kind: 'picture', expected: (input) => pictureUsage(input) },
  'flow.layer-split': {
    kind: 'layer-split',
    expected: () => ({ 'gpu-second': 20 }),
    fixedCost: (settings, input) =>
      input.kind === 'layer-split' && input.size === 512 ? settings.layerSplit512 : settings.layerSplit1024,
  },
} satisfies Record<AiStep, StepDef>

/**
 * About how long one call of each AI step takes, in seconds: the slowest time measured for the model it runs, so
 * the wait shown is seldom passed. Pictures from `docs/research/ai-flow-image-models.md`; the round plans from the
 * paid run of the flow's job scripts (#326). The steps not measured yet take their expected output at the speed
 * measured for their model there: gpt-6-luna wrote 9,810 tokens in 69.1 s (142 a second), gpt-6.2-sol 2,402 in
 * 48.8 s (49 a second).
 */
export const STEP_SECONDS = {
  // gpt-6-luna: 46–69 s.
  'flow.round-plan': 69,
  // gpt-6.2-sol: 48.8 s.
  'flow.round-plan-full': 49,
  // gpt-6-luna, 500 tokens out.
  'flow.reference-read': 4,
  // gpt-6-luna, 1,000 tokens out.
  'flow.refine-plan': 7,
  // gpt-6-luna, 2,000 tokens out.
  'flow.read': 14,
  // gpt-6.2-sol, 4,000 tokens out.
  'flow.layer-plan': 82,
  // Muse Image: 17–26 s.
  'flow.draft-fast': 26,
  // GPT Image 2.5 Sunburst: 18–45 s.
  'flow.draft-precise': 45,
  // Seedream 5.5 edits: 22–117 s.
  'flow.refine': 117,
  'flow.resize': 117,
  // Ming on a warm Modal H100: 17.5 s; a cold start takes 50–55 s.
  'flow.layer-split': 18,
} satisfies Record<AiStep, number>

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

/**
 * The model `step` runs and the sellers that can take its call, in order: `only`, when given, in its
 * order. A seller with no adapter in use, or not priced for the model (a unit it reports has no price), is
 * skipped, and logged, so no call is sent that would fail once the seller has billed it.
 */
export async function routeStep(db: Db | Tx, step: string, only?: string[]): Promise<StepRoute> {
  const { choice, order } = await modelOf(db, step, only)
  const kind = stepDef(step).kind
  const sellers: StepSeller[] = []
  for (const { seller, sellerModel } of order) {
    const adapter = sellerAdapter(seller)
    const check = adapter ? await priceCheck(db, seller, choice.model, sellerModel ?? choice.model, kind) : null
    const why = !adapter ? 'no adapter' : check && !check.priced ? unpricedReason(check.missing) : null
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
 * dearest of its model's sellers that are priced for it (each counting the units it reports), or its fixed
 * amount, times 1.25. A text call's input is counted from the call itself. A call's own `sellers`, or else
 * `only`, stands in for the model's sellers. It reads only the price list and the declared units, so a server
 * that saves jobs needs no seller's key. Fails for a call no seller is priced for.
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
    const expected = expectedUsage(def, input)
    let dearest: bigint | null = null
    for (const { seller, sellerModel } of order) {
      const check = await priceCheck(db, seller, choice.model, sellerModel ?? choice.model, def.kind)
      if (!check.priced) continue
      const usage = Object.fromEntries(Object.entries(expected).filter(([unit]) => check.units.has(unit as UsageUnit)))
      const rate = await currencyRate(db, check.rows[0]?.currency ?? '')
      const cost = priceRows(check.rows, rate, usage, `${choice.model} at ${seller}`).realCost
      if (dearest === null || cost > dearest) dearest = cost
    }
    if (dearest === null) throw new Error(`no seller is priced for the AI step ${step}`)
    total += dearest
  }
  return (total * HOLD_MARGIN.times + HOLD_MARGIN.per - 1n) / HOLD_MARGIN.per
}

/**
 * How `model`'s sellers are priced for `kind` calls: how many are, and those that price it in some units but
 * not in every unit they report, each with the units missing. A seller with no price for the model at all
 * doesn't sell it here, and no call goes to it.
 */
export async function sellerPricing(
  db: Db | Tx,
  model: string,
  kind: CallKind,
): Promise<{ priced: number; unpriced: { seller: string; units: UsageUnit[] }[] }> {
  const order = await db
    .select({ seller: modelSellers.seller, sellerModel: modelSellers.sellerModel })
    .from(modelSellers)
    .where(eq(modelSellers.model, model))
    .orderBy(asc(modelSellers.position))
  let priced = 0
  const unpriced: { seller: string; units: UsageUnit[] }[] = []
  for (const { seller, sellerModel } of order) {
    const check = await priceCheck(db, seller, model, sellerModel ?? model, kind)
    if (check.priced) priced++
    else if (check.rows.length > 0) unpriced.push({ seller, units: check.missing })
  }
  return { priced, unpriced }
}

/** The model `step` runs and its options: its own, or its kind's default. */
export async function stepModel(
  db: Db | Tx,
  step: string,
): Promise<{ model: string; options: Record<string, unknown> }> {
  const [own] = await db.select().from(aiStepModels).where(eq(aiStepModels.step, step))
  if (own) return own
  const kind = stepDef(step).kind
  const [byKind] = await db.select().from(aiKindModels).where(eq(aiKindModels.kind, kind))
  if (!byKind) throw new Error(`no default model is set for ${kind} calls`)
  return byKind
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

/**
 * The model `step` runs, with its options: its own when an admin set one, otherwise its kind's default; and the
 * model's sellers in order: `only`, when given.
 */
async function modelOf(db: Db | Tx, step: string, only?: string[]) {
  const choice = await stepModel(db, step)
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

/**
 * Whether `seller` is priced for `kind` calls of `model`: it has a price for every unit it reports for them
 * (a seller with no declared units, only tests', for any unit at all); its price rows, the units a call is
 * priced in there, and those with no price.
 */
async function priceCheck(db: Db | Tx, seller: string, model: string, sellerModel: string, kind: CallKind) {
  const rows = await pricesOf(db, seller, model)
  const has = new Set(rows.map((row) => row.unit))
  const declared = declaredUnits(seller, kind, sellerModel)
  const units = new Set(declared ?? has)
  const missing = declared ? declared.filter((unit) => !has.has(unit)) : []
  return { rows, units, missing, priced: rows.length > 0 && units.size > 0 && missing.length === 0 }
}

/** Why a seller is not priced, as the route logs it. */
function unpricedReason(missing: UsageUnit[]): string {
  return missing.length > 0 ? `no price for ${missing.join(', ')}` : 'no price'
}

/**
 * What a call of `def` is expected to use: a text step's input counted from the call's instructions and
 * prompt (a token for every 4 characters) and `PICTURE_INPUT_TOKENS` for each picture it reads, with its
 * expected output; any other call as its step expects.
 */
function expectedUsage(def: StepDef, input: CallInput): Usage {
  if (!def.sizes || input.kind !== 'text') return def.expected(input)
  const characters = input.instructions.length + input.prompt.length
  return {
    'input-token': Math.ceil(characters / 4) + input.pictures.length * PICTURE_INPUT_TOKENS,
    'output-token': def.sizes.output,
  }
}
