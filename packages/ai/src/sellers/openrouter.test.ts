// OpenRouter's adapter on an answer shaped as OpenRouter's docs give it, and on its recorded answer when out of
// credit, priced from the migration's price list. No call leaves the machine.
import { describe, expect, it } from 'vitest'

import type { CallInput } from '@dazbee/schema'

import { priceUsage } from '../price-list.ts'
import { db } from '../test-ai.ts'
import { aspectOf, openrouterSeller, resolutionOf } from './openrouter.ts'
import { SellerError, sellerFailure, type SellerRequest } from './seller.ts'
import { fakeFetch, fixture, testPicture } from './test-fetch.ts'

const EDIT: CallInput = {
  kind: 'picture-edit',
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
    // US$0.02 a picture and US$0.008 a reference, with OpenRouter's fee and GST on credit (24.49%), at ₹96.1722.
    expect(await priceUsage(db, 'openrouter', 'seedream-5.5', answer.usage)).toEqual({
      currency: 'USD',
      sellerCost: 28_000n,
      realCost: 3_352_294n,
    })
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
