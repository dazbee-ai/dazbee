// Pixazo's adapter on its recorded answers: submit, poll, and a later attempt polling the same request by its
// id, priced from the migration's price list. No call leaves the machine.
import { describe, expect, it } from 'vitest'

import type { CallInput } from '@dazbee/schema'

import { priceUsage } from '../price-list.ts'
import { db } from '../test-ai.ts'
import { pixazoSeller } from './pixazo.ts'
import { SellerError, sellerFailure, type SellerRequest } from './seller.ts'
import { expectDeclared, fakeFetch, fixture, referencesOf, testPicture } from './test-fetch.ts'

const EDIT: CallInput = {
  kind: 'picture',
  prompt: 'Make it square.',
  pictures: ['workspaces/w/originals/a'],
  width: 1024,
  height: 1024,
}

/** Pixazo answering a submit, then a status still queued, then completed, then the picture. */
const PIXAZO: Parameters<typeof fakeFetch>[0] = [
  ['/v1/edit-image', { status: 202, body: fixture('pixazo-submit.json') }],
  ['/v1/text-to-image', { status: 202, body: fixture('pixazo-submit.json') }],
  [
    '/v2/requests/status/',
    { body: fixture('pixazo-status-queued.json') },
    { body: fixture('pixazo-status-completed.json') },
  ],
  ['pictures.example.test', { body: testPicture(), headers: { 'content-type': 'image/png' } }],
]

function requestOf(input: CallInput, kept: string[], resumeId?: string): SellerRequest {
  return {
    call: { job: 'job', step: 'flow.read', index: 0 },
    model: 'seedream-5-5',
    input,
    options: {},
    signal: new AbortController().signal,
    readPicture: async () => testPicture(),
    references: referencesOf(input, () => testPicture()),
    keepRequestId: async (id) => void kept.push(id),
    ...(resumeId ? { resumeId } : {}),
  }
}

describe('pixazoSeller', () => {
  it('submits an edit, keeps its request id, polls until it is made and downloads it, at its real cost', async () => {
    const { fetch, sent } = fakeFetch(PIXAZO)
    const kept: string[] = []
    const answer = await pixazoSeller('test-key', { fetch, pollMs: 1 }).call(requestOf(EDIT, kept))
    expect(sent.map((s) => s.url.replace(/seedream-5-5_[\w-]+/, 'ID'))).toEqual([
      'https://gateway.pixazo.ai/seedream-5-5/v1/edit-image',
      'https://gateway.pixazo.ai/v2/requests/status/ID',
      'https://gateway.pixazo.ai/v2/requests/status/ID',
      'https://pictures.example.test/output.png',
    ])
    expect(JSON.parse(String(sent[0]?.body))).toMatchObject({
      size: '1024x1024',
      output_format: 'png',
      watermark: false,
    })
    expect(kept).toEqual([JSON.parse(fixture('pixazo-submit.json')).request_id])
    expect(answer).toMatchObject({
      usage: { picture: 1, 'reference-picture': 1 },
      output: { pictures: [{ width: 16 }] },
    })
    // US$0.02 a picture and US$0.008 a reference: the bill check's US$0.028.
    expect(await priceUsage(db, 'pixazo', 'seedream-5.5', answer.usage)).toMatchObject({ sellerCost: 28_000n })
    expectDeclared('pixazo', 'picture', 'seedream-5-5', answer.usage)
  })

  it('submits a new picture with no references to text-to-image, and counts a marked copy as a reference', async () => {
    const plain = fakeFetch(PIXAZO)
    const picture: CallInput = { kind: 'picture', prompt: 'A cup.', pictures: [], width: 1024, height: 1024 }
    const made = await pixazoSeller('test-key', { fetch: plain.fetch, pollMs: 1 }).call(requestOf(picture, []))
    expect(plain.sent[0]?.url).toBe('https://gateway.pixazo.ai/seedream-5-5/v1/text-to-image')
    expect(JSON.parse(String(plain.sent[0]?.body)).image).toBeUndefined()
    expect(made.usage).toEqual({ picture: 1, 'reference-picture': 0 })
    const marked: CallInput = { ...EDIT, marks: 'workspaces/w/originals/marks' } as CallInput
    const withMarks = fakeFetch(PIXAZO)
    const edited = await pixazoSeller('test-key', { fetch: withMarks.fetch, pollMs: 1 }).call(requestOf(marked, []))
    expect(JSON.parse(String(withMarks.sent[0]?.body)).image).toHaveLength(2)
    expect(edited.usage).toEqual({ picture: 1, 'reference-picture': 2 })
    const done = fakeFetch([['/v2/requests/status/', { body: fixture('pixazo-status-completed.json') }]])
    expect(await pixazoSeller('k', { fetch: done.fetch }).status?.('id', marked)).toEqual({
      state: 'done',
      usage: { picture: 1, 'reference-picture': 2 },
    })
  })

  it('picks a call cut mid-poll up by its request id, without submitting again', async () => {
    const { fetch, sent } = fakeFetch(PIXAZO)
    await pixazoSeller('test-key', { fetch, pollMs: 1 }).call(requestOf(EDIT, [], 'seedream-5-5_earlier'))
    expect(sent.some((s) => s.url.includes('/v1/edit-image'))).toBe(false)
    expect(sent[0]?.url).toBe('https://gateway.pixazo.ai/v2/requests/status/seedream-5-5_earlier')
  })

  it('says what became of a request asked about by its id', async () => {
    const done = fakeFetch([['/v2/requests/status/', { body: fixture('pixazo-status-completed.json') }]])
    expect(await pixazoSeller('k', { fetch: done.fetch }).status?.('id', EDIT)).toEqual({
      state: 'done',
      usage: { picture: 1, 'reference-picture': 1 },
    })
    const failed = fakeFetch([['/v2/requests/status/', { body: JSON.stringify({ status: 'ERROR', error: 'x' }) }]])
    expect(await pixazoSeller('k', { fetch: failed.fetch }).status?.('id', EDIT)).toEqual({ state: 'failed' })
  })

  it('reads an error answer as the retry rules say', async () => {
    const failures = []
    for (const status of [429, 500, 402, 400]) {
      const body = JSON.stringify({ error: 'x', message: 'test' })
      const { fetch } = fakeFetch([['/v1/edit-image', { status, body }]])
      const error = await pixazoSeller('k', { fetch })
        .call(requestOf(EDIT, []))
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(SellerError)
      failures.push(sellerFailure(error))
    }
    expect(failures).toEqual(['retry', 'retry', 'next-seller', 'fail'])
  })
})
