// Pricing usage from the price list, to the millionth.
import { describe, expect, it } from 'vitest'

import { currencyRate, priceRows, pricesOf, priceUsage } from './price-list.ts'
import { addPrices, db, DOLLAR, newSeller, RUPEE } from './test-ai.ts'

describe('priceUsage', () => {
  it('prices tokens with GST at the dollar’s rate', async () => {
    const seller = newSeller('openai')
    await addPrices(seller, 'gpt', [
      { unit: 'input-token', pricePerMillion: 1_000_000n, fee: 180_000 },
      { unit: 'output-token', pricePerMillion: 2_000_000n, fee: 180_000 },
    ])
    // 1,000 tokens at US$1 a million and 500 at US$2 is US$0.002; with 18% GST at ₹96.31 it is ₹0.2272916.
    expect(await priceUsage(db, seller, 'gpt', { 'input-token': 1000, 'output-token': 500 })).toEqual({
      currency: 'USD',
      sellerCost: 2_000n,
      realCost: 227_292n,
    })
  })

  it('fails for a unit with no price, or a model with none', async () => {
    const seller = newSeller('openai')
    await addPrices(seller, 'gpt', [{ unit: 'input-token', pricePerMillion: 1_000_000n }])
    await expect(priceUsage(db, seller, 'gpt', { 'output-token': 1 })).rejects.toThrow('no price for output-token')
    await expect(priceUsage(db, seller, 'other', { 'input-token': 1 })).rejects.toThrow('no price')
  })
})

describe('currencyRate', () => {
  it('gives a currency’s rate in millionths of a rupee, and fails for one with none', async () => {
    expect(await currencyRate(db, 'INR')).toBe(RUPEE)
    await expect(currencyRate(db, 'XXX')).rejects.toThrow('no rate for XXX')
  })
})

describe('pricesOf', () => {
  it('gives a model’s price rows at a seller, and none for a model it doesn’t sell', async () => {
    const seller = newSeller('zenmux')
    await addPrices(seller, 'gpt', [{ unit: 'input-token', pricePerMillion: 5n, fee: 10 }])
    expect(await pricesOf(db, seller, 'gpt')).toEqual([
      { unit: 'input-token', currency: 'USD', pricePerMillion: 5n, fee: 10 },
    ])
    expect(await pricesOf(db, seller, 'other')).toEqual([])
  })
})

describe('priceRows', () => {
  it('prices pictures and reference pictures in rupees', () => {
    const rows = [
      { unit: 'picture' as const, currency: 'INR', pricePerMillion: 3_000_000n * RUPEE, fee: 0 },
      { unit: 'reference-picture' as const, currency: 'INR', pricePerMillion: 500_000n * RUPEE, fee: 0 },
    ]
    // One picture at ₹3 and two reference pictures at ₹0.50.
    expect(priceRows(rows, RUPEE, { picture: 1, 'reference-picture': 2 }, 'seedream')).toEqual({
      currency: 'INR',
      sellerCost: 4n * RUPEE,
      realCost: 4n * RUPEE,
    })
  })

  it('prices GPU seconds, CPU and memory to the millionth, rounding once', () => {
    const rows = [
      { unit: 'gpu-second' as const, currency: 'USD', pricePerMillion: 1_097_000_000n, fee: 0 },
      { unit: 'cpu-core-second' as const, currency: 'USD', pricePerMillion: 13_100_000n, fee: 0 },
      { unit: 'memory-gib-second' as const, currency: 'USD', pricePerMillion: 2_220_000n, fee: 0 },
    ]
    // 17.5 s of an H100 at US$0.001097, 35 core-seconds at US$0.0000131 and 280 GiB-seconds at US$0.00000222
    // is US$0.0202776, which is ₹1.952935656 at ₹96.31.
    const usage = { 'gpu-second': 17.5, 'cpu-core-second': 35, 'memory-gib-second': 280 }
    expect(priceRows(rows, DOLLAR, usage, 'ming')).toEqual({
      currency: 'USD',
      sellerCost: 20_278n,
      realCost: 1_952_936n,
    })
  })

  it('refuses prices in two currencies', () => {
    const rows = [
      { unit: 'picture' as const, currency: 'INR', pricePerMillion: 1n, fee: 0 },
      { unit: 'reference-picture' as const, currency: 'USD', pricePerMillion: 1n, fee: 0 },
    ]
    expect(() => priceRows(rows, RUPEE, { picture: 1 }, 'mixed')).toThrow('more than one currency')
  })
})
