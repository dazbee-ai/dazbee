// The admin page's AI routes, under /admin/ai, for admins only, as if they didn't exist for anyone else: the
// AI settings with today's spend, the currency rates, the price list, each model's seller order and each AI
// step's model, which must be a priced model of the step's kind; finding a workspace, giving it a gift and reading its grants and ledger; AI's costs by day, AI
// step, model and seller; the daily check over a range of days, a seller's uploaded usage file, unknown calls
// by seller and day, the sellers that said they are out of money in the last day, and when the sellers
// checked from uploads were last checked. Money comes and goes as decimals of rupees or of the seller's
// currency.
import { and, asc, count, desc, eq, gte, like, lte, max, sql } from 'drizzle-orm'
import { type Context, Hono } from 'hono'

import {
  aiSettingsOf,
  lastChecked,
  modelKinds,
  SellerFileRefused,
  spentToday,
  stepDef,
  STEPS,
  stepTakes,
  uploadSellerFile,
} from '@dazbee/ai'
import { aiCalls, aiDailyChecks, aiSettings, aiStepModels, type Db } from '@dazbee/db'
import {
  AI_STEPS,
  type AiCostRow,
  AiPriceInput,
  AiSettingsInput,
  type AiSettingsView,
  AiStepModelInput,
  type AiStepModelView,
  type CallKind,
  CurrencyCode,
  CurrencyRateInput,
  type DailyCheck,
  fromMillionths,
  GiftInput,
  type LastChecked,
  ModelName,
  ModelSellersInput,
  type OutOfMoney,
  type SellerFileResult,
  SellerFileUpload,
  toMillionths,
  type UnknownCalls,
  UsageUnit,
  UtcDay,
  type WrongKind,
} from '@dazbee/schema'

import { body, type Env, error } from '../http.ts'
import type { SessionOf } from '../sign-in/session.ts'
import { type Admins, requireAdmin } from './admins.ts'
import { allowanceOf, findWorkspaces, GiftRefused, giveGift } from './ai-allowance.ts'
import { ChangedMeanwhile, checkSince } from './ai-changed-meanwhile.ts'
import {
  listCurrencyRates,
  listModelSellers,
  listPrices,
  pricedUnits,
  PriceListRefused,
  removePrice,
  setCurrencyRate,
  setModelSellers,
  setPrice,
} from './ai-price-list.ts'

/** An AI step with no model row to change. */
class NoSuchStep extends Error {
  constructor() {
    super('No such AI step')
    this.name = 'NoSuchStep'
  }
}

/** How many days a range may span at most. */
const MAX_DAYS = 92

/** A kind of model as a refusal names it, by the kind of call it takes. */
const KIND_WORDS: Record<CallKind, string> = {
  text: 'a text model',
  picture: 'a picture model',
  'picture-edit': 'a picture model',
  'layer-split': 'a GPU model',
}

export function aiAdminRoutes({ db, sessionOf, admins }: { db: Db; sessionOf: SessionOf; admins: Admins }): Hono<Env> {
  const app = new Hono<Env>()
  const badRange = (c: Context<Env>) =>
    c.json(error(`Give from and to as YYYY-MM-DD, at most ${MAX_DAYS} days apart`), 400)

  app.use('/admin/ai/*', requireAdmin(db, sessionOf, admins))

  app.get('/admin/ai/settings', async (c) => c.json(await settingsView(db)))

  app.put('/admin/ai/settings', async (c) => {
    const input = await body(c.req.raw, AiSettingsInput)
    if (input instanceof Response) return input
    return refusedOr(c, () =>
      db.transaction(async (tx) => {
        const [stored] = await tx
          .select({ updatedAt: aiSettings.updatedAt })
          .from(aiSettings)
          .where(eq(aiSettings.id, 1))
          .for('update')
        checkSince(stored?.updatedAt, input.since)
        await tx
          .update(aiSettings)
          .set({
            usageRate: toMillionths(input.usageRate),
            spendingStop: toMillionths(input.spendingStop),
            jobLimit: input.jobLimit,
            layerSplit512: toMillionths(input.layerSplit512),
            layerSplit1024: toMillionths(input.layerSplit1024),
            updatedAt: new Date(),
          })
          .where(eq(aiSettings.id, 1))
      }),
    )
  })

  app.get('/admin/ai/currency-rates', async (c) => c.json(await listCurrencyRates(db)))

  app.put('/admin/ai/currency-rates/:currency', async (c) => {
    const currency = CurrencyCode.safeParse(c.req.param('currency'))
    if (!currency.success) return c.json(error('Name a currency by its three-letter code, such as USD'), 400)
    const input = await body(c.req.raw, CurrencyRateInput)
    if (input instanceof Response) return input
    return refusedOr(c, () => setCurrencyRate(db, currency.data, input.rate, input.since))
  })

  app.get('/admin/ai/prices', async (c) => c.json(await listPrices(db)))

  app.put('/admin/ai/prices', async (c) => {
    const input = await body(c.req.raw, AiPriceInput)
    if (input instanceof Response) return input
    return refusedOr(c, () => setPrice(db, input))
  })

  app.delete('/admin/ai/prices', async (c) => {
    const unit = UsageUnit.safeParse(c.req.query('unit'))
    const seller = c.req.query('seller')
    const model = c.req.query('model')
    if (!unit.success || !seller || !model) return c.json(error('Give the seller, model and unit'), 400)
    if (!(await removePrice(db, { seller, model, unit: unit.data }))) return c.json(error('No such price'), 404)
    return c.body(null, 204)
  })

  app.get('/admin/ai/model-sellers', async (c) => c.json(await listModelSellers(db)))

  app.put('/admin/ai/model-sellers/:model', async (c) => {
    const model = ModelName.safeParse(c.req.param('model'))
    if (!model.success) return c.json(error('Name the model in lower case, such as seedream-5.5'), 400)
    const input = await body(c.req.raw, ModelSellersInput)
    if (input instanceof Response) return input
    return refusedOr(c, () => setModelSellers(db, model.data, input))
  })

  app.get('/admin/ai/step-models', async (c) => {
    const order = (step: string) => (AI_STEPS as readonly string[]).indexOf(step)
    const [rows, units] = await Promise.all([
      db.select().from(aiStepModels).orderBy(asc(aiStepModels.step)),
      pricedUnits(db),
    ])
    return c.json(
      rows
        .filter((row) => order(row.step) >= 0)
        .sort((a, b) => order(a.step) - order(b.step))
        .map((row) => ({
          step: row.step,
          kind: stepDef(row.step).kind,
          model: row.model,
          models: [...units].flatMap(([model, priced]) => (stepTakes(row.step, priced) ? [model] : [])),
          options: row.options,
          updatedAt: row.updatedAt.toISOString(),
        })) satisfies AiStepModelView[],
    )
  })

  app.put('/admin/ai/step-models/:step', async (c) => {
    const step = c.req.param('step')
    if (!Object.hasOwn(STEPS, step)) return c.json(error('No such AI step'), 404)
    const input = await body(c.req.raw, AiStepModelInput)
    if (input instanceof Response) return input
    const units = (await pricedUnits(db)).get(input.model)
    if (!units) return c.json(error(`No seller of ${input.model} has a price for it`), 400)
    if (!stepTakes(step, units)) {
      const wrongKind = {
        step,
        model: input.model,
        units,
        wants: stepDef(step).kind,
        is: modelKinds(units)[0] ?? null,
      } satisfies WrongKind
      return c.json({ ...error(kindRefusal(wrongKind)), wrongKind }, 400)
    }
    return refusedOr(c, () =>
      db.transaction(async (tx) => {
        const [stored] = await tx
          .select({ updatedAt: aiStepModels.updatedAt })
          .from(aiStepModels)
          .where(eq(aiStepModels.step, step))
          .for('update')
        if (!stored) throw new NoSuchStep()
        checkSince(stored.updatedAt, input.since)
        await tx
          .update(aiStepModels)
          .set({ model: input.model, options: input.options, updatedAt: new Date() })
          .where(eq(aiStepModels.step, step))
      }),
    )
  })

  app.get('/admin/ai/workspaces', async (c) => {
    const text = c.req.query('q')?.trim() ?? ''
    if (text.length < 2 || text.length > 200) return c.json(error('Give 2 to 200 characters to look for'), 400)
    return c.json(await findWorkspaces(db, text))
  })

  app.get('/admin/ai/workspaces/:workspaceId/allowance', async (c) => {
    const allowance = await allowanceOf(db, c.req.param('workspaceId'))
    return allowance ? c.json(allowance) : c.json(error('No such workspace'), 404)
  })

  app.post('/admin/ai/workspaces/:workspaceId/gifts', async (c) => {
    const input = await body(c.req.raw, GiftInput)
    if (input instanceof Response) return input
    try {
      const grant = await giveGift(db, c.req.param('workspaceId'), input, c.var.session.userId)
      return grant ? c.json(grant, 201) : c.json(error('No such workspace'), 404)
    } catch (refused) {
      if (refused instanceof GiftRefused) return c.json(error(refused.message), 400)
      throw refused
    }
  })

  app.get('/admin/ai/costs', async (c) => {
    const range = rangeOf(c.req.query('from'), c.req.query('to'))
    if (!range) return badRange(c)
    const day = sql<string>`to_char(${aiCalls.startedAt} at time zone 'UTC', 'YYYY-MM-DD')`
    const rows = await db
      .select({
        day,
        step: aiCalls.step,
        model: aiCalls.model,
        seller: aiCalls.seller,
        calls: count(),
        done: sql<number>`(count(*) filter (where ${aiCalls.state} = 'done'))::int`,
        realCost: sql<string>`coalesce(sum(${aiCalls.realCost}), 0)`,
        charged: sql<string>`coalesce(sum(${aiCalls.chargeCost}) filter (where ${aiCalls.chargedAt} is not null), 0)`,
      })
      .from(aiCalls)
      .where(inRange(range))
      .groupBy(day, aiCalls.step, aiCalls.model, aiCalls.seller)
      .orderBy(desc(day), aiCalls.step, aiCalls.model, aiCalls.seller)
    return c.json(
      rows.map((row) => ({
        ...row,
        realCost: fromMillionths(BigInt(row.realCost)),
        charged: fromMillionths(BigInt(row.charged)),
      })) satisfies AiCostRow[],
    )
  })

  app.get('/admin/ai/daily-checks', async (c) => {
    const range = rangeOf(c.req.query('from'), c.req.query('to'))
    if (!range) return badRange(c)
    const rows = await db
      .select()
      .from(aiDailyChecks)
      .where(and(gte(aiDailyChecks.day, range.from), lte(aiDailyChecks.day, range.to)))
      .orderBy(desc(aiDailyChecks.day), aiDailyChecks.seller)
    return c.json(
      rows.map((row) => ({
        seller: row.seller,
        day: row.day,
        currency: row.currency,
        ourCost: fromMillionths(row.ourCost),
        sellerCost: row.sellerCost === null ? null : fromMillionths(row.sellerCost),
        outsideCalls: row.outsideCalls === null ? null : fromMillionths(row.outsideCalls),
        state: row.state,
        source: row.source,
        checkedAt: row.checkedAt.toISOString(),
      })) satisfies DailyCheck[],
    )
  })

  app.post('/admin/ai/seller-files', async (c) => {
    const input = await body(c.req.raw, SellerFileUpload)
    if (input instanceof Response) return input
    try {
      return c.json((await uploadSellerFile(db, input, c.var.session.userId)) satisfies SellerFileResult, 201)
    } catch (refused) {
      if (refused instanceof SellerFileRefused) return c.json(error(refused.message), 400)
      throw refused
    }
  })

  app.get('/admin/ai/unknown-calls', async (c) => {
    const range = rangeOf(c.req.query('from'), c.req.query('to'))
    if (!range) return badRange(c)
    const day = sql<string>`to_char(${aiCalls.startedAt} at time zone 'UTC', 'YYYY-MM-DD')`
    const rows = await db
      .select({ seller: aiCalls.seller, day, calls: count() })
      .from(aiCalls)
      .where(and(eq(aiCalls.state, 'unknown'), inRange(range)))
      .groupBy(aiCalls.seller, day)
      .orderBy(desc(day), aiCalls.seller)
    return c.json(rows satisfies UnknownCalls[])
  })

  app.get('/admin/ai/out-of-money', async (c) => {
    const rows = await db
      .select({ seller: aiCalls.seller, at: max(aiCalls.startedAt) })
      .from(aiCalls)
      .where(and(like(aiCalls.error, 'out of money:%'), gte(aiCalls.startedAt, new Date(Date.now() - 86_400_000))))
      .groupBy(aiCalls.seller)
    return c.json(
      rows.flatMap((row) => (row.at ? [{ seller: row.seller, at: row.at.toISOString() }] : [])) satisfies OutOfMoney[],
    )
  })

  app.get('/admin/ai/last-checked', async (c) =>
    c.json(
      (await lastChecked(db)).map((row) => ({
        seller: row.seller,
        day: row.day,
        uploadedAt: row.uploadedAt?.toISOString() ?? null,
      })) satisfies LastChecked[],
    ),
  )

  return app
}

/** The AI settings in rupees, with today's real cost of AI calls and whether it reached the spending stop. */
async function settingsView(db: Db): Promise<AiSettingsView> {
  const [settings, spent] = await Promise.all([aiSettingsOf(db), spentToday(db)])
  return {
    usageRate: fromMillionths(settings.usageRate),
    spendingStop: fromMillionths(settings.spendingStop),
    jobLimit: settings.jobLimit,
    layerSplit512: fromMillionths(settings.layerSplit512),
    layerSplit1024: fromMillionths(settings.layerSplit1024),
    spentToday: fromMillionths(spent),
    stopped: spent >= settings.spendingStop,
    updatedAt: settings.updatedAt.toISOString(),
  }
}

/**
 * Runs a change: 204; 400 saying why the price list refused it; 404 for an AI step with no model row; or 409
 * when what it changes was changed since its page read it.
 */
async function refusedOr(c: Context<Env>, change: () => Promise<void>): Promise<Response> {
  try {
    await change()
    return c.body(null, 204)
  } catch (refused) {
    if (refused instanceof PriceListRefused) return c.json(error(refused.message), 400)
    if (refused instanceof ChangedMeanwhile) return c.json(error(refused.message), 409)
    if (refused instanceof NoSuchStep) return c.json(error(refused.message), 404)
    throw refused
  }
}

/** Why an AI step can't run a model of another kind, in the API's own names. */
function kindRefusal({ step, model, units, wants, is }: WrongKind): string {
  const kind = is ? `is ${KIND_WORDS[is]}` : 'is no kind of model an AI step runs'
  return `${step} runs ${KIND_WORDS[wants]}, and ${model} ${kind}, priced in ${units.join(', ')}`
}

/** AI calls started on the range's UTC days. */
function inRange(range: { from: string; to: string }) {
  return and(
    gte(aiCalls.startedAt, new Date(`${range.from}T00:00:00Z`)),
    lte(aiCalls.startedAt, new Date(`${range.to}T23:59:59.999Z`)),
  )
}

/** The range `from` to `to`, both UTC days, `to` not before `from` and at most `MAX_DAYS` apart; null otherwise. */
function rangeOf(from: string | undefined, to: string | undefined): { from: string; to: string } | null {
  const start = UtcDay.safeParse(from)
  const end = UtcDay.safeParse(to)
  if (!start.success || !end.success) return null
  const days = (Date.parse(end.data) - Date.parse(start.data)) / 86_400_000
  return days < 0 || days > MAX_DAYS ? null : { from: start.data, to: end.data }
}
