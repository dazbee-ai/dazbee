// The matchers' files at their permanent addresses, `/matchers/<sha256>.bin`, for anyone, with no session: only the
// files `@dazbee/matchers/release` lists, read from our storage, the same for everyone and kept by browsers and
// Cloudflare for good. Only the one spelling of each address is served, with no query string and no escapes, so none
// can ask past Cloudflare's copy, and only a file that came whole is kept anywhere.
import { Hono } from 'hono'

import release from '@dazbee/matchers/release' with { type: 'json' }
import { MATCHER_FILE_PATH } from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'

import { requestLimit } from '../admin/waiting-list.ts'
import { type Env, error } from '../http.ts'
import { logError } from '../log.ts'
import { FILES_PER_ADDRESS_PER_MINUTE, KEEP_FOR_GOOD, KEEP_NOTHING, networkOf } from '../permanent-files.ts'
import { matcherFileKey } from '../storage-keys.ts'

/** The files the release lists, by SHA-256, each with its size. */
export const LISTED_MATCHER_FILES: ReadonlyMap<string, number> = new Map(
  Object.values(release.files).map((file) => [file.sha256, file.size]),
)

/** A matcher file's name at its address: its SHA-256, then `.bin`. */
const MATCHER_FILE_NAME = /^([0-9a-f]{64})\.bin$/

export function matcherFileRoutes({
  storage,
  listed = LISTED_MATCHER_FILES,
  perAddressPerMinute = FILES_PER_ADDRESS_PER_MINUTE,
}: {
  storage: Storage
  /** The files served, by SHA-256, with their sizes. */
  listed?: ReadonlyMap<string, number>
  perAddressPerMinute?: number
}): Hono<Env> {
  const app = new Hono<Env>()
  // Counted by the address Cloudflare names, the only way in.
  const perAddress = requestLimit({ perWindow: perAddressPerMinute, windowMs: 60_000 })
  // Only a file that came whole is kept: no other answer, an error of the app's included.
  app.use(`${MATCHER_FILE_PATH}*`, async (c, next) => {
    await next()
    if (c.res.status !== 200) c.res.headers.set('cache-control', 'no-store')
  })
  app.get(`${MATCHER_FILE_PATH}:name`, async (c) => {
    const url = new URL(c.req.url)
    const name = MATCHER_FILE_NAME.exec(c.req.param('name'))
    const size = name?.[1] ? listed.get(name[1]) : undefined
    // An empty query string counts too: any `?` would make another copy at Cloudflare.
    if (
      !name?.[1] ||
      size === undefined ||
      c.req.url.includes('?') ||
      url.pathname !== `${MATCHER_FILE_PATH}${name[0]}`
    )
      return c.json(error('No such file'), 404, KEEP_NOTHING)
    if (!perAddress.take(networkOf(c.req.header('cf-connecting-ip')?.trim() ?? '')))
      return c.json(
        error('This address has asked for too many matcher files; try again in a minute'),
        429,
        KEEP_NOTHING,
      )
    // Listed but not stored yet, before `matchers:upload` runs: kept nowhere, so it is served once stored.
    const stored = await storage.stream(matcherFileKey(name[1]))
    if (!stored) return c.json(error('No such file'), 404, KEEP_NOTHING)
    if (stored.byteSize !== null && stored.byteSize !== size) {
      await stored.body.cancel()
      logError('matcher-file-size', new Error('A stored matcher file is not the size its release lists'), {
        sha256: name[1],
        stored: stored.byteSize,
        listed: size,
      })
      return c.json(error('Something went wrong on our side'), 500, KEEP_NOTHING)
    }
    const headers = { 'content-type': 'application/octet-stream', 'content-length': String(size), ...KEEP_FOR_GOOD }
    if (c.req.method === 'HEAD') {
      await stored.body.cancel()
      return c.body(null, 200, headers)
    }
    return c.body(stored.body, 200, headers)
  })
  // Anything else Caddy sends here under /matchers/.
  app.get(`${MATCHER_FILE_PATH}*`, (c) => c.json(error('No such file'), 404, KEEP_NOTHING))
  return app
}
