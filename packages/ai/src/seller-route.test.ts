// Which sellers can take a model's call, and which kinds of call a model can take.
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { modelSellers } from '@dazbee/db'

import { modelKinds, routeModel, sellerPricing } from './seller-route.ts'
import { openaiSeller } from './sellers/openai.ts'
import { useSeller } from './sellers/seller.ts'
import { testSeller } from './sellers/test-sellers.ts'
import { addFunction, db, newSeller, type TestPrice, TOKEN_PRICES } from './test-ai.ts'

/** A price for every unit a call's usage can name. */
const EVERY_PRICE: TestPrice[] = [
  { unit: 'input-token', pricePerMillion: 1_000_000n },
  { unit: 'output-token', pricePerMillion: 2_000_000n },
  { unit: 'image-output-token', pricePerMillion: 40_000_000n },
  { unit: 'picture', pricePerMillion: 40_000_000_000n },
  { unit: 'reference-picture', pricePerMillion: 10_000_000_000n },
  { unit: 'gpu-second', pricePerMillion: 1_097_000_000n },
]

describe('modelKinds', () => {
  it('reads a model’s kind from the units it is priced in', () => {
    expect(modelKinds(['picture'])).toEqual(['picture'])
    expect(modelKinds(['input-token', 'image-input-token', 'image-output-token'])).toEqual(['picture'])
    expect(modelKinds(['gpu-second', 'cpu-core-second', 'memory-gib-second'])).toEqual(['layer-split'])
    expect(modelKinds(['input-token', 'cached-input-token', 'output-token'])).toEqual(['text'])
    expect(modelKinds(['input-token', 'output-token', 'fast-input-token', 'fast-output-token'])).toEqual(['text'])
    expect(modelKinds(['reference-picture'])).toEqual([])
    expect(modelKinds([])).toEqual([])
  })
})

describe('routeModel', () => {
  it('gives the sellers that can take a model’s call, in order, skipping one with no adapter or price', async () => {
    const first = testSeller(newSeller('a'))
    const second = testSeller(newSeller('b'))
    const { model } = await addFunction([first, { seller: newSeller('gone') }, second])
    const call = { model, kind: 'text' as const, settings: { effort: 'low' } }
    const route = await routeModel(db, call)
    expect(route).toMatchObject({ model, settings: { effort: 'low' } })
    expect(route.sellers.map((s) => s.seller)).toEqual([first.seller, second.seller])
    expect((await routeModel(db, call, [second.seller])).sellers.map((s) => s.seller)).toEqual([second.seller])
    await db.update(modelSellers).set({ sellerModel: 'its-own-name' }).where(eq(modelSellers.seller, second.seller))
    expect((await routeModel(db, call, [second.seller])).sellers[0]?.sellerModel).toBe('its-own-name')
  })

  it('skips a seller with no price for the fast tier on a call whose settings ask for it', async () => {
    useSeller(openaiSeller('test-key'))
    const { model } = await addFunction([
      { seller: 'openai', prices: [...TOKEN_PRICES, { unit: 'cached-input-token', pricePerMillion: 100_000n }] },
    ])
    const sellers = async (settings: Record<string, unknown>) =>
      (await routeModel(db, { model, kind: 'text', settings })).sellers.map((s) => s.seller)
    expect(await sellers({})).toEqual(['openai'])
    expect(await sellers({ tier: 'fast' })).toEqual([])
  })
})

describe('sellerPricing', () => {
  it('counts the sellers priced for a model, and names the units a seller priced in part has no price for', async () => {
    const priced = testSeller(newSeller('priced'))
    const unpriced = { seller: 'pixazo', prices: [{ unit: 'picture' as const, pricePerMillion: 1_000_000n }] }
    const both = await addFunction([unpriced, { seller: priced.seller, adapter: priced, prices: EVERY_PRICE }], {
      kind: 'picture',
    })
    expect(await sellerPricing(db, both.model, 'picture')).toEqual({
      priced: 1,
      unpriced: [{ seller: 'pixazo', units: ['reference-picture'] }],
    })
  })
})
