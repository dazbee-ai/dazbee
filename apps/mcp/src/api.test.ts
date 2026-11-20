import { describe, expect, it } from 'vitest'

import { MAX_UPLOAD_BYTES } from '@dazbee/schema'

import { agentApi, ApiRefusal } from './api.ts'

/** A font face's link, as the API answers it, pointing at storage. */
const LINK = {
  face: { id: 'face-1', family: 'Brand Serif', weight: 400, style: 'normal', source: 'upload', byteSize: 1 },
  url: 'http://storage.test/fonts/face-1',
  previewUrl: 'http://storage.test/previews/face-1',
  expiresAt: '2026-11-21T12:00:00.000Z',
}

/** The API over a fetch whose storage answers `stored`, and every request it was sent. */
function apiWith(stored: () => Response) {
  const sent: Request[] = []
  const api = agentApi(
    {
      url: 'http://api.test',
      fetch: async (request) => {
        sent.push(request)
        return new URL(request.url).origin === 'http://storage.test' ? stored() : Response.json(LINK)
      },
    },
    'dazbee_at_token',
    'ws-test',
    () => {},
  )
  return { api, sent }
}

/** A body of `mib` MiB, sent a MiB at a time, with no length given. */
function streamed(mib: number) {
  let sent = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent++ < mib) controller.enqueue(new Uint8Array(1024 * 1024))
      else controller.close()
    },
  })
}

describe('agentApi', () => {
  it('reads a font file from its signed link without the agent’s token', async () => {
    const { api, sent } = apiWith(() => new Response(new Uint8Array([1, 2, 3])))
    expect(await api.fontBytes('brand-summer', 'face-1')).toEqual(new Uint8Array([1, 2, 3]))
    expect(sent.map((request) => request.headers.has('authorization'))).toEqual([true, false])
  })

  it('refuses a file at a signed link larger than any Dazbee stores, by its length or as it streams', async () => {
    const declared = apiWith(() => new Response('', { headers: { 'content-length': String(MAX_UPLOAD_BYTES + 1) } }))
    await expect(declared.api.fontBytes('brand-summer', 'face-1')).rejects.toBeInstanceOf(ApiRefusal)
    const endless = apiWith(() => new Response(streamed(MAX_UPLOAD_BYTES / 1024 / 1024 + 1)))
    await expect(endless.api.fontBytes('brand-summer', 'face-1')).rejects.toThrow(
      'A file in Dazbee’s storage is larger than any it stores',
    )
  })
})
