// The migrations that change the AI price list keep what an admin set. Each case makes its own throwaway database
// on the Postgres `DATABASE_URL` names (the compose one locally and in CI).
import type pg from 'pg'
import { describe, expect, it } from 'vitest'

import { MIGRATIONS } from './index.ts'
import { applyMigrations, firstMigrations, freshDatabase, journal, withClient } from './test-migrations.ts'

describe('the migrations of the AI price list', () => {
  it('add the fast tier’s and Terra’s prices and Terra’s sellers, keeping a price and a seller order an admin set', async () => {
    const at = journal.entries.findIndex((e) => e.tag.endsWith('ai-fast-tier-and-terra-prices'))
    expect(at).toBeGreaterThan(0)
    const terra = (client: pg.Client) =>
      client.query(
        `select seller, unit, price_per_million::int as price from ai_prices where model = 'gpt-6.1-terra' and seller = 'openai' order by unit`,
      )
    const sellers = (client: pg.Client) =>
      client.query(`select seller, position from model_sellers where model = 'gpt-6.1-terra' order by position`)
    const seeded = await freshDatabase()
    await applyMigrations(seeded, MIGRATIONS)
    const read = await withClient(seeded, async (client) => ({
      prices: (await terra(client)).rows,
      sellers: (await sellers(client)).rows,
      fast: (
        await client.query(
          `select model, price_per_million::int as price from ai_prices where seller = 'openai' and unit = 'fast-output-token' order by model`,
        )
      ).rows,
    }))
    expect(read.prices).toEqual([
      { seller: 'openai', unit: 'cache-write-input-token', price: 1_250_000 },
      { seller: 'openai', unit: 'cached-input-token', price: 50_000 },
      { seller: 'openai', unit: 'fast-cache-write-input-token', price: 2_500_000 },
      { seller: 'openai', unit: 'fast-cached-input-token', price: 100_000 },
      { seller: 'openai', unit: 'fast-input-token', price: 2_000_000 },
      { seller: 'openai', unit: 'fast-output-token', price: 10_000_000 },
      { seller: 'openai', unit: 'input-token', price: 1_000_000 },
      { seller: 'openai', unit: 'output-token', price: 5_000_000 },
    ])
    expect(read.sellers).toEqual([
      { seller: 'openai', position: 1 },
      { seller: 'zenmux', position: 2 },
      { seller: 'openrouter', position: 3 },
    ])
    expect(read.fast).toEqual([
      { model: 'gpt-6-luna', price: 1_000_000 },
      { model: 'gpt-6.1-terra', price: 10_000_000 },
      { model: 'gpt-6.2-sol', price: 20_000_000 },
    ])
    // An admin priced Terra's input at OpenAI and sold Terra through OpenRouter alone, before the migration.
    const changed = await freshDatabase()
    await applyMigrations(changed, await firstMigrations(at))
    await withClient(changed, async (client) => {
      await client.query(
        `insert into ai_prices (seller, model, unit, currency, price_per_million, fee) values ('openai', 'gpt-6.1-terra', 'input-token', 'USD', 1234567, 0)`,
      )
      await client.query(
        `insert into model_sellers (model, seller, position, seller_model) values ('gpt-6.1-terra', 'openrouter', 1, 'openai/gpt-6.1-terra')`,
      )
    })
    await applyMigrations(changed, MIGRATIONS)
    const kept = await withClient(changed, async (client) => ({
      input: (await terra(client)).rows.find((row) => row.unit === 'input-token'),
      fastInput: (await terra(client)).rows.find((row) => row.unit === 'fast-input-token'),
      sellers: (await sellers(client)).rows,
    }))
    // The fast price follows the admin's own standard price.
    expect(kept.fastInput).toEqual({ seller: 'openai', unit: 'fast-input-token', price: 2_469_134 })
    expect(kept.input).toEqual({ seller: 'openai', unit: 'input-token', price: 1_234_567 })
    expect(kept.sellers).toEqual([{ seller: 'openrouter', position: 1 }])
  }, 60_000)

  it('price the input tokens OpenAI’s text models write to the prompt cache at one and a quarter of their input price, keeping one an admin set', async () => {
    const at = journal.entries.findIndex((e) => e.tag.endsWith('ai-cache-write-prices'))
    expect(at).toBeGreaterThan(0)
    const writes = (client: pg.Client) =>
      client.query(
        `select seller, model, unit, currency, price_per_million::int as price, fee::int as fee from ai_prices where unit like '%cache-write-input-token' order by seller, model, unit`,
      )
    const seeded = await freshDatabase()
    await applyMigrations(seeded, MIGRATIONS)
    // Only OpenAI's text models: its picture model is priced in input tokens too, and no other seller reports writes.
    expect((await withClient(seeded, writes)).rows).toEqual([
      {
        seller: 'openai',
        model: 'gpt-6-luna',
        unit: 'cache-write-input-token',
        currency: 'USD',
        price: 125_000,
        fee: 180_000,
      },
      {
        seller: 'openai',
        model: 'gpt-6-luna',
        unit: 'fast-cache-write-input-token',
        currency: 'USD',
        price: 250_000,
        fee: 180_000,
      },
      {
        seller: 'openai',
        model: 'gpt-6.1-terra',
        unit: 'cache-write-input-token',
        currency: 'USD',
        price: 1_250_000,
        fee: 180_000,
      },
      {
        seller: 'openai',
        model: 'gpt-6.1-terra',
        unit: 'fast-cache-write-input-token',
        currency: 'USD',
        price: 2_500_000,
        fee: 180_000,
      },
      {
        seller: 'openai',
        model: 'gpt-6.2-sol',
        unit: 'cache-write-input-token',
        currency: 'USD',
        price: 2_500_000,
        fee: 180_000,
      },
      {
        seller: 'openai',
        model: 'gpt-6.2-sol',
        unit: 'fast-cache-write-input-token',
        currency: 'USD',
        price: 5_000_000,
        fee: 180_000,
      },
    ])
    // Before the migration an admin priced a text model of their own at OpenAI, set Luna's input price, and listed
    // Sol's cache writes themselves.
    const changed = await freshDatabase()
    await applyMigrations(changed, await firstMigrations(at))
    await withClient(changed, async (client) => {
      await client.query(
        `insert into ai_prices (seller, model, unit, currency, price_per_million, fee) values
          ('openai', 'gpt-own', 'input-token', 'USD', 333333, 0),
          ('openai', 'gpt-own', 'output-token', 'USD', 999999, 0),
          ('openai', 'gpt-6.2-sol', 'cache-write-input-token', 'USD', 7, 0)`,
      )
      await client.query(
        `update ai_prices set price_per_million = 200000 where seller = 'openai' and model = 'gpt-6-luna' and unit = 'input-token'`,
      )
    })
    await applyMigrations(changed, MIGRATIONS)
    const kept = (await withClient(changed, writes)).rows
    const priceOf = (model: string, unit: string) => kept.find((row) => row.model === model && row.unit === unit)?.price
    // A third of a dollar times 1.25 is 416,666.25 millionths, rounded half up.
    expect(priceOf('gpt-own', 'cache-write-input-token')).toBe(416_666)
    expect(priceOf('gpt-own', 'fast-cache-write-input-token')).toBeUndefined()
    expect(priceOf('gpt-6-luna', 'cache-write-input-token')).toBe(250_000)
    expect(priceOf('gpt-6.2-sol', 'cache-write-input-token')).toBe(7)
  }, 60_000)
})
