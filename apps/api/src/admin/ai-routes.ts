// The admin page's AI routes, under /admin/ai, for admins only, as if they didn't exist for anyone else: the
// daily check over a range of days, a seller's uploaded usage file, unknown calls by seller and day, the
// sellers that said they are out of money in the last day, and when the sellers checked from uploads were
// last checked.
import { and, count, desc, eq, gte, like, lte, max, sql } from 'drizzle-orm'
import { Hono } from 'hono'

import { lastChecked, SellerFileRefused, uploadSellerFile } from '@dazbee/ai'
import { aiCalls, aiDailyChecks, type Db } from '@dazbee/db'
import {
  type DailyCheck,
  type LastChecked,
  type OutOfMoney,
  type SellerFileResult,
  SellerFileUpload,
  type UnknownCalls,
  UtcDay,
} from '@dazbee/schema'

import { body, type Env, error } from '../http.ts'
import type { SessionOf } from '../sign-in/session.ts'
import { type Admins, requireAdmin } from './admins.ts'

/** How many days a range may span at most. */
const MAX_DAYS = 92

export function aiAdminRoutes({ db, sessionOf, admins }: { db: Db; sessionOf: SessionOf; admins: Admins }): Hono<Env> {
  const app = new Hono<Env>()

  app.use('/admin/ai/*', requireAdmin(db, sessionOf, admins))

  app.get('/admin/ai/daily-checks', async (c) => {
    const range = rangeOf(c.req.query('from'), c.req.query('to'))
    if (!range) return c.json(error(`Give from and to as YYYY-MM-DD, at most ${MAX_DAYS} days apart`), 400)
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
        ourCost: Number(row.ourCost) / 1e6,
        sellerCost: row.sellerCost === null ? null : Number(row.sellerCost) / 1e6,
        outsideCalls: row.outsideCalls === null ? null : Number(row.outsideCalls) / 1e6,
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
    if (!range) return c.json(error(`Give from and to as YYYY-MM-DD, at most ${MAX_DAYS} days apart`), 400)
    const day = sql<string>`to_char(${aiCalls.startedAt} at time zone 'UTC', 'YYYY-MM-DD')`
    const rows = await db
      .select({ seller: aiCalls.seller, day, calls: count() })
      .from(aiCalls)
      .where(
        and(
          eq(aiCalls.state, 'unknown'),
          gte(aiCalls.startedAt, new Date(`${range.from}T00:00:00Z`)),
          lte(aiCalls.startedAt, new Date(`${range.to}T23:59:59.999Z`)),
        ),
      )
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

/** The range `from` to `to`, both UTC days, `to` not before `from` and at most `MAX_DAYS` apart; null otherwise. */
function rangeOf(from: string | undefined, to: string | undefined): { from: string; to: string } | null {
  const start = UtcDay.safeParse(from)
  const end = UtcDay.safeParse(to)
  if (!start.success || !end.success) return null
  const days = (Date.parse(end.data) - Date.parse(start.data)) / 86_400_000
  return days < 0 || days > MAX_DAYS ? null : { from: start.data, to: end.data }
}
