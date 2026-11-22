// What the API's files at permanent addresses, which anyone may read, share: the one spelling of an address, the
// limit on each address's asks, the answer that keeps a file for good and the one that keeps nothing.
import type { Context, MiddlewareHandler } from 'hono'

import { requestLimit } from './admin/waiting-list.ts'
import type { Env } from './http.ts'

/** The files at one kind of permanent address one address may ask the API for in a minute; Cloudflare answers repeats itself. */
export const FILES_PER_ADDRESS_PER_MINUTE = 600
/**
 * What every answer at a permanent address that is its file says: keep it for good, and only the app's own pages load
 * it, so another site can't put it in its pages.
 */
export const KEEP_FOR_GOOD = {
  'cache-control': 'public, max-age=31536000, immutable',
  'cross-origin-resource-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
}
/** What every other answer at a permanent address says: keep it nowhere, so a file added later shows. */
export const KEEP_NOTHING = { 'cache-control': 'no-store' }

/** Keeps nowhere every answer at the addresses it guards but a whole file: no other answer, an app's error included. */
export const keepOnlyFiles: MiddlewareHandler<Env> = async (c, next) => {
  await next()
  if (c.res.status !== 200) c.res.headers.set('cache-control', 'no-store')
}

/**
 * Whether the request asks for `path` in its one spelling: no escapes and no query string, not even an empty one, so
 * none can ask past Cloudflare's copy or make another copy there.
 */
export function isOneSpelling(c: Context<Env>, path: string): boolean {
  return !c.req.url.includes('?') && new URL(c.req.url).pathname === path
}

/**
 * Whether the address asking may ask for one more file this minute, of `perMinute`: counted by the address Cloudflare
 * names, the only way in.
 */
export function perAddressLimit(perMinute: number): (c: Context<Env>) => boolean {
  const perAddress = requestLimit({ perWindow: perMinute, windowMs: 60_000 })
  return (c) => perAddress.take(networkOf(c.req.header('cf-connecting-ip')?.trim() ?? ''))
}

/** A stored file's answer with `headers`, kept for good: its body, or none for HEAD, which closes the read of storage. */
export async function storedFileAnswer(
  c: Context<Env>,
  stored: { body: ReadableStream<Uint8Array> },
  headers: Record<string, string>,
): Promise<Response> {
  const kept = { ...headers, ...KEEP_FOR_GOOD }
  if (c.req.method !== 'HEAD') return c.body(stored.body, 200, kept)
  await stored.body.cancel()
  return c.body(null, 200, kept)
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
