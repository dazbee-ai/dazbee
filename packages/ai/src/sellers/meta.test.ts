// Meta's adapter on a recorded answer (fixtures/), priced from the migration's price list, and its error
// answers read as the retry rules say. No call leaves the machine.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { CallInput } from '@dazbee/schema'

import { priceUsage } from '../price-list.ts'
import { db } from '../test-ai.ts'
import { metaSeller } from './meta.ts'
import { SellerError, sellerFailure, type SellerRequest } from './seller.ts'

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const PICTURE: CallInput = { kind: 'picture', prompt: 'A coffee cup.', width: 1024, height: 1024 }
const EDIT: CallInput = {
  kind: 'picture-edit',
  prompt: 'Make it square.',
  pictures: ['workspaces/w/originals/a'],
  width: 1024,
  height: 1024,
}

/** An adapter whose fetch answers `status` with `body`, and the URLs and bodies it was sent. */
function answering(status: number, body: string) {
  const seen: { url: string; body: unknown }[] = []
  const fetch = (async (url: string, init?: RequestInit) => {
    // The SDK probes fetch with a data: URL before it sends a form; only calls to the seller are kept.
    if (!String(url).startsWith('data:')) seen.push({ url: String(url), body: init?.body })
    return new Response(body, { status, headers: { 'content-type': 'application/json', 'x-request-id': 'meta-test' } })
  }) as typeof globalThis.fetch
  return { seller: metaSeller('test-key', { fetch }), seen }
}

function requestOf(input: CallInput): SellerRequest {
  return {
    model: 'muse-image-1.0',
    input,
    options: {},
    signal: new AbortController().signal,
    readPicture: async () =>
      new Uint8Array(Buffer.from(JSON.parse(fixture('meta-images.json')).data[0].b64_json, 'base64')),
    keepRequestId: async () => undefined,
  }
}

describe('metaSeller', () => {
  it('reads a picture answer as one picture made, at its real cost', async () => {
    const { seller, seen } = answering(200, fixture('meta-images.json'))
    const answer = await seller.call(requestOf(PICTURE))
    expect(seen[0]?.url).toBe('https://api.meta.ai/v1/images/generations')
    expect(JSON.parse(String(seen[0]?.body))).toMatchObject({ model: 'muse-image-1.0', response_format: 'b64_json' })
    expect(answer.output).toMatchObject({ kind: 'pictures', pictures: [{ width: 16, height: 16 }] })
    expect(answer.usage).toEqual({ picture: 1 })
    expect(answer.requestId).toBe('meta-test')
    // ₹0.93 a picture, as Meta bills this account, with no fee.
    expect(await priceUsage(db, 'meta', 'muse-image-1.0', answer.usage)).toEqual({
      currency: 'INR',
      sellerCost: 930_000n,
      realCost: 930_000n,
    })
  })

  it('sends an edit to the edits route with its reference picture', async () => {
    const { seller, seen } = answering(200, fixture('meta-images.json'))
    await seller.call(requestOf(EDIT))
    expect(seen[0]?.url).toBe('https://api.meta.ai/v1/images/edits')
  })

  it('reads error answers as the retry rules say', async () => {
    const failures = []
    for (const status of [429, 500, 402, 400]) {
      const body = JSON.stringify({ error: { message: `test ${status}`, type: 'error', code: null } })
      const error = await answering(status, body)
        .seller.call(requestOf(PICTURE))
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(SellerError)
      failures.push(sellerFailure(error))
    }
    expect(failures).toEqual(['retry', 'retry', 'next-seller', 'fail'])
  })
})
