// OpenAI's adapter on recorded answers (fixtures/), priced from the migration's price list, and its error
// answers read as the retry rules say. No call leaves the machine.
import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import type { CallInput } from '@dazbee/schema'

import { priceUsage } from '../price-list.ts'
import { db } from '../test-ai.ts'
import { openaiSeller } from './openai.ts'
import { SellerCutOff, SellerError, sellerFailure, type SellerRequest } from './seller.ts'
import { referencesOf } from './test-fetch.ts'

/** A request a fake fetch saw: its URL and body. */
interface Seen {
  url: string
  body: unknown
}

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')

const TEXT: CallInput = {
  kind: 'text',
  instructions: 'List three short layout ideas for the ad.',
  prompt: 'A spring sale for a coffee shop.',
  pictures: ['workspaces/w/originals/a'],
  schema: { type: 'object', properties: { ideas: { type: 'array', items: { type: 'string' } } } },
}
const PICTURE: CallInput = { kind: 'picture', prompt: 'A coffee cup.', pictures: [], width: 1024, height: 1024 }
const EDIT: CallInput = {
  kind: 'picture',
  prompt: 'Make it square.',
  pictures: ['workspaces/w/originals/a'],
  width: 1080,
  height: 1080,
}

/** An adapter whose fetch answers `status` with `body`, and the requests it was sent. */
function answering(status: number, body: string) {
  const seen: Seen[] = []
  const fetch = (async (url: string, init?: RequestInit) => {
    // The SDK probes fetch with a data: URL before it sends a form; only calls to the seller are kept.
    if (!String(url).startsWith('data:')) seen.push({ url: String(url), body: init?.body })
    return new Response(body, { status, headers: { 'content-type': 'application/json', 'x-request-id': 'req_test' } })
  }) as typeof globalThis.fetch
  return { seller: openaiSeller('test-key', { fetch }), seen }
}

function requestOf(input: CallInput, options: Record<string, unknown> = {}): SellerRequest {
  return {
    model: input.kind === 'text' ? 'gpt-6-luna' : 'gpt-image-2.5-sunburst',
    input,
    options,
    signal: new AbortController().signal,
    readPicture: async () =>
      new Uint8Array(Buffer.from(JSON.parse(fixture('openai-images.json')).data[0].b64_json, 'base64')),
    references: referencesOf(
      input,
      () => new Uint8Array(Buffer.from(JSON.parse(fixture('openai-images.json')).data[0].b64_json, 'base64')),
    ),
    keepRequestId: async () => undefined,
  }
}

const errorBody = (type: string, code: string | null) =>
  JSON.stringify({ error: { message: `test ${type}`, type, code, param: null } })

describe('openaiSeller', () => {
  it('reads a text answer: its JSON, its usage by kind of token and its request id, at its real cost', async () => {
    const { seller, seen } = answering(200, fixture('openai-responses-text.json'))
    const answer = await seller.call(requestOf(TEXT))
    expect(seen[0]?.url).toBe('https://api.openai.com/v1/responses')
    const sent = JSON.parse(String(seen[0]?.body))
    expect(sent.text.format).toMatchObject({ type: 'json_schema', name: 'answer', strict: true })
    expect(sent.input[0].content[1].image_url).toMatch(/^data:image\/png;base64,/)
    expect(answer.output).toMatchObject({ kind: 'text', json: { ideas: expect.any(Array) } })
    expect(answer.usage).toEqual({ 'input-token': 69, 'cached-input-token': 0, 'output-token': 109 })
    expect(answer.requestId).toBe('req_test')
    // 69 tokens at US$0.10 and 109 at US$0.50 a million, with 18% GST at ₹96.31.
    expect(await priceUsage(db, 'openai', 'gpt-6-luna', answer.usage)).toEqual({
      currency: 'USD',
      sellerCost: 61n,
      realCost: 6_978n,
    })
  })

  it('sends the call’s output limit, and reads an answer cut off at it, with or without a schema, as cut off with its usage', async () => {
    const recorded = JSON.parse(fixture('openai-responses-text.json')) as Record<string, unknown>
    // The same answer, stopped at its output limit partway through its JSON.
    const cut = JSON.stringify({
      ...recorded,
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [
        {
          id: 'msg_cut',
          type: 'message',
          role: 'assistant',
          status: 'incomplete',
          content: [{ type: 'output_text', text: '{"ideas":["Bo', annotations: [] }],
        },
      ],
    })
    for (const input of [
      { ...TEXT, maxOutputTokens: 900 },
      { ...TEXT, schema: undefined, maxOutputTokens: 900 },
    ]) {
      const { seller, seen } = answering(200, cut)
      const error = await seller.call(requestOf(input as CallInput)).catch((e: unknown) => e)
      expect(JSON.parse(String(seen[0]?.body)).max_output_tokens).toBe(900)
      expect(error).toBeInstanceOf(SellerCutOff)
      expect((error as SellerCutOff).usage).toEqual({ 'input-token': 69, 'cached-input-token': 0, 'output-token': 109 })
      expect(sellerFailure(error)).toBe('fail')
    }
  })

  it('reads a picture answer: its picture at its own size, and its text and picture tokens, at its real cost', async () => {
    const { seller, seen } = answering(200, fixture('openai-images.json'))
    const answer = await seller.call(requestOf(PICTURE))
    expect(seen[0]?.url).toBe('https://api.openai.com/v1/images/generations')
    expect(JSON.parse(String(seen[0]?.body))).toMatchObject({
      size: '1024x1024',
      quality: 'medium',
      output_format: 'png',
    })
    expect(answer.output).toMatchObject({ kind: 'pictures', pictures: [{ type: 'image/png', width: 16, height: 16 }] })
    expect(answer.usage).toEqual({ 'input-token': 34, 'image-input-token': 0, 'image-output-token': 439 })
    // 34 text tokens at US$5 and 439 picture tokens at US$30 a million: US$0.01334, as the bill check's call log shows.
    expect(await priceUsage(db, 'openai', 'gpt-image-2.5-sunburst', answer.usage)).toMatchObject({
      sellerCost: 13_340n,
    })
  })

  it('sends an edit’s reference pictures as files, at the step’s quality', async () => {
    const { seller, seen } = answering(200, fixture('openai-images.json'))
    await seller.call(requestOf(EDIT, { quality: 'low' }))
    expect(seen[0]?.url).toBe('https://api.openai.com/v1/images/edits')
    const form = seen[0]?.body
    if (!(form instanceof FormData)) throw new Error('the edit was not sent as a form')
    expect(form.get('quality')).toBe('low')
    expect(form.get('size')).toBe('1088x1088')
    expect(form.getAll('image[]').length + form.getAll('image').length).toBe(1)
  })

  it('reads error answers as the retry rules say', async () => {
    const failures = []
    for (const [status, body] of [
      [429, errorBody('requests', 'rate_limit_exceeded')],
      [503, errorBody('service_unavailable_error', 'server_is_overloaded')],
      [429, errorBody('insufficient_quota', 'insufficient_quota')],
      [400, errorBody('invalid_request_error', 'invalid_value')],
    ] as const) {
      const error = await answering(status, body)
        .seller.call(requestOf(TEXT))
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(SellerError)
      failures.push(sellerFailure(error))
    }
    expect(failures).toEqual(['retry', 'retry', 'next-seller', 'fail'])
  })
})
