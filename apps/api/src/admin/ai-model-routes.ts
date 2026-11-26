// The admin page's routes for which model each AI call runs, under /admin/ai, behind the AI routes' admin check:
// each kind of call's default model, and each AI step's model, which is its kind's default unless an admin
// overrides it, with a text step's sizes as set beside those its calls measured. A kind's default, and an
// override, must be a model of that kind that every seller in its order is priced for.
import { and, eq, gte, isNotNull, or, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'

import { CUT_OFF, FAST_UNITS, modelKinds, sellerPricing, stepDef, STEPS, tierOf } from '@dazbee/ai'
import { aiCalls, aiKindModels, aiStepModels, type Db, type Tx } from '@dazbee/db'
import {
  AI_STEPS,
  type AiKindModelView,
  AiStepModelInput,
  type AiStepModelView,
  AiStepOverrideRemoval,
  CALL_KINDS,
  type CallKind,
  type MeasuredSizes,
  type UnpricedModel,
  type UsageUnit,
  type WrongKind,
} from '@dazbee/schema'

import { body, type Env, error } from '../http.ts'
import { ChangedMeanwhile, checkSince } from './ai-changed-meanwhile.ts'
import { pricedUnits } from './ai-price-list.ts'

/** A kind of model as a refusal names it, by the kind of call it takes. */
const KIND_WORDS: Record<CallKind, string> = {
  text: 'a text model',
  picture: 'a picture model',
  'layer-split': 'a GPU model',
}

/** How far back the measured sizes look. */
const MEASURED_DAYS = 30

export function aiModelRoutes(db: Db): Hono<Env> {
  const app = new Hono<Env>()

  app.get('/admin/ai/kind-models', async (c) => {
    const [kinds, overrides, units] = await Promise.all([
      db.select().from(aiKindModels),
      db.select({ step: aiStepModels.step }).from(aiStepModels),
      pricedUnits(db),
    ])
    const own = new Set(overrides.map((row) => row.step))
    return c.json(
      CALL_KINDS.flatMap((kind) => {
        const row = kinds.find((k) => k.kind === kind)
        if (!row) return []
        return [
          {
            kind,
            model: row.model,
            models: modelsOf(units, kind),
            options: row.options,
            steps: AI_STEPS.filter((step) => stepDef(step).kind === kind && !own.has(step)),
            updatedAt: row.updatedAt.toISOString(),
          },
        ]
      }) satisfies AiKindModelView[],
    )
  })

  app.put('/admin/ai/kind-models/:kind', async (c) => {
    const kind = CALL_KINDS.find((k) => k === c.req.param('kind'))
    if (!kind) return c.json(error('No such kind of AI call'), 404)
    const input = await body(c.req.raw, AiStepModelInput)
    if (input instanceof Response) return input
    const refused = await refusedModel(c, db, input, kind)
    if (refused) return refused
    return changedOr(c, () =>
      db.transaction(async (tx) => {
        await lockRow(tx, `ai-kind-models:${kind}`)
        const [stored] = await tx
          .select({ updatedAt: aiKindModels.updatedAt })
          .from(aiKindModels)
          .where(eq(aiKindModels.kind, kind))
          .for('update')
        checkSince(stored?.updatedAt ?? null, input.since)
        const choice = { model: input.model, options: input.options, updatedAt: new Date() }
        await tx
          .insert(aiKindModels)
          .values({ kind, ...choice })
          .onConflictDoUpdate({ target: aiKindModels.kind, set: choice })
      }),
    )
  })

  app.get('/admin/ai/step-models', async (c) => {
    const [kinds, overrides, units, measured] = await Promise.all([
      db.select().from(aiKindModels),
      db.select().from(aiStepModels),
      pricedUnits(db),
      measuredSizes(db),
    ])
    return c.json(
      AI_STEPS.flatMap((step) => {
        const kind = stepDef(step).kind
        const own = overrides.find((row) => row.step === step)
        const chosen = own ?? kinds.find((row) => row.kind === kind)
        if (!chosen) return []
        return [
          {
            step,
            kind,
            model: chosen.model,
            models: modelsOf(units, kind),
            options: chosen.options,
            source: own ? ('override' as const) : ('kind' as const),
            updatedAt: own ? own.updatedAt.toISOString() : null,
            sizes: stepDef(step).sizes ?? null,
            measured: measured.get(`${step}/${chosen.model}`) ?? null,
          },
        ]
      }) satisfies AiStepModelView[],
    )
  })

  app.put('/admin/ai/step-models/:step', async (c) => {
    const step = stepOf(c.req.param('step'))
    if (!step) return c.json(error('No such AI step'), 404)
    const input = await body(c.req.raw, AiStepModelInput)
    if (input instanceof Response) return input
    const refused = await refusedModel(c, db, input, stepDef(step).kind, step)
    if (refused) return refused
    return changedOr(c, () =>
      db.transaction(async (tx) => {
        await lockRow(tx, `ai-step-models:${step}`)
        const [stored] = await tx
          .select({ updatedAt: aiStepModels.updatedAt })
          .from(aiStepModels)
          .where(eq(aiStepModels.step, step))
          .for('update')
        checkSince(stored?.updatedAt ?? null, input.since)
        const choice = { model: input.model, options: input.options, updatedAt: new Date() }
        await tx
          .insert(aiStepModels)
          .values({ step, ...choice })
          .onConflictDoUpdate({ target: aiStepModels.step, set: choice })
      }),
    )
  })

  app.delete('/admin/ai/step-models/:step', async (c) => {
    const step = stepOf(c.req.param('step'))
    if (!step) return c.json(error('No such AI step'), 404)
    const input = await body(c.req.raw, AiStepOverrideRemoval)
    if (input instanceof Response) return input
    return changedOr(c, () =>
      db.transaction(async (tx) => {
        await lockRow(tx, `ai-step-models:${step}`)
        const [stored] = await tx
          .select({ updatedAt: aiStepModels.updatedAt })
          .from(aiStepModels)
          .where(eq(aiStepModels.step, step))
          .for('update')
        checkSince(stored?.updatedAt ?? null, input.since)
        if (stored) await tx.delete(aiStepModels).where(eq(aiStepModels.step, step))
      }),
    )
  })

  return app
}

/**
 * What each text step's calls on each model used over the last `MEASURED_DAYS` days, done or cut off at the
 * ceiling, by `<step>/<model>`.
 */
export async function measuredSizes(db: Db): Promise<Map<string, MeasuredSizes>> {
  // A call is counted in the standard or the fast token units, by the tier it ran on.
  const tokens = (unit: keyof typeof FAST_UNITS) =>
    sql`coalesce((${aiCalls.usage}->>${sql.raw(`'${unit}'`)})::numeric, 0) + coalesce((${aiCalls.usage}->>${sql.raw(`'${FAST_UNITS[unit]}'`)})::numeric, 0)`
  const input = sql`${tokens('input-token')} + ${tokens('cached-input-token')}`
  const output = tokens('output-token')
  const rows = await db
    .select({
      step: aiCalls.step,
      model: aiCalls.model,
      calls: sql<number>`count(*)::int`,
      cutOff: sql<number>`(count(*) filter (where ${aiCalls.state} = 'failed'))::int`,
      inputAverage: sql<number>`avg(${input})::float8`,
      inputP95: sql<number>`percentile_cont(0.95) within group (order by ${input})`,
      outputAverage: sql<number>`avg(${output})::float8`,
      outputP95: sql<number>`percentile_cont(0.95) within group (order by ${output})`,
    })
    .from(aiCalls)
    .where(
      and(
        gte(aiCalls.startedAt, sql`now() - make_interval(days => ${MEASURED_DAYS})`),
        isNotNull(aiCalls.usage),
        or(eq(aiCalls.state, 'done'), and(eq(aiCalls.state, 'failed'), eq(aiCalls.error, CUT_OFF))),
      ),
    )
    .groupBy(aiCalls.step, aiCalls.model)
  return new Map(
    rows
      .filter((row) => stepOf(row.step) && stepDef(row.step).kind === 'text')
      .map((row) => [
        `${row.step}/${row.model}`,
        {
          calls: row.calls,
          cutOff: row.cutOff,
          input: { average: Math.round(row.inputAverage), p95: Math.round(row.inputP95) },
          output: { average: Math.round(row.outputAverage), p95: Math.round(row.outputP95) },
        },
      ]),
  )
}

/** The priced models that take `kind` calls. */
function modelsOf(units: Map<string, UsageUnit[]>, kind: CallKind): string[] {
  return [...units].flatMap(([model, priced]) => (modelKinds(priced).includes(kind) ? [model] : []))
}

/**
 * A 400 when `model` can't take `kind` calls with `options`: no seller has a price for it, it is priced as
 * another kind, or a seller in its order lacks a price for a unit it reports at the speed tier the options ask
 * for; null when it can. `step` names the AI step it is for, if any.
 */
async function refusedModel(
  c: Context<Env>,
  db: Db,
  { model, options }: { model: string; options: Record<string, unknown> },
  kind: CallKind,
  step?: string,
): Promise<Response | null> {
  const units = (await pricedUnits(db)).get(model)
  if (!units) return c.json(error(`No seller of ${model} has a price for it`), 400)
  if (modelKinds(units).includes(kind)) {
    const { priced, unpriced } = await sellerPricing(db, model, kind, tierOf(options))
    if (priced > 0 && unpriced.length === 0) return null
    const named = unpriced.map((u) => `${u.seller} has no price for ${u.units.join(', ')}`)
    const why = named.length > 0 ? named.join('; ') : 'no seller in its order has a price for every unit it reports'
    const unpricedModel = { model, priced, sellers: unpriced } satisfies UnpricedModel
    return c.json({ ...error(`${model} can't be chosen yet: ${why}`), unpriced: unpricedModel }, 400)
  }
  const wrongKind = {
    ...(step ? { step } : {}),
    model,
    units,
    wants: kind,
    is: modelKinds(units)[0] ?? null,
  } satisfies WrongKind
  return c.json({ ...error(kindRefusal(wrongKind)), wrongKind }, 400)
}

/** Why an AI step, or a kind's default, can't be a model of another kind, in the API's own names. */
function kindRefusal({ step, model, units, wants, is }: WrongKind): string {
  const kind = is ? `is ${KIND_WORDS[is]}` : 'is no kind of model an AI step runs'
  const what = step ?? `The default for ${wants} calls`
  return `${what} runs ${KIND_WORDS[wants]}, and ${model} ${kind}, priced in ${units.join(', ')}`
}

/**
 * Takes a lock on `key` until the transaction ends, so two saves of the same row, even one not made yet,
 * run one after the other and the second sees the first.
 */
async function lockRow(tx: Tx, key: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${key}))`)
}

/** Runs a change: 204, or 409 when what it changes was changed since its page read it. */
async function changedOr(c: Context<Env>, change: () => Promise<void>): Promise<Response> {
  try {
    await change()
    return c.body(null, 204)
  } catch (refused) {
    if (refused instanceof ChangedMeanwhile) return c.json(error(refused.message), 409)
    throw refused
  }
}

/** `name` when the step list has an AI step of that name. */
function stepOf(name: string): string | undefined {
  return Object.hasOwn(STEPS, name) ? name : undefined
}
