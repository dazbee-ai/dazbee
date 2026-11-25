// The usage files an admin uploads for Meta and Pixazo, against Postgres from Docker Compose. The files are
// shaped as each seller's usage page shows its figures (a day and its spend); the days are long past.
import { readFileSync } from 'node:fs'

import { and, eq, inArray } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { aiDailyChecks } from '@dazbee/db'

import { readSellerFile, SellerFileRefused, uploadSellerFile } from './seller-files.ts'
import { db } from './test-ai.ts'

/** Meta's usage export for 19–25 Nov 2026, as its usage page exports it. */
const META_EXPORT = readFileSync(new URL('./fixtures/meta-usage.csv', import.meta.url), 'utf8')

/** A usage file with a day and a spend column, in rupees. */
const META = [
  'Date,Model,Requests,Spend (INR)',
  '2001-04-01,muse-image-1.0,2,1.86',
  '2001-04-02,muse-image-1.0,1,0.93',
].join('\n')

/** Pixazo's report: its transactions, with a dollar amount each. */
const PIXAZO = [
  'Request ID,Model,Status,Created At,Amount',
  'seedream-5-5_a,seedream-5-5,COMPLETED,"Apr 1, 2001 04:57",$0.028',
  'seedream-5-5_b,seedream-5-5,COMPLETED,"Apr 1, 2001 05:01",$0.028',
].join('\r\n')

describe('readSellerFile', () => {
  it('reads Meta’s export: its total spend each day, in rupees', () => {
    const read = readSellerFile('meta', META_EXPORT)
    expect(read.currency).toBe('INR')
    expect(read.days.get('2026-11-25')).toBe(1.86)
    expect(read.days.get('2026-11-24')).toBe(0)
    expect(read.days.size).toBe(7)
  })

  it('adds a file with a day and a spend column up by day', () => {
    const read = readSellerFile('meta', META)
    expect(read.currency).toBe('INR')
    expect(Object.fromEntries(read.days)).toEqual({ '2001-04-01': 1.86, '2001-04-02': 0.93 })
  })

  it('adds a Pixazo report up by day, in dollars', () => {
    const read = readSellerFile('pixazo', PIXAZO)
    expect(read.currency).toBe('USD')
    expect(Object.fromEntries(read.days)).toEqual({ '2001-04-01': 0.056 })
  })

  it('refuses a file of the wrong shape, saying why', () => {
    expect(() => readSellerFile('meta', 'Name,Email\nann,ann@example.com')).toThrow(SellerFileRefused)
    expect(() => readSellerFile('meta', 'Name,Email\nann,ann@example.com')).toThrow(/day column and a cost column/)
    expect(() => readSellerFile('pixazo', '')).toThrow('The file is empty')
  })
})

describe('uploadSellerFile', () => {
  it('keeps the file and checks each day it covers', async () => {
    await db
      .delete(aiDailyChecks)
      .where(and(eq(aiDailyChecks.seller, 'meta'), inArray(aiDailyChecks.day, ['2001-04-01', '2001-04-02'])))
    expect(await uploadSellerFile(db, { seller: 'meta', name: 'usage.csv', text: META }, 'admin')).toEqual({
      days: ['2001-04-01', '2001-04-02'],
    })
    const rows = await db
      .select({ day: aiDailyChecks.day, sellerCost: aiDailyChecks.sellerCost, source: aiDailyChecks.source })
      .from(aiDailyChecks)
      .where(and(eq(aiDailyChecks.seller, 'meta'), inArray(aiDailyChecks.day, ['2001-04-01', '2001-04-02'])))
      .orderBy(aiDailyChecks.day)
    expect(rows).toEqual([
      { day: '2001-04-01', sellerCost: 1_860_000n, source: 'upload' },
      { day: '2001-04-02', sellerCost: 930_000n, source: 'upload' },
    ])
  })
})
