// OpenRouter's adapter on an answer shaped as OpenRouter's docs give it, and on its recorded answer when out of
// credit, priced from the migration's price list. No call leaves the machine.
import { describe, expect, it } from 'vitest'

import type { CallInput } from '@dazbee/schema'

import { priceUsage } from '../price-list.ts'
import { db } from '../test-ai.ts'
import { aspectOf, openrouterSeller, resolutionOf } from './openrouter.ts'
import { SellerCutOff, SellerError, sellerFailure, type SellerRequest } from './seller.ts'
import { fakeFetch, fixture, referencesOf, testPicture } from './test-fetch.ts'

const EDIT: CallInput = {
  kind: 'picture',
  prompt: 'Make it square.',
  pictures: ['workspaces/w/originals/a'],
  width: 1080,
  height: 1350,
}

/** A picture answer as OpenRouter's Images API docs give it, with its own cost. */
const IMAGES = JSON.stringify({
  id: 'gen-test',
  data: [{ b64_json: fixture('picture.png.b64').trim() }],
  usage: { cost: 0.028 },
})

function requestOf(input: CallInput): SellerRequest {
  return {
    model: 'bytedance-seed/seedream-5-5',
    input,
    options: {},
    signal: new AbortController().signal,
    readPicture: async () => testPicture(),
    references: referencesOf(input, () => testPicture()),
    keepRequestId: async () => undefined,
  }
}

describe('openrouterSeller', () => {
  it('makes an edit with its reference pictures, priced per picture and reference, keeping OpenRouter’s cost', async () => {
    const { fetch, sent } = fakeFetch([['/images', { body: IMAGES }]])
    const answer = await openrouterSeller('test-key', { fetch }).call(requestOf(EDIT))
    expect(sent[0]?.url).toBe('https://openrouter.ai/api/v1/images')
    const body = JSON.parse(String(sent[0]?.body))
    expect(body).toMatchObject({ model: 'bytedance-seed/seedream-5-5', resolution: '1.5K', aspect_ratio: '4:5' })
    expect(body.input_references[0].image_url.url).toMatch(/^data:image\/png;base64,/)
    expect(answer).toMatchObject({
      usage: { picture: 1, 'reference-picture': 1 },
      requestId: 'gen-test',
      reportedCost: 0.028,
    })
    // US$0.02 a picture and US$0.008 a reference, with OpenRouter's fee and GST on credit (24.49%), at ₹96.31.
    expect(await priceUsage(db, 'openrouter', 'seedream-5.5', answer.usage)).toEqual({
      currency: 'USD',
      sellerCost: 28_000n,
      realCost: 3_357_097n,
    })
  })

  it('makes a new picture with no references, and sends marks as one more reference', async () => {
    const plain = fakeFetch([['/images', { body: IMAGES }]])
    const made = await openrouterSeller('test-key', { fetch: plain.fetch }).call(
      requestOf({ kind: 'picture', prompt: 'A cup.', pictures: [], width: 1024, height: 1024 }),
    )
    expect(JSON.parse(String(plain.sent[0]?.body)).input_references).toBeUndefined()
    expect(made.usage).toEqual({ picture: 1, 'reference-picture': 0 })
    const marked = fakeFetch([['/images', { body: IMAGES }]])
    const edited = await openrouterSeller('test-key', { fetch: marked.fetch }).call(
      requestOf({ ...EDIT, marks: 'workspaces/w/originals/marks' } as CallInput),
    )
    expect(JSON.parse(String(marked.sent[0]?.body)).input_references).toHaveLength(2)
    expect(edited.usage).toEqual({ picture: 1, 'reference-picture': 2 })
  })

  it('reads a text answer cut off at its output limit as cut off with its usage', async () => {
    const cut = JSON.stringify({
      id: 'gen-cut',
      object: 'response',
      status: 'incomplete',
      incomplete_details: { reason: 'max_output_tokens' },
      output: [],
      usage: { input_tokens: 50, input_tokens_details: { cached_tokens: 0 }, output_tokens: 900, cost: 0.001 },
    })
    const text: CallInput = {
      kind: 'text',
      instructions: 'List.',
      prompt: 'An ad.',
      pictures: [],
      maxOutputTokens: 900,
    }
    for (const input of [text, { ...text, schema: { type: 'object' } }]) {
      const { fetch, sent } = fakeFetch([['/responses', { body: cut }]])
      const error = await openrouterSeller('test-key', { fetch })
        .call({ ...requestOf(input), model: 'openai/gpt-6-luna' })
        .catch((e: unknown) => e)
      expect(JSON.parse(String(sent[0]?.body)).max_output_tokens).toBe(900)
      expect(error).toBeInstanceOf(SellerCutOff)
      expect((error as SellerCutOff).usage).toEqual({ 'input-token': 50, 'cached-input-token': 0, 'output-token': 900 })
      expect((error as SellerCutOff).reportedCost).toBe(0.001)
    }
  })

  it('reads its recorded out-of-credit answer as a seller out of money', async () => {
    const { fetch } = fakeFetch([['/images', { status: 402, body: fixture('openrouter-402.json') }]])
    const error = await openrouterSeller('test-key', { fetch })
      .call(requestOf(EDIT))
      .catch((e: unknown) => e)
    expect(error).toBeInstanceOf(SellerError)
    expect(sellerFailure(error)).toBe('next-seller')
  })
})

describe('resolutionOf', () => {
  it('gives the tier a picture’s pixels fall in', () => {
    expect([resolutionOf(1024, 1024), resolutionOf(1080, 1350), resolutionOf(2048, 2048)]).toEqual(['1K', '1.5K', '2K'])
  })
})

describe('aspectOf', () => {
  it('gives the aspect ratio OpenRouter takes closest to a size', () => {
    expect([aspectOf(1080, 1350), aspectOf(1920, 1080), aspectOf(1200, 628)]).toEqual(['4:5', '16:9', '16:9'])
  })
})
