// The kind defaults and step overrides an admin sets, and what a text step's calls measured, against Postgres
// from Docker Compose: each case's steps, models and calls are of its own.
import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { CUT_OFF, STEPS } from '@dazbee/ai'
import { aiCalls, aiPrices, aiStepModels, modelSellers, newId } from '@dazbee/db'
import { AiKindModelView, AiStepModelView } from '@dazbee/schema'

import { db, run } from '../test-api.ts'
import { measuredSizes } from './ai-model-routes.ts'
import { addAdmin, ask } from './test-early-access.ts'

let admin: Awaited<ReturnType<typeof addAdmin>>

beforeAll(async () => {
  admin = await addAdmin()
})

const step = `test-measured-${run}`
const model = `test-model-${run}`

afterAll(() => {
  Reflect.deleteProperty(STEPS, step)
})

/** A call of the case's step and model, `daysAgo` days ago, with `usage`, done unless `state` says otherwise. */
function callOf(usage: Record<string, number>, { state = 'done', error = null as string | null, daysAgo = 1 } = {}) {
  return {
    id: newId(),
    jobId: newId(),
    workspaceId: 'ws',
    callIndex: 0,
    try: 1,
    attempt: 1,
    step,
    model,
    seller: 'openai',
    state: state as 'done' | 'failed',
    error,
    usage,
    startedAt: new Date(Date.now() - daysAgo * 86_400_000),
  }
}

describe('measuredSizes', () => {
  it('measures a text step’s done and cut-off calls of the last 30 days, cached input counted', async () => {
    STEPS[step] = { kind: 'text', expected: () => ({}), sizes: { input: 100, output: 50, ceiling: 200 } }
    await db.insert(aiCalls).values([
      callOf({ 'input-token': 80, 'cached-input-token': 20, 'output-token': 40 }),
      callOf({ 'input-token': 300, 'output-token': 200 }, { state: 'failed', error: CUT_OFF }),
      // Neither a call that failed another way nor one older than 30 days counts.
      callOf({ 'input-token': 9000, 'output-token': 9000 }, { state: 'failed', error: 'test failure 400' }),
      callOf({ 'input-token': 9000, 'output-token': 9000 }, { daysAgo: 31 }),
    ])
    expect((await measuredSizes(db)).get(`${step}/${model}`)).toEqual({
      calls: 2,
      cutOff: 1,
      input: { average: 200, p95: 290 },
      output: { average: 120, p95: 192 },
    })
  })
})

describe('the model routes', () => {
  it('sets and removes an AI step’s override, and sets a kind’s default, refusing a model of another kind', async () => {
    const own = `${step}-own`
    STEPS[own] = { kind: 'picture', expected: () => ({ picture: 1 }) }
    const at = `/admin/ai/step-models/${own}`
    try {
      expect((await ask(admin.token, 'PUT', at, { model: 'seedream-5.5', since: null })).status).toBe(204)
      const [row] = await db.select().from(aiStepModels).where(eq(aiStepModels.step, own))
      expect(row?.model).toBe('seedream-5.5')
      expect(await ask(admin.token, 'PUT', at, { model: 'seedream-5.5', since: null })).toMatchObject({ status: 409 })
      expect(await ask(admin.token, 'DELETE', at, { since: null })).toMatchObject({ status: 409 })
      expect((await ask(admin.token, 'DELETE', at, { since: row?.updatedAt.toISOString() })).status).toBe(204)
      expect(await db.select().from(aiStepModels).where(eq(aiStepModels.step, own))).toEqual([])
      // An override of the kind's own default is kept as set.
      expect((await ask(admin.token, 'PUT', at, { model: 'muse-image-1.0', since: null })).status).toBe(204)
      const [same] = await db.select().from(aiStepModels).where(eq(aiStepModels.step, own))
      expect(same?.model).toBe('muse-image-1.0')
    } finally {
      Reflect.deleteProperty(STEPS, own)
      await db.delete(aiStepModels).where(eq(aiStepModels.step, own))
    }

    const kinds = AiKindModelView.array().parse((await ask(admin.token, 'GET', '/admin/ai/kind-models')).json)
    const picture = kinds.find((k) => k.kind === 'picture')
    expect(picture).toMatchObject({ model: 'muse-image-1.0', steps: expect.arrayContaining(['flow.draft-fast']) })
    expect(picture?.steps).not.toContain('flow.refine')
    const kindAt = '/admin/ai/kind-models/picture'
    const same = { model: 'muse-image-1.0', since: picture?.updatedAt }
    expect((await ask(admin.token, 'PUT', kindAt, same)).status).toBe(204)
    expect(await ask(admin.token, 'PUT', kindAt, same)).toMatchObject({ status: 409 })
    expect(await ask(admin.token, 'PUT', kindAt, { model: 'gpt-6-luna' })).toMatchObject({
      status: 400,
      json: {
        error: expect.stringMatching(
          /^The default for picture calls runs a picture model, and gpt-6-luna is a text model/,
        ),
        wrongKind: { model: 'gpt-6-luna', wants: 'picture', is: 'text' },
      },
    })
    expect((await ask(admin.token, 'PUT', '/admin/ai/kind-models/video', { model: 'x' })).status).toBe(404)
    const steps = AiStepModelView.array().parse((await ask(admin.token, 'GET', '/admin/ai/step-models')).json)
    expect(steps.find((s) => s.step === 'flow.draft-fast')).toMatchObject({ source: 'kind', updatedAt: null })
    expect(steps.find((s) => s.step === 'flow.refine')).toMatchObject({ source: 'override', model: 'seedream-5.5' })
  })

  it('refuses a kind default whose sellers are priced only in part, or that no seller in its order sells', async () => {
    const partly = `test-model-${run}-partly`
    await db.insert(modelSellers).values({ model: partly, seller: 'pixazo', position: 1 })
    await db.insert(aiPrices).values({
      seller: 'pixazo',
      model: partly,
      unit: 'picture',
      currency: 'USD',
      pricePerMillion: 1_000_000n,
    })
    try {
      expect(await ask(admin.token, 'PUT', '/admin/ai/kind-models/picture', { model: partly })).toMatchObject({
        status: 400,
        json: {
          error: `${partly} can't be chosen yet: pixazo has no price for reference-picture`,
          unpriced: { model: partly, priced: 0, sellers: [{ seller: 'pixazo', units: ['reference-picture'] }] },
        },
      })
      // Its only seller is taken out of its order: no seller is left to take its calls.
      await db.delete(modelSellers).where(eq(modelSellers.model, partly))
      expect(await ask(admin.token, 'PUT', '/admin/ai/kind-models/picture', { model: partly })).toMatchObject({
        status: 400,
        json: { error: `No seller of ${partly} has a price for it` },
      })
    } finally {
      await db.delete(modelSellers).where(eq(modelSellers.model, partly))
      await db.delete(aiPrices).where(eq(aiPrices.model, partly))
    }
  })
})
