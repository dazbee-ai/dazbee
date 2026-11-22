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

/** A Google face's name at its address: its id, then its extension. */
const GOOGLE_FACE_FILE_NAME = /^([\w-]{1,64})\.([a-z]+)$/
/** What each extension at a Google face's address serves, and as what. */
const GOOGLE_FACE_FILES: ReadonlyMap<string, { kind: 'file' | 'preview'; contentType: string }> = new Map([
  ['ttf', { kind: 'file', contentType: 'font/ttf' }],
  ['png', { kind: 'preview', contentType: 'image/png' }],
])
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
 * never a brand's upload. Only the one spelling of each address is served, with no query string and no escapes,
 * so none can ask past Cloudflare's copy.
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
    const url = new URL(c.req.url)
    const name = GOOGLE_FACE_FILE_NAME.exec(c.req.param('name'))
    const served = name?.[2] ? GOOGLE_FACE_FILES.get(name[2]) : undefined
    if (!name?.[1] || !served || url.search !== '' || url.pathname !== `${GOOGLE_FONT_PATH}${name[0]}`)
      return c.json(error('No such font'), 404, KEEP_NOTHING)
    if (!perAddress.take(networkOf(c.req.header('cf-connecting-ip')?.trim() ?? '')))
      return c.json(error('This address has asked for too many font files; try again in a minute'), 429, KEEP_NOTHING)
    const stored = await googleFaceFile(db, storage, name[1], served.kind)
    if (!stored) return c.json(error('No such font'), 404, KEEP_NOTHING)
    const headers = {
      'content-type': served.contentType,
      ...(stored.byteSize === null ? {} : { 'content-length': String(stored.byteSize) }),
      'cache-control': 'public, max-age=31536000, immutable',
      // Only the app's own pages load them: another site can't put them in its pages.
      'cross-origin-resource-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
    }
    if (c.req.method === 'HEAD') {
      await stored.body.cancel()
      return c.body(null, 200, headers)
    }
    return c.body(stored.body, 200, headers)
  })
  // Anything else Caddy sends here under /fonts/google/.
  app.get('/fonts/google/*', (c) => c.json(error('No such font'), 404, KEEP_NOTHING))
  return app
}

/** The address a limit counts: an IPv4 address as it is, an IPv6 address by its /64, one customer's network. */
function networkOf(address: string): string {
  if (!address.includes(':')) return address
  const [head = '', tail] = address.split('::')
  const left = head ? head.split(':') : []
  const right = tail ? tail.split(':') : []
  const groups =
    tail === undefined ? left : [...left, ...Array<string>(8 - left.length - right.length).fill('0'), ...right]
  return `${groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group, 16).toString(16))
    .join(':')}::/64`
}
