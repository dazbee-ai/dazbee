// The admin page's AI routes, against Postgres from Docker Compose: /admin/ai answers anyone but an admin 404;
// for an admin it reads and changes the AI settings, the currency rates, the price list, the seller order and
// each AI step's model, finds a workspace, gives it a gift and reads its grants and ledger, sums AI's costs,
// gives the daily check, takes a seller's usage file, and lists unknown calls, sellers out of money and when
// each uploaded seller was last checked. Models, steps and sellers are the test's own, and the days used are
// long past, so no other test meets them; the one settings row is put back as it was.
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { hold } from '@dazbee/ai'
import { aiCalls, aiDailyChecks, aiPrices, aiStepModels, currencyRates, modelSellers, newId } from '@dazbee/db'
import {
  AiAllowanceView,
  AiCostRow,
  AiGrantView,
  AiPriceView,
  AiSettingsInput,
  AiSettingsView,
  AiStepModelView,
  AiWorkspace,
  CurrencyRateView,
  DailyCheck,
  LastChecked,
  ModelSellersView,
  OutOfMoney,
  SellerFileResult,
  UnknownCalls,
} from '@dazbee/schema'

import { addPerson, addWorkspace, db, run, workspace } from '../test-api.ts'
import { addAdmin, ask, tokenOf } from './test-early-access.ts'

let admin: Awaited<ReturnType<typeof addAdmin>>

/** The test's own model and AI step, and a currency no seller bills in. */
const model = `test-model-${run}`
const step = `test-step-${run}`
const XTS = 'XTS'

beforeAll(async () => {
  admin = await addAdmin()
})

afterAll(async () => {
  await db.delete(aiStepModels).where(eq(aiStepModels.step, step))
  await db.delete(modelSellers).where(eq(modelSellers.model, model))
  await db.delete(aiPrices).where(eq(aiPrices.model, model))
  await db.delete(currencyRates).where(eq(currencyRates.currency, XTS))
})

/** A call of `seller` started at `at`, in `state`, with `error`. */
async function addCall(
  seller: string,
  at: Date,
  state: 'unknown' | 'failed' | 'done',
  error: string | null = null,
  costs: { realCost: bigint; chargeCost: bigint; chargedAt: Date | null } | null = null,
) {
  const job = newId()
  await db.insert(aiCalls).values({
    ...costs,
    id: newId(),
    jobId: job,
    workspaceId: 'ws',
    callIndex: 0,
    try: 1,
    attempt: 1,
    step: 'refine',
    model: 'seedream-5.5',
    seller,
    state,
    error,
    startedAt: at,
  })
}

/** Meta's usage export for two days long past. */
const META = 'Date,Spend (INR)\n2001-05-01,1.86\n2001-05-02,0.93'

describe('/admin/ai', () => {
  it('answers anyone who isn’t an admin 404, as if it didn’t exist', async () => {
    const person = await addPerson([[workspace.id, 'editor']])
    for (const [method, path] of [
      ['GET', '/admin/ai/settings'],
      ['PUT', '/admin/ai/settings'],
      ['GET', '/admin/ai/currency-rates'],
      ['PUT', '/admin/ai/currency-rates/USD'],
      ['GET', '/admin/ai/prices'],
      ['PUT', '/admin/ai/prices'],
      ['DELETE', '/admin/ai/prices?seller=openai&model=x&unit=picture'],
      ['GET', '/admin/ai/model-sellers'],
      ['PUT', '/admin/ai/model-sellers/seedream-5.5'],
      ['GET', '/admin/ai/step-models'],
      ['PUT', '/admin/ai/step-models/refine'],
      ['GET', `/admin/ai/workspaces?q=${workspace.name}`],
      ['GET', `/admin/ai/workspaces/${workspace.id}/allowance`],
      ['POST', `/admin/ai/workspaces/${workspace.id}/gifts`],
      ['GET', '/admin/ai/costs?from=2001-05-01&to=2001-05-02'],
      ['GET', '/admin/ai/daily-checks?from=2001-05-01&to=2001-05-02'],
      ['POST', '/admin/ai/seller-files'],
      ['GET', '/admin/ai/unknown-calls?from=2001-05-01&to=2001-05-02'],
      ['GET', '/admin/ai/out-of-money'],
      ['GET', '/admin/ai/last-checked'],
    ] as const) {
      const sent = method === 'GET' || method === 'DELETE' ? undefined : {}
      expect((await ask(tokenOf(person.id), method, path, sent)).status).toBe(404)
      expect((await ask(null, method, path)).status).toBe(404)
    }
  })

  it('takes a seller’s usage file, checks its days, and gives them in the daily check', async () => {
    await db
      .delete(aiDailyChecks)
      .where(and(eq(aiDailyChecks.seller, 'meta'), inArray(aiDailyChecks.day, ['2001-05-01', '2001-05-02'])))
    const upload = await ask(admin.token, 'POST', '/admin/ai/seller-files', {
      seller: 'meta',
      name: 'usage.csv',
      text: META,
    })
    expect(upload.status).toBe(201)
    expect(SellerFileResult.parse(upload.json)).toEqual({ days: ['2001-05-01', '2001-05-02'] })
    const checks = await ask(admin.token, 'GET', '/admin/ai/daily-checks?from=2001-05-01&to=2001-05-02')
    expect(
      DailyCheck.array()
        .parse(checks.json)
        .filter((c) => c.seller === 'meta'),
    ).toMatchObject([
      { day: '2001-05-02', currency: 'INR', sellerCost: 0.93, source: 'upload' },
      { day: '2001-05-01', currency: 'INR', sellerCost: 1.86, source: 'upload' },
    ])
    const last = LastChecked.array().parse((await ask(admin.token, 'GET', '/admin/ai/last-checked')).json)
    expect(last.find((l) => l.seller === 'meta')?.uploadedAt).not.toBeNull()
  })

  it('refuses a usage file of the wrong shape, saying why, and a range it can’t read', async () => {
    const refused = await ask(admin.token, 'POST', '/admin/ai/seller-files', {
      seller: 'pixazo',
      name: 'x.csv',
      text: 'a,b\n1,2',
    })
    expect(refused).toMatchObject({
      status: 400,
      json: { error: expect.stringMatching(/day column and a cost column/) },
    })
    expect((await ask(admin.token, 'GET', '/admin/ai/daily-checks?from=2001-05-02&to=2001-05-01')).status).toBe(400)
    expect((await ask(admin.token, 'GET', '/admin/ai/unknown-calls?from=yesterday&to=today')).status).toBe(400)
  })

  it('counts unknown calls by seller and day', async () => {
    const seller = `test-unknown-${newId()}`
    await addCall(seller, new Date('2001-05-03T08:00:00Z'), 'unknown')
    await addCall(seller, new Date('2001-05-03T09:00:00Z'), 'unknown')
    const answer = await ask(admin.token, 'GET', '/admin/ai/unknown-calls?from=2001-05-03&to=2001-05-03')
    expect(
      UnknownCalls.array()
        .parse(answer.json)
        .filter((u) => u.seller === seller),
    ).toEqual([{ seller, day: '2001-05-03', calls: 2 }])
  })

  it('names the sellers that said they are out of money in the last day', async () => {
    const seller = `test-broke-${newId()}`
    await addCall(seller, new Date(), 'failed', 'out of money: 402 Insufficient credits')
    const answer = OutOfMoney.array().parse((await ask(admin.token, 'GET', '/admin/ai/out-of-money')).json)
    expect(answer.map((o) => o.seller)).toContain(seller)
  })

  it('reads the settings with today’s spend, and changes them', async () => {
    const before = AiSettingsView.parse((await ask(admin.token, 'GET', '/admin/ai/settings')).json)
    expect(before.stopped).toBe(before.spentToday >= before.spendingStop)
    const settings = AiSettingsInput.parse(before)
    try {
      const changed = { ...settings, layerSplit512: settings.layerSplit512 + 0.25 }
      expect((await ask(admin.token, 'PUT', '/admin/ai/settings', changed)).status).toBe(204)
      expect(AiSettingsView.parse((await ask(admin.token, 'GET', '/admin/ai/settings')).json)).toMatchObject(changed)
      const refused = await ask(admin.token, 'PUT', '/admin/ai/settings', { ...settings, jobLimit: 0 })
      expect(refused).toMatchObject({ status: 400, json: { error: expect.stringMatching(/jobLimit/) } })
    } finally {
      await ask(admin.token, 'PUT', '/admin/ai/settings', settings)
    }
    expect(AiSettingsView.parse((await ask(admin.token, 'GET', '/admin/ai/settings')).json)).toMatchObject(settings)
  })

  it('sets a currency’s rate in rupees, and keeps a rupee at 1', async () => {
    expect((await ask(admin.token, 'PUT', `/admin/ai/currency-rates/${XTS}`, { rate: 2.5 })).status).toBe(204)
    const rates = CurrencyRateView.array().parse((await ask(admin.token, 'GET', '/admin/ai/currency-rates')).json)
    expect(rates.find((r) => r.currency === XTS)?.rate).toBe(2.5)
    expect(rates.find((r) => r.currency === 'INR')?.rate).toBe(1)
    expect((await ask(admin.token, 'PUT', '/admin/ai/currency-rates/INR', { rate: 2 })).status).toBe(400)
    expect((await ask(admin.token, 'PUT', '/admin/ai/currency-rates/usd', { rate: 2 })).status).toBe(400)
  })

  it('sets, changes and takes off a price, in one currency per seller and model', async () => {
    await ask(admin.token, 'PUT', `/admin/ai/currency-rates/${XTS}`, { rate: 2.5 })
    const price = { seller: 'openai', model, unit: 'picture', currency: XTS, pricePerMillion: 40_000.5, fee: 0.18 }
    expect((await ask(admin.token, 'PUT', '/admin/ai/prices', price)).status).toBe(204)
    expect((await ask(admin.token, 'PUT', '/admin/ai/prices', { ...price, pricePerMillion: 41_000 })).status).toBe(204)
    const prices = AiPriceView.array().parse((await ask(admin.token, 'GET', '/admin/ai/prices')).json)
    expect(prices.filter((p) => p.model === model)).toMatchObject([{ ...price, pricePerMillion: 41_000 }])
    const [stored] = await db.select().from(aiPrices).where(eq(aiPrices.model, model))
    expect(stored).toMatchObject({ pricePerMillion: 41_000_000_000n, fee: 180_000 })

    const otherCurrency = await ask(admin.token, 'PUT', '/admin/ai/prices', {
      ...price,
      unit: 'input-token',
      currency: 'USD',
    })
    expect(otherCurrency).toMatchObject({ status: 400, json: { error: expect.stringMatching(/in XTS/) } })
    const noRate = await ask(admin.token, 'PUT', '/admin/ai/prices', { ...price, currency: 'XXX' })
    expect(noRate).toMatchObject({ status: 400, json: { error: expect.stringMatching(/has no rate/) } })

    const path = `/admin/ai/prices?seller=openai&model=${model}&unit=input-token`
    expect((await ask(admin.token, 'PUT', '/admin/ai/prices', { ...price, unit: 'input-token' })).status).toBe(204)
    expect((await ask(admin.token, 'DELETE', path)).status).toBe(204)
    expect((await ask(admin.token, 'DELETE', path)).status).toBe(404)
  })

  it('sets the order of a model’s sellers, each once', async () => {
    const order = {
      sellers: [
        { seller: 'zenmux', sellerModel: 'test/its-name' },
        { seller: 'openai', sellerModel: null },
      ],
    }
    expect((await ask(admin.token, 'PUT', `/admin/ai/model-sellers/${model}`, order)).status).toBe(204)
    const reversed = { sellers: [...order.sellers].reverse() }
    expect((await ask(admin.token, 'PUT', `/admin/ai/model-sellers/${model}`, reversed)).status).toBe(204)
    const all = ModelSellersView.array().parse((await ask(admin.token, 'GET', '/admin/ai/model-sellers')).json)
    expect(all.find((m) => m.model === model)).toEqual({ model, ...reversed })
    const twice = {
      sellers: [
        { seller: 'openai', sellerModel: null },
        { seller: 'openai', sellerModel: null },
      ],
    }
    expect((await ask(admin.token, 'PUT', `/admin/ai/model-sellers/${model}`, twice)).status).toBe(400)
  })

  it('sets an AI step’s model, only to a model a seller has a price for', async () => {
    await ask(admin.token, 'PUT', `/admin/ai/currency-rates/${XTS}`, { rate: 2.5 })
    await ask(admin.token, 'PUT', '/admin/ai/prices', {
      seller: 'openai',
      model,
      unit: 'picture',
      currency: XTS,
      pricePerMillion: 1,
      fee: 0,
    })
    await ask(admin.token, 'PUT', `/admin/ai/model-sellers/${model}`, {
      sellers: [{ seller: 'openai', sellerModel: null }],
    })
    await db.insert(aiStepModels).values({ step, model: 'seedream-5.5' })
    const changed = await ask(admin.token, 'PUT', `/admin/ai/step-models/${step}`, {
      model,
      options: { quality: 'low' },
    })
    expect(changed.status).toBe(204)
    const [row] = await db.select().from(aiStepModels).where(eq(aiStepModels.step, step))
    expect(row).toMatchObject({ model, options: { quality: 'low' } })
    const unsold = await ask(admin.token, 'PUT', `/admin/ai/step-models/${step}`, { model: 'no-such-model' })
    expect(unsold).toMatchObject({ status: 400, json: { error: expect.stringMatching(/no-such-model/) } })
    expect((await ask(admin.token, 'PUT', `/admin/ai/step-models/no-step-${run}`, { model })).status).toBe(404)
    const steps = AiStepModelView.array().parse((await ask(admin.token, 'GET', '/admin/ai/step-models')).json)
    expect(steps.map((s) => s.step)).toEqual(expect.arrayContaining(['round-plan', 'draft-fast', 'layer-split']))
    expect(steps.map((s) => s.step)).not.toContain(step)
  })

  it('finds a workspace by its name or a member’s email', async () => {
    const team = await addWorkspace(`Gift Team ${run}`)
    const owner = await addPerson([[team.id, 'owner']])
    const byName = AiWorkspace.array().parse(
      (await ask(admin.token, 'GET', `/admin/ai/workspaces?q=${encodeURIComponent(`gift team ${run}`)}`)).json,
    )
    expect(byName).toEqual([{ id: team.id, name: team.name, emails: [owner.email] }])
    const byEmail = AiWorkspace.array().parse(
      (await ask(admin.token, 'GET', `/admin/ai/workspaces?q=${encodeURIComponent(owner.email.toUpperCase())}`)).json,
    )
    expect(byEmail.map((w) => w.id)).toEqual([team.id])
    expect((await ask(admin.token, 'GET', '/admin/ai/workspaces?q=a')).status).toBe(400)
  })

  it('gives a gift at the day’s usage rate, and shows the grants and the ledger', async () => {
    const team = await addWorkspace(`Gifted ${run}`)
    const settings = AiSettingsView.parse((await ask(admin.token, 'GET', '/admin/ai/settings')).json)
    const gift = await ask(admin.token, 'POST', `/admin/ai/workspaces/${team.id}/gifts`, {
      amount: 500,
      expiresOn: '2099-12-31',
      note: 'For testing',
    })
    expect(gift.status).toBe(201)
    expect(AiGrantView.parse(gift.json)).toMatchObject({
      source: 'gift',
      amount: 500,
      left: 500,
      usageRate: settings.usageRate,
      expiresAt: '2099-12-31T18:30:00.000Z',
      live: true,
      note: 'For testing',
      givenBy: admin.email,
    })
    const job = newId()
    await db.transaction((tx) => hold(tx, { workspace: team.id, job, cost: 100_000_000n }))
    const allowance = AiAllowanceView.parse(
      (await ask(admin.token, 'GET', `/admin/ai/workspaces/${team.id}/allowance`)).json,
    )
    const held = 100 * settings.usageRate
    expect(allowance).toMatchObject({ workspace: { id: team.id }, left: 500 - held })
    expect(allowance.grants).toMatchObject([{ amount: 500, left: 500 - held }])
    expect(allowance.ledger).toMatchObject([{ jobId: job, kind: 'hold', amount: -held, callId: null }])

    const past = await ask(admin.token, 'POST', `/admin/ai/workspaces/${team.id}/gifts`, {
      amount: 5,
      expiresOn: '2001-01-01',
    })
    expect(past.status).toBe(400)
    expect(
      (await ask(admin.token, 'POST', `/admin/ai/workspaces/${team.id}/gifts`, { amount: 0, expiresOn: '2099-01-01' }))
        .status,
    ).toBe(400)
    const none = `/admin/ai/workspaces/no-such-${run}`
    expect((await ask(admin.token, 'POST', `${none}/gifts`, { amount: 5, expiresOn: '2099-01-01' })).status).toBe(404)
    expect((await ask(admin.token, 'GET', `${none}/allowance`)).status).toBe(404)
  })

  it('sums the real cost and the charges of AI calls by day, AI step, model and seller', async () => {
    const seller = `test-costs-${newId()}`
    const charged = (realCost: bigint, chargeCost: bigint) => ({ realCost, chargeCost, chargedAt: new Date() })
    await addCall(seller, new Date('2001-05-04T08:00:00Z'), 'done', null, charged(1_500_000n, 4_000_000n))
    await addCall(seller, new Date('2001-05-04T09:00:00Z'), 'done', null, charged(2_000_000n, 4_000_000n))
    await addCall(seller, new Date('2001-05-04T10:00:00Z'), 'unknown')
    await addCall(seller, new Date('2001-05-05T10:00:00Z'), 'done', null, {
      realCost: 250_000n,
      chargeCost: 250_000n,
      chargedAt: null,
    })
    const answer = await ask(admin.token, 'GET', '/admin/ai/costs?from=2001-05-04&to=2001-05-05')
    expect(
      AiCostRow.array()
        .parse(answer.json)
        .filter((row) => row.seller === seller),
    ).toEqual([
      {
        day: '2001-05-05',
        step: 'refine',
        model: 'seedream-5.5',
        seller,
        calls: 1,
        done: 1,
        realCost: 0.25,
        charged: 0,
      },
      {
        day: '2001-05-04',
        step: 'refine',
        model: 'seedream-5.5',
        seller,
        calls: 3,
        done: 2,
        realCost: 3.5,
        charged: 8,
      },
    ])
    expect((await ask(admin.token, 'GET', '/admin/ai/costs?from=2001-01-01&to=2001-12-31')).status).toBe(400)
  })
})
