import { createServer, type IncomingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { download, isTimeout, readCapped } from './download.ts'

const BODIES: Record<string, Uint8Array> = {
  '/png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]),
  '/gif': new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
  '/webp': new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]),
  '/text': new TextEncoder().encode('<html>not an image</html>'),
  '/big': new Uint8Array(5000).fill(0x89),
}

const seen: IncomingHttpHeaders[] = []
const server = createServer((req, res) => {
  seen.push(req.headers)
  const hops = /^\/hop\/(\d+)$/.exec(req.url ?? '')
  if (hops) {
    const left = Number(hops[1])
    res.writeHead(302, { location: left === 0 ? '/png' : `/hop/${left - 1}` }).end()
    return
  }
  if (req.url === '/to-file') {
    res.writeHead(302, { location: 'file:///etc/hosts' }).end()
    return
  }
  const body = BODIES[req.url ?? '']
  if (!body) {
    res.writeHead(403).end()
    return
  }
  res.writeHead(200).end(body)
})
let base = ''

beforeAll(async () => {
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((done) => server.close(() => done())))

describe('download', () => {
  it('names a PNG, a GIF and a WebP by their bytes, whatever the URL says', async () => {
    expect(await download(`${base}/png`, 100, true)).toMatchObject({ extension: 'png' })
    expect(await download(`${base}/gif`, 100, true)).toMatchObject({ extension: 'gif' })
    expect(await download(`${base}/webp`, 100, true)).toMatchObject({ extension: 'webp' })
  })

  it('gives a reason for bytes that are no image, a refusal, a body past its cap, and no URL', async () => {
    expect(await download(`${base}/text`, 100, true)).toEqual({ reason: 'not a PNG, JPEG, GIF or WebP' })
    expect(await download(`${base}/nothing`, 100, true)).toEqual({ reason: 'Figma’s storage answered 403' })
    expect(await download(`${base}/big`, 4999, true)).toEqual({ reason: `larger than ${4999 / 1024 / 1024} MB` })
    expect(await download(null, 100, true)).toEqual({ reason: 'Figma gave no URL' })
    expect(await download('not a url', 100, true)).toEqual({ reason: 'not a URL' })
  })

  it('takes only https unless told a stub server is on http', async () => {
    const before = seen.length
    expect(await download(`${base}/png`, 100)).toEqual({ reason: 'not an https URL' })
    expect(seen.length).toBe(before)
  })

  it('follows up to three redirects, checking each, and refuses a fourth', async () => {
    expect(await download(`${base}/hop/2`, 100, true)).toMatchObject({ extension: 'png' })
    expect(await download(`${base}/hop/3`, 100, true)).toEqual({ reason: 'more than 3 redirects' })
    expect(await download(`${base}/to-file`, 100, true)).toEqual({ reason: 'redirected to a URL that is not https' })
  })

  it('sends no credential', async () => {
    await download(`${base}/png`, 100, true)
    const headers = seen.at(-1) ?? {}
    expect(headers.authorization).toBeUndefined()
    expect(headers.cookie).toBeUndefined()
    expect(headers['x-figma-token']).toBeUndefined()
  })
})

describe('readCapped', () => {
  it('reads a body at its cap and refuses one byte past it', async () => {
    expect((await readCapped(new Response(new Uint8Array(10)), 10)).byteLength).toBe(10)
    await expect(readCapped(new Response(new Uint8Array(11)), 10)).rejects.toThrow('too large')
  })
})

describe('isTimeout', () => {
  it('tells a timeout from another failure', () => {
    expect(isTimeout(new DOMException('late', 'TimeoutError'))).toBe(true)
    expect(isTimeout(new TypeError('fetch failed'))).toBe(false)
  })
})
