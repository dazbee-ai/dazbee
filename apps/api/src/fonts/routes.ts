// The routes of the fonts a brand can use: the catalog, uploading a font, and a face's file and preview; and the
// Google faces' files and previews, which anyone may read at their permanent addresses.
import { Hono } from 'hono'

import type { Db } from '@dazbee/db'
import { GOOGLE_FONT_PATH, RecordFont, StartFontUpload } from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'

import { requestLimit } from '../admin/waiting-list.ts'
import { body, type Env, error, requireWriter } from '../http.ts'
import { fontLink, googleFaceFile, listFonts, recordFont, startFontUpload } from './fonts.ts'

/** The Google files and previews one address may ask the API for in a minute; Cloudflare answers repeats itself. */
export const GOOGLE_FONT_FILES_PER_ADDRESS_PER_MINUTE = 600

/** A Google face's name at its address: its id, then `.ttf` for its file or `.png` for its preview. */
const GOOGLE_FONT_NAME = /^([\w-]{1,64})\.(ttf|png)$/
/** What every answer at a Google address that is not the file says: keep it nowhere, so a face added later shows. */
const KEEP_NOTHING = { 'cache-control': 'no-store' }

export function fontRoutes({ db, storage }: { db: Db; storage: Storage }): Hono<Env> {
  const app = new Hono<Env>()

  // Fonts (#50): Google Fonts copied into our storage and the brand's uploads, read back from there.
  app.get('/brands/:brandId/fonts', async (c) => {
    const { workspaceId } = c.var.membership
    return c.json(await listFonts(db, workspaceId, c.var.brand.id))
  })

  app.post('/brands/:brandId/fonts/uploads', requireWriter, async (c) => {
    const { workspaceId } = c.var.membership
    const input = await body(c.req.raw, StartFontUpload)
    if (input instanceof Response) return input
    return c.json(await startFontUpload(db, storage, workspaceId, c.var.brand.id, input))
  })

  app.post('/brands/:brandId/fonts', requireWriter, async (c) => {
    const { workspaceId } = c.var.membership
    const input = await body(c.req.raw, RecordFont)
    if (input instanceof Response) return input
    return c.json(await recordFont(db, storage, workspaceId, c.var.brand.id, input.sha256), 201)
  })

  app.get('/brands/:brandId/fonts/faces/:faceId', async (c) => {
    const { workspaceId } = c.var.membership
    const link = await fontLink(db, storage, workspaceId, c.var.brand.id, c.req.param('faceId'))
    return link ? c.json(link) : c.json(error('No such font'), 404)
  })

  return app
}

/**
 * The Google faces' files and previews at `GOOGLE_FONT_PATH`, for anyone, with no session: open-licence files that
 * are the same for everyone, kept by browsers and Cloudflare for good. Only faces of the Google catalog are read,
 * never a brand's upload. An address with a query string is refused, so none can ask past Cloudflare's copy.
 */
export function googleFontRoutes({
  db,
  storage,
  perAddressPerMinute = GOOGLE_FONT_FILES_PER_ADDRESS_PER_MINUTE,
}: {
  db: Db
  storage: Storage
  perAddressPerMinute?: number
}): Hono<Env> {
  const app = new Hono<Env>()
  // Counted by the address Cloudflare names, the only way in.
  const perAddress = requestLimit({ perWindow: perAddressPerMinute, windowMs: 60_000 })
  app.get(`${GOOGLE_FONT_PATH}:name`, async (c) => {
    const name = GOOGLE_FONT_NAME.exec(c.req.param('name'))
    if (!name?.[1] || new URL(c.req.url).search !== '') return c.json(error('No such font'), 404, KEEP_NOTHING)
    if (!perAddress.take(c.req.header('cf-connecting-ip')?.trim() ?? ''))
      return c.json(error('This address has asked for too many font files; try again in a minute'), 429, KEEP_NOTHING)
    const preview = name[2] === 'png'
    const stored = await googleFaceFile(db, storage, name[1], preview ? 'preview' : 'file')
    if (!stored) return c.json(error('No such font'), 404, KEEP_NOTHING)
    return c.body(stored.body, 200, {
      'content-type': preview ? 'image/png' : 'font/ttf',
      'content-length': String(stored.byteSize),
      'cache-control': 'public, max-age=31536000, immutable',
      // Only the app's own pages load them: another site can't put them in its pages.
      'cross-origin-resource-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
    })
  })
  app.all(`${GOOGLE_FONT_PATH}*`, (c) => c.json(error('No such font'), 404, KEEP_NOTHING))
  return app
}
