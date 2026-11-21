// The routes of stock photos, for a member who writes: searching the stock library, each member held to
// `STOCK_SEARCHES_PER_MINUTE` so no one uses up what the library takes from every workspace, and saving one of its
// photos into a brand's asset library. Without a stock library both answer that stock search is off.
import { Hono } from 'hono'

import type { Db } from '@dazbee/db'
import { AddStockPhoto, StockSearch } from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'

import { requestLimit } from '../admin/waiting-list.ts'
import type { SafeFetchSettings } from '../fetch/safe-fetch.ts'
import { body, type Env, error, issuesOf, requireWriter } from '../http.ts'
import { addStockPhoto } from './add-stock.ts'
import { STOCK_OFF, type StockLibrary } from './pixabay.ts'

/** The searches a member may make in a minute, themselves and their agents together. */
export const STOCK_SEARCHES_PER_MINUTE = 20

export function stockRoutes({
  db,
  storage,
  outsideFetch,
  stock,
  perHour,
}: {
  db: Db
  storage: Storage
  /** How the safe fetch reaches outside sites, the stock library's downloads among them. */
  outsideFetch: SafeFetchSettings
  /** The stock library, or null when the server has no key for it. */
  stock: StockLibrary | null
  /** The stock photos a member may save in an hour, themselves and their agents together. */
  perHour: number
}): Hono<Env> {
  const app = new Hono<Env>()
  const searched = requestLimit({ perWindow: STOCK_SEARCHES_PER_MINUTE, windowMs: 60_000 })
  const saved = requestLimit({ perWindow: perHour })

  // ?q=red shoe&orientation=landscape&colour=red
  app.get('/stock/photos', requireWriter, async (c) => {
    if (!stock) return c.json(error(STOCK_OFF), 503)
    const search = StockSearch.safeParse(c.req.query())
    if (!search.success) return c.json(error(issuesOf(search.error, 'query')), 400)
    if (!searched.take(c.var.session.userId))
      return c.json(
        error(
          `This member has searched stock photos as often as they may for now (${STOCK_SEARCHES_PER_MINUTE} times a minute); try again in a minute`,
        ),
        429,
      )
    return c.json(await stock.search(search.data))
  })

  app.post('/brands/:brandId/assets/from-stock', requireWriter, async (c) => {
    if (!stock) return c.json(error(STOCK_OFF), 503)
    const input = await body(c.req.raw, AddStockPhoto)
    if (input instanceof Response) return input
    if (!saved.take(c.var.session.userId))
      return c.json(
        error(`This member has saved as many stock photos as they may in an hour (${perHour}); try again later`),
        429,
      )
    const { workspaceId } = c.var.membership
    return c.json(await addStockPhoto(db, storage, outsideFetch, stock, workspaceId, c.var.brand.id, input.id), 201)
  })

  return app
}
