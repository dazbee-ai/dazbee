// The routes of the fonts a brand can use: the catalog, all of it, the families asked for, or in its two parts,
// uploading a font, and a face's file and preview; and the Google list and the Google faces' files, previews and match
// copies, which anyone may read at their permanent addresses.
import { type Context, Hono } from 'hono'

import type { Db } from '@dazbee/db'
import {
  GOOGLE_FONT_LIST_PATH,
  GOOGLE_FONT_PATH,
  GOOGLE_MATCH_PATH,
  MOST_FONT_FAMILIES_ASKED,
  RecordFont,
  StartFontUpload,
} from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'

import { body, type Env, error, requireWriter } from '../http.ts'
import { logError } from '../log.ts'
import {
  FILES_PER_ADDRESS_PER_MINUTE,
  isOneSpelling,
  KEEP_FOR_GOOD,
  KEEP_NOTHING,
  keepOnlyFiles,
  perAddressLimit,
  storedFileAnswer,
} from '../permanent-files.ts'
import {
  fontCatalogParts,
  fontLink,
  googleFaceFile,
  googleFontList,
  lastGoogleFontList,
  listFonts,
  recordFont,
  startFontUpload,
} from './fonts.ts'

/**
 * How long an ask for a Google list other than the last one built waits before it asks the database again whether the
 * Google faces changed; asks in between are answered 404 from memory.
 */
export const GOOGLE_LIST_CHECK_MS = 10_000

/** A Google face's name at its address: its id, then its extension. */
const GOOGLE_FACE_FILE_NAME = /^([\w-]{1,64})\.([a-z]+)$/
/** What each extension at a Google face's address serves, and as what. */
const GOOGLE_FACE_FILES: ReadonlyMap<string, { kind: 'file' | 'preview'; contentType: string }> = new Map([
  ['ttf', { kind: 'file', contentType: 'font/ttf' }],
  ['png', { kind: 'preview', contentType: 'image/png' }],
])
/** A Google face's match copy's name at its address: the face's id, then `.ttf`. */
const GOOGLE_MATCH_NAME = /^([\w-]{1,64})\.ttf$/
/** The fewest bytes a font file has: the head of its table directory. */
const SMALLEST_FONT = 12
/** The Google list's name at its address: the hash of its bytes, then `.js` (`GOOGLE_FONT_LIST_PATH`). */
const GOOGLE_LIST_NAME = /^([0-9a-f]{32})\.js$/

export function fontRoutes({ db, storage }: { db: Db; storage: Storage }): Hono<Env> {
  const app = new Hono<Env>()

  // Google Fonts copied into our storage and the brand's uploads, read back from there; with `family`
  // asked for, only those families, as a design opening asks for the families its texts use.
  app.get('/brands/:brandId/fonts', async (c) => {
    const { workspaceId } = c.var.membership
    const names = c.req.queries('family')
    if (names && names.length > MOST_FONT_FAMILIES_ASKED)
      return c.json(error(`Ask for at most ${MOST_FONT_FAMILIES_ASKED} families at once`), 400)
    return c.json(await listFonts(db, workspaceId, c.var.brand.id, names))
  })

  // The catalog in its two parts: the Google list's address, read from the browser's cache, and the brand's uploads.
  app.get('/brands/:brandId/fonts/catalog', async (c) => {
    const { workspaceId } = c.var.membership
    return c.json(await fontCatalogParts(db, workspaceId, c.var.brand.id))
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
 * The Google faces' files and previews at `GOOGLE_FONT_PATH`, their match copies at `GOOGLE_MATCH_PATH`, and the Google
 * list at `GOOGLE_FONT_LIST_PATH`, for anyone, with no session: open-licence files and their list, the same for everyone, kept by browsers and Cloudflare
 * for good. Only faces of the Google catalog are read, never a brand's upload. Only the one spelling of each address
 * is served, with no query string and no escapes, so none can ask past Cloudflare's copy, and the list only at the
 * hash of its bytes, so an address never holds two lists.
 */
export function googleFontRoutes({
  db,
  storage,
  perAddressPerMinute = FILES_PER_ADDRESS_PER_MINUTE,
  listCheckMs = GOOGLE_LIST_CHECK_MS,
}: {
  db: Db
  storage: Storage
  perAddressPerMinute?: number
  listCheckMs?: number
}): Hono<Env> {
  const app = new Hono<Env>()
  const mayAsk = perAddressLimit(perAddressPerMinute)
  // Only a file or list that came whole is kept.
  app.use('/fonts/google/*', keepOnlyFiles)
  /** When an ask for another Google list last asked the database. */
  let listCheckedAt = Number.NEGATIVE_INFINITY
  /** The Google list of this hash, from memory, or the database at most once in `listCheckMs`; none for another. */
  const listOf = async (hash: string) => {
    const last = await lastGoogleFontList()
    if (last?.hash === hash) return last
    if (Date.now() - listCheckedAt < listCheckMs) return undefined
    listCheckedAt = Date.now()
    const now = await googleFontList(db)
    return now.hash === hash ? now : undefined
  }
  const tooMany = (c: Context<Env>) =>
    c.json(error('This address has asked for too many font files; try again in a minute'), 429, KEEP_NOTHING)
  app.get(`${GOOGLE_FONT_PATH}:name`, async (c) => {
    const name = GOOGLE_FACE_FILE_NAME.exec(c.req.param('name'))
    const served = name?.[2] ? GOOGLE_FACE_FILES.get(name[2]) : undefined
    if (!name?.[1] || !served || !isOneSpelling(c, `${GOOGLE_FONT_PATH}${name[0]}`))
      return c.json(error('No such font'), 404, KEEP_NOTHING)
    if (!mayAsk(c)) return tooMany(c)
    const stored = await googleFaceFile(db, storage, name[1], served.kind)
    if (!stored) return c.json(error('No such font'), 404, KEEP_NOTHING)
    return storedFileAnswer(c, stored, {
      'content-type': served.contentType,
      ...(stored.byteSize === null ? {} : { 'content-length': String(stored.byteSize) }),
    })
  })
  app.get(`${GOOGLE_MATCH_PATH}:name`, async (c) => {
    const name = GOOGLE_MATCH_NAME.exec(c.req.param('name'))
    if (!name?.[1] || !isOneSpelling(c, `${GOOGLE_MATCH_PATH}${name[0]}`))
      return c.json(error('No such font'), 404, KEEP_NOTHING)
    if (!mayAsk(c)) return tooMany(c)
    // A face whose copy isn't made yet, before `fonts:match-copies` runs: kept nowhere, so it is served once made.
    const stored = await googleFaceFile(db, storage, name[1], 'match')
    if (!stored) return c.json(error('No such font'), 404, KEEP_NOTHING)
    // Kept for good only with the length storage names, and only one no shorter than a font's table directory's head.
    if (stored.byteSize === null || stored.byteSize < SMALLEST_FONT) {
      await stored.body.cancel()
      logError('match-copy-size', new Error('A stored match copy has no length a font can have'), {
        faceId: name[1],
        stored: stored.byteSize,
      })
      return c.json(error('Something went wrong on our side'), 500, KEEP_NOTHING)
    }
    return storedFileAnswer(c, stored, { 'content-type': 'font/ttf', 'content-length': String(stored.byteSize) })
  })
  app.get(`${GOOGLE_FONT_LIST_PATH}:name`, async (c) => {
    const name = GOOGLE_LIST_NAME.exec(c.req.param('name'))
    if (!name?.[1] || !isOneSpelling(c, `${GOOGLE_FONT_LIST_PATH}${name[0]}`))
      return c.json(error('No such list'), 404, KEEP_NOTHING)
    if (!mayAsk(c)) return tooMany(c)
    const list = await listOf(name[1])
    // Another list's: an old one, or the one of a server that is being swapped out; the browser asks the brand again.
    if (!list) return c.json(error('No such list'), 404, KEEP_NOTHING)
    const headers = {
      'content-type': 'application/json',
      'content-length': String(list.bytes.length),
      ...KEEP_FOR_GOOD,
    }
    if (c.req.method === 'HEAD') return c.body(null, 200, headers)
    return c.body(list.bytes.slice(), 200, headers)
  })
  // Anything else Caddy sends here under /fonts/google/.
  app.get('/fonts/google/*', (c) => c.json(error('No such font'), 404, KEEP_NOTHING))
  return app
}
