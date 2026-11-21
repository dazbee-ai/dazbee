// The routes of a brand's kit: reading it and saving it whole.
import { Hono } from 'hono'

import type { Db } from '@dazbee/db'
import { SaveBrandKit } from '@dazbee/schema'

import { body, type Env, error, requireWriter } from '../http.ts'
import { getBrandKit, saveBrandKit } from './brand-kits.ts'

export function brandKitRoutes({ db }: { db: Db }): Hono<Env> {
  const app = new Hono<Env>()

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

  return app
}
