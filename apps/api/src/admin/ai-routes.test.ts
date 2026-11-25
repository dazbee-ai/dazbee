// The admin page's AI routes, against Postgres from Docker Compose: /admin/ai answers anyone but an admin 404;
// for an admin it gives the daily check, takes a seller's usage file, and lists unknown calls, sellers out of
// money and when each uploaded seller was last checked. The days used are long past, so no other test meets them.
import { and, eq, inArray } from 'drizzle-orm'
import { beforeAll, describe, expect, it } from 'vitest'

import { aiCalls, aiDailyChecks, newId } from '@dazbee/db'
import { DailyCheck, LastChecked, OutOfMoney, SellerFileResult, UnknownCalls } from '@dazbee/schema'

import { addPerson, db, workspace } from '../test-api.ts'
import { addAdmin, ask, tokenOf } from './test-early-access.ts'

let admin: Awaited<ReturnType<typeof addAdmin>>

beforeAll(async () => {
  admin = await addAdmin()
})

/** A call of `seller` started at `at`, in `state`, with `error`. */
async function addCall(seller: string, at: Date, state: 'unknown' | 'failed', error: string | null = null) {
  const job = newId()
  await db.insert(aiCalls).values({
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
      ['GET', '/admin/ai/daily-checks?from=2001-05-01&to=2001-05-02'],
      ['POST', '/admin/ai/seller-files'],
      ['GET', '/admin/ai/unknown-calls?from=2001-05-01&to=2001-05-02'],
      ['GET', '/admin/ai/out-of-money'],
      ['GET', '/admin/ai/last-checked'],
    ] as const) {
      expect((await ask(tokenOf(person.id), method, path, method === 'POST' ? {} : undefined)).status).toBe(404)
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
})
