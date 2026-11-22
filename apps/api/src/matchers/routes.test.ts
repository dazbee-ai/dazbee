// The matchers' files at their permanent addresses, against storage from Docker Compose (`docker compose up -d --wait`).
import { describe, expect, it } from 'vitest'

import type { Storage } from '@dazbee/storage'

import { matcherFileKey } from '../storage-keys.ts'
import { app, run, storage } from '../test-api.ts'
import { sha256 } from '../test-files.ts'
import { matcherFileRoutes } from './routes.ts'

/** A stand-in matcher file of this run, stored and listed. */
const bytes = new TextEncoder().encode(`a stand-in matcher file ${run}`)
const sha = sha256(bytes)
/** A file of this run that is stored but not listed. */
const unlisted = new TextEncoder().encode(`a matcher file no release lists ${run}`)
const listed = new Map([[sha, bytes.length]])
await storage.put(matcherFileKey(sha), bytes, 'application/octet-stream')
await storage.put(matcherFileKey(sha256(unlisted)), unlisted, 'application/octet-stream')

const KEPT_FOR_GOOD = {
  'content-type': 'application/octet-stream',
  'content-length': String(bytes.length),
  'cache-control': 'public, max-age=31536000, immutable',
  'cross-origin-resource-policy': 'same-origin',
  'x-content-type-options': 'nosniff',
}

/** Storage that holds `body` under every key and says it holds `byteSize` bytes, with no network. */
function storageOf(body: Uint8Array, byteSize: number | null = body.length): Storage {
  return { stream: async () => ({ body: new Blob([body]).stream(), byteSize }) } as unknown as Storage
}

describe('matcherFileRoutes', () => {
  it('serves a listed file to anyone, kept for good, with the length its release lists', async () => {
    const file = await matcherFileRoutes({ storage, listed }).request(`/matchers/${sha}.bin`)
    expect(file.status).toBe(200)
    expect(Object.fromEntries(file.headers)).toMatchObject(KEPT_FOR_GOOD)
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes)
    // And with the release's length when storage names none, as when it compresses what it sends.
    const unsized = await matcherFileRoutes({ storage: storageOf(bytes, null), listed }).request(`/matchers/${sha}.bin`)
    expect(unsized.headers.get('content-length')).toBe(String(bytes.length))
    expect(new Uint8Array(await unsized.arrayBuffer())).toEqual(bytes)
  })

  it('answers HEAD with the file’s headers and no body', async () => {
    const head = await matcherFileRoutes({ storage, listed }).request(`/matchers/${sha}.bin`, { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(Object.fromEntries(head.headers)).toMatchObject(KEPT_FOR_GOOD)
    expect(await head.text()).toBe('')
  })

  it('serves no unlisted file, no other spelling and no query string, and keeps none of those answers', async () => {
    const routes = matcherFileRoutes({ storage, listed })
    for (const path of [
      `/matchers/${sha256(unlisted)}.bin`,
      `/matchers/${sha}.onnx`,
      `/matchers/${sha}`,
      `/matchers/${sha}.bin/`,
      `/matchers/${sha.toUpperCase()}.bin`,
      `/matchers/%${sha.charCodeAt(0).toString(16)}${sha.slice(1)}.bin`,
      `/matchers/${sha}.bin?v=2`,
      `/matchers/${sha}.bin?`,
      `/matchers//${sha}.bin`,
      `/matchers/x/${sha}.bin`,
      `/matchers/${sha}.bin%00`,
      '/matchers/',
    ]) {
      const refused = await routes.request(path)
      expect({ path, status: refused.status }).toEqual({ path, status: 404 })
      expect(refused.headers.get('cache-control')).toBe('no-store')
    }
  })

  it('keeps nowhere the answer for a listed file not stored yet, or stored at another size', async () => {
    const missing = sha256(new TextEncoder().encode(`not stored ${run}`))
    const notYet = await matcherFileRoutes({ storage, listed: new Map([[missing, 10]]) }).request(
      `/matchers/${missing}.bin`,
    )
    expect(notYet.status).toBe(404)
    expect(notYet.headers.get('cache-control')).toBe('no-store')

    const short = await matcherFileRoutes({ storage: storageOf(bytes.subarray(1)), listed }).request(
      `/matchers/${sha}.bin`,
    )
    expect(short.status).toBe(500)
    expect(short.headers.get('cache-control')).toBe('no-store')

    const broken = { stream: () => Promise.reject(new Error('storage is down')) } as unknown as Storage
    const failed = await matcherFileRoutes({ storage: broken, listed }).request(`/matchers/${sha}.bin`)
    expect(failed.status).toBe(500)
    expect(failed.headers.get('cache-control')).toBe('no-store')
  })

  it('refuses the 601st file a minute from one address, and its /64 when IPv6', async () => {
    const routes = matcherFileRoutes({ storage: storageOf(bytes), listed })
    const ask = (address: string) =>
      routes.request(`/matchers/${sha}.bin`, { headers: { 'cf-connecting-ip': address } })
    for (let i = 0; i < 600; i++) expect((await ask('203.0.113.7')).status).toBe(200)
    const refused = await ask('203.0.113.7')
    expect(refused.status).toBe(429)
    expect(refused.headers.get('cache-control')).toBe('no-store')
    expect((await ask('203.0.113.8')).status).toBe(200)
    for (let i = 0; i < 600; i++) await ask(`2001:db8:1:2::${i.toString(16)}`)
    expect((await ask('2001:db8:1:2:ffff::9')).status).toBe(429)
  })

  it('is mounted on the API', async () => {
    const answer = await app.request(`/matchers/${'0'.repeat(64)}.bin`)
    expect(answer.status).toBe(404)
    expect(answer.headers.get('cache-control')).toBe('no-store')
    expect(await answer.json()).toEqual({ error: 'No such file' })
  })
})
