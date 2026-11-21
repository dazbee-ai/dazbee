// The routes of a brand's kit: reading it, saving it whole, and filling it from the brand's website.
import { Hono } from 'hono'

import type { Db } from '@dazbee/db'
import { BrandFromWebsite, SaveBrandKit } from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'

import { requestLimit } from '../admin/waiting-list.ts'
import type { SafeFetchSettings } from '../fetch/safe-fetch.ts'
import { body, type Env, error, requireWriter } from '../http.ts'
import { getBrandKit, saveBrandKit } from './brand-kits.ts'
import { brandFromWebsite } from './from-website.ts'

export function brandKitRoutes({
  db,
  storage,
  outsideFetch,
  websitesPerHour,
}: {
  db: Db
  storage: Storage
  /** How the safe fetch reaches outside sites. */
  outsideFetch: SafeFetchSettings
  /** The websites a member may read into kits in an hour, themselves and their agents together. */
  websitesPerHour: number
}): Hono<Env> {
  const app = new Hono<Env>()
  const websites = requestLimit({ perWindow: websitesPerHour })
  // The members reading a website now, each one at a time.
  const reading = new Set<string>()

  // Brand kits (#53): the colours, fonts and text styles designs bind to, the logo and the tone of voice.
  app.get('/brands/:brandId/kit', async (c) => {
    const { workspaceId } = c.var.membership
    return c.json(await getBrandKit(db, workspaceId, c.var.brand.id))
  })

  app.put('/brands/:brandId/kit', requireWriter, async (c) => {
    const { workspaceId } = c.var.membership
    const input = await body(c.req.raw, SaveBrandKit)
    if (input instanceof Response) return input
    const saved = await saveBrandKit(db, workspaceId, c.var.brand.id, input)
    if (saved === 'changed') return c.json(error('This kit changed since you opened it'), 409)
    return c.json(saved)
  })

  // The kit filled from the brand's website (#135), by whoever may save the kit: an agent's way in, and the editor's.
  app.post('/brands/:brandId/kit/from-website', requireWriter, async (c) => {
    const { workspaceId } = c.var.membership
    const { userId } = c.var.session
    const input = await body(c.req.raw, BrandFromWebsite)
    if (input instanceof Response) return input
    if (reading.has(userId))
      return c.json(error('This member is already reading a website into a kit; wait for it to finish'), 429)
    if (!websites.take(userId))
      return c.json(
        error(`This member has read as many websites as they may in an hour (${websitesPerHour}); try again later`),
        429,
      )
    reading.add(userId)
    try {
      return c.json(await brandFromWebsite(db, storage, outsideFetch, workspaceId, c.var.brand.id, input))
    } finally {
      reading.delete(userId)
    }
  })

  return app
}
