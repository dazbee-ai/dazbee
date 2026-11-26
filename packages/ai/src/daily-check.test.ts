// The daily check against Postgres from Docker Compose: each case's calls are under a seller name no other
// case uses, on a day long past, with the seller's figure given by a stand-in report.
import { and, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { aiCalls, aiDailyChecks, newId } from '@dazbee/db'

import { checkDay, type CostReport, daysBefore, ourCost, runDailyCheck } from './daily-check.ts'
import { modalCostReportOn } from './sellers/modal.ts'
import { openaiCostReport } from './sellers/openai.ts'
import { openrouterCostReport } from './sellers/openrouter.ts'
import { fakeFetch } from './sellers/test-fetch.ts'
import { zenmuxCostReport } from './sellers/zenmux.ts'
import { db, newSeller } from './test-ai.ts'

/** The day the cases' calls were made. */
const DAY = '2001-03-04'

/** Writes calls of `seller` on `day` costing `costs` dollars each, done unless `state` says otherwise. */
async function calls(seller: string, costs: number[], day = DAY, state: 'done' | 'failed' = 'done') {
  const job = newId()
  await db.insert(aiCalls).values(
    costs.map((cost, i) => ({
      id: `${job}-${i}`,
      jobId: job,
      workspaceId: 'ws',
      callIndex: i,
      try: 1,
      attempt: 1,
      feature: 'calls',
      function: 'test-function',
      preset: 'test',
      kind: 'text' as const,
      model: 'm',
      seller,
      state,
      currency: 'USD',
      sellerCost: BigInt(Math.round(cost * 1e6)),
      startedAt: new Date(`${day}T10:00:00Z`),
    })),
  )
}

async function rowOf(seller: string, day = DAY) {
  const [row] = await db
    .select()
    .from(aiDailyChecks)
    .where(and(eq(aiDailyChecks.seller, seller), eq(aiDailyChecks.day, day)))
  return row
}

describe('ourCost', () => {
  it('counts a call cut off at its ceiling, which the seller billed, and no other failed call', async () => {
    const seller = newSeller('cut-off')
    await calls(seller, [0.5])
    await calls(seller, [0.25], DAY, 'failed')
    // A failed call the seller never billed has no seller cost.
    await db.insert(aiCalls).values({
      id: newId(),
      jobId: newId(),
      workspaceId: 'ws',
      callIndex: 0,
      try: 1,
      attempt: 1,
      feature: 'calls',
      function: 'test-function',
      preset: 'test',
      kind: 'text' as const,
      model: 'm',
      seller,
      state: 'failed',
      startedAt: new Date(`${DAY}T10:00:00Z`),
    })
    expect(await ourCost(db, seller, DAY)).toEqual({ cost: 750_000n, currency: 'USD' })
  })
})

describe('runDailyCheck', () => {
  it('checks each seller for each of the three days before, leaving a seller not reporting yet waiting', async () => {
    const seller = newSeller('report')
    const today = new Date('2001-03-07T06:00:00Z')
    const report: CostReport = async (day) => (day === '2001-03-04' ? { currency: 'USD', cost: 0 } : null)
    const checked = await runDailyCheck(db, new Map([[seller, report]]), today)
    expect(checked).toEqual([
      { seller, day: '2001-03-04', state: 'ok' },
      { seller, day: '2001-03-05', state: 'waiting' },
      { seller, day: '2001-03-06', state: 'waiting' },
    ])
  })
})

describe('checkDay', () => {
  it('marks a day that matches the seller ok', async () => {
    const seller = newSeller('match')
    await calls(seller, [1.2, 0.3])
    expect((await checkDay(db, seller, DAY, { currency: 'USD', cost: 1.5 }, 'report')).state).toBe('ok')
    expect(await rowOf(seller)).toMatchObject({ ourCost: 1_500_000n, sellerCost: 1_500_000n, source: 'report' })
  })

  it('marks a day 3% off red', async () => {
    const seller = newSeller('red')
    await calls(seller, [1])
    expect((await checkDay(db, seller, DAY, { currency: 'USD', cost: 1.03 }, 'report')).state).toBe('red')
  })

  it('keeps a tiny day off by more than 2% but under ₹1 from turning red', async () => {
    const seller = newSeller('tiny')
    await calls(seller, [0.001])
    // US$0.0005 apart is 50%, but about ₹0.05.
    expect((await checkDay(db, seller, DAY, { currency: 'USD', cost: 0.0015 }, 'report')).state).toBe('ok')
  })

  it('gives Modal’s cost outside our calls on its own, never as red', async () => {
    await db.delete(aiDailyChecks).where(and(eq(aiDailyChecks.seller, 'modal'), eq(aiDailyChecks.day, '2001-02-01')))
    const before = (await ourCost(db, 'modal', '2001-02-01')).cost
    await calls('modal', [0.09], '2001-02-01')
    const checked = await checkDay(
      db,
      'modal',
      '2001-02-01',
      { currency: 'USD', cost: 0.09 + Number(before) / 1e6 + 0.28 },
      'report',
    )
    expect(checked.state).toBe('ok')
    expect((await rowOf('modal', '2001-02-01'))?.outsideCalls).toBe(280_000n)
  })

  it('leaves a day the seller has no figure for yet waiting', async () => {
    const seller = newSeller('waiting')
    await calls(seller, [1])
    expect((await checkDay(db, seller, DAY, null, 'report')).state).toBe('waiting')
    expect(await rowOf(seller)).toMatchObject({ sellerCost: null, source: null })
  })
})

describe('daysBefore', () => {
  it('gives the UTC days before today, oldest first', () => {
    expect(daysBefore(new Date('2026-11-25T03:00:00Z'), 3)).toEqual(['2026-11-22', '2026-11-23', '2026-11-24'])
  })
})

describe('the sellers’ cost reports', () => {
  it('read each seller’s figure for a day, or none yet', async () => {
    const start = Date.parse('2026-11-24T00:00:00Z') / 1000
    const openai = fakeFetch([
      [
        '/organization/costs',
        {
          body: JSON.stringify({
            data: [{ start_time: start, results: [{ amount: { value: 0.02 } }, { amount: { value: 0.008 } }] }],
          }),
        },
      ],
    ])
    expect(await openaiCostReport({ adminKey: 'k', projectId: 'p', fetch: openai.fetch })('2026-11-24')).toEqual({
      currency: 'USD',
      cost: 0.028,
    })
    expect(openai.sent[0]?.url).toContain('project_ids=p')
    const openrouter = fakeFetch([
      ['/activity', { body: JSON.stringify({ data: [{ usage: 0.028 }, { usage: 0.002 }] }) }],
    ])
    expect(await openrouterCostReport({ managementKey: 'k', fetch: openrouter.fetch })('2026-11-24')).toMatchObject({
      cost: 0.03,
    })
    const zenmux = fakeFetch([
      ['/management/cost', { body: JSON.stringify({ data: { summary: { totalCost: '0.09' } } }) }],
    ])
    expect(await zenmuxCostReport({ managementKey: 'k', fetch: zenmux.fetch })('2026-11-24')).toEqual({
      currency: 'USD',
      cost: 0.09,
    })
    expect(zenmux.sent[0]?.url).toContain('query_time=20261124')
    const waiting = fakeFetch([
      ['/management/cost', { body: JSON.stringify({ data: { summary: { totalCost: null } } }) }],
    ])
    expect(await zenmuxCostReport({ managementKey: 'k', fetch: waiting.fetch })('2026-11-24')).toBeNull()
    const billing = {
      async *workspaceBillingReport() {
        yield { description: 'dazbee-layering', environmentName: 'prod', cost: '0.3725' }
        yield { description: 'dazbee-layering', environmentName: 'main', cost: '0.5' }
        yield { description: 'another-app', environmentName: 'prod', cost: '9' }
      },
    }
    expect(await modalCostReportOn(billing)('2026-11-24')).toEqual({ currency: 'USD', cost: 0.8725 })
    // With an environment, only that environment's layer split counts: production's, not development's.
    expect(await modalCostReportOn(billing, 'prod')('2026-11-24')).toEqual({ currency: 'USD', cost: 0.3725 })
  })
})
