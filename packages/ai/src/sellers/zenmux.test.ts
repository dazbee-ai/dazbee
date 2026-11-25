// ZenMux's adapter on its recorded Seedream answer and on answers shaped as its OpenAI protocol gives them,
// priced from the migration's price list. No call leaves the machine.
import { describe, expect, it } from 'vitest'

import type { CallInput } from '@dazbee/schema'

import { priceUsage } from '../price-list.ts'
import { db } from '../test-ai.ts'
import { SellerError, sellerFailure, type SellerRequest } from './seller.ts'
import { fakeFetch, fixture, referencesOf,testPicture } from './test-fetch.ts'
import { nearestAspect, zenmuxSeller } from './zenmux.ts'

const EDIT: CallInput = {
  kind: 'picture',
  prompt: 'Make it square.',
  pictures: ['workspaces/w/originals/a'],
  width: 1080,
  height: 1920,
}
const TEXT: CallInput = { kind: 'text', instructions: 'List ideas.', prompt: 'A coffee ad.', pictures: [], schema: {} }

/** A chat completion as ZenMux's OpenAI protocol gives one. */
const CHAT = JSON.stringify({
  id: 'chatcmpl-test',
  choices: [{ index: 0, message: { role: 'assistant', content: '{"ideas":["Bold"]}' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 120, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 20 } },
})

function requestOf(input: CallInput, model: string): SellerRequest {
  return {
    model,
    input,
    options: {},
    signal: new AbortController().signal,
    readPicture: async () => testPicture(),
    references: referencesOf(input, () => testPicture()),
    keepRequestId: async () => undefined,
  }
}

describe('zenmuxSeller', () => {
  it('edits with Seedream through the Vertex protocol, priced per picture and reference', async () => {
    const { fetch, sent } = fakeFetch([
      [':predict', { body: fixture('zenmux-seedream.json'), headers: { 'X-ZenMux-RequestId': 'zm-test' } }],
    ])
    const answer = await zenmuxSeller('test-key', { fetch }).call(requestOf(EDIT, 'bytedance/doubao-seedream-5.5'))
    expect(sent[0]?.url).toBe(
      'https://zenmux.ai/api/vertex-ai/v1/publishers/bytedance/models/doubao-seedream-5.5:predict',
    )
    const body = JSON.parse(String(sent[0]?.body))
    expect(body.parameters).toEqual({ sampleCount: 1, aspectRatio: '9:16', sampleImageSize: '1K' })
    expect(body.imageSize).toBe('1K')
    expect(body.instances[0].referenceImages[0]).toMatchObject({ referenceType: 'REFERENCE_TYPE_RAW', referenceId: 1 })
    expect(answer).toMatchObject({ usage: { picture: 1, 'reference-picture': 1 }, requestId: 'zm-test' })
    // US$0.02 a picture, and no charge for a reference: what ZenMux's log billed in the bill check.
    expect(await priceUsage(db, 'zenmux', 'seedream-5.5', answer.usage)).toMatchObject({ sellerCost: 20_000n })
  })

  it('makes a new Seedream picture with no references through the Vertex protocol', async () => {
    const { fetch, sent } = fakeFetch([[':predict', { body: fixture('zenmux-seedream.json') }]])
    const picture: CallInput = { kind: 'picture', prompt: 'A cup.', pictures: [], width: 1024, height: 1024 }
    const answer = await zenmuxSeller('test-key', { fetch }).call(requestOf(picture, 'bytedance/doubao-seedream-5.5'))
    expect(JSON.parse(String(sent[0]?.body)).instances[0].referenceImages).toBeUndefined()
    expect(answer.usage).toEqual({ picture: 1, 'reference-picture': 0 })
  })

  it('answers text through chat completions, with cached tokens apart', async () => {
    const { fetch, sent } = fakeFetch([
      ['/chat/completions', { body: CHAT, headers: { 'X-ZenMux-RequestId': 'zm-text' } }],
    ])
    const answer = await zenmuxSeller('test-key', { fetch }).call(requestOf(TEXT, 'openai/gpt-6-luna'))
    expect(sent[0]?.url).toBe('https://zenmux.ai/api/v1/chat/completions')
    expect(JSON.parse(String(sent[0]?.body)).response_format.type).toBe('json_schema')
    expect(answer).toMatchObject({
      output: { kind: 'text', json: { ideas: ['Bold'] } },
      usage: { 'input-token': 100, 'cached-input-token': 20, 'output-token': 40 },
      requestId: 'zm-text',
    })
  })

  it('makes Muse pictures through its OpenAI Images API, priced per picture', async () => {
    const { fetch, sent } = fakeFetch([['/images/generations', { body: fixture('meta-images.json') }]])
    const picture: CallInput = { kind: 'picture', prompt: 'A cup.', pictures: [], width: 1024, height: 1024 }
    const answer = await zenmuxSeller('test-key', { fetch }).call(requestOf(picture, 'meta/muse-image-1.0'))
    expect(sent[0]?.url).toBe('https://zenmux.ai/api/v1/images/generations')
    expect(answer.usage).toEqual({ picture: 1 })
  })

  it('edits with Muse through its OpenAI Images API when the call has references', async () => {
    const { fetch, sent } = fakeFetch([['/images/edits', { body: fixture('meta-images.json') }]])
    const answer = await zenmuxSeller('test-key', { fetch }).call(requestOf(EDIT, 'meta/muse-image-1.0'))
    expect(sent[0]?.url).toBe('https://zenmux.ai/api/v1/images/edits')
    expect(answer.usage).toEqual({ picture: 1 })
  })

  it('reads a Vertex error answer as the retry rules say', async () => {
    const failures = []
    for (const status of [429, 503, 402, 400]) {
      const body = JSON.stringify({ error: { message: 'test', code: status } })
      const { fetch } = fakeFetch([[':predict', { status, body }]])
      const error = await zenmuxSeller('test-key', { fetch })
        .call(requestOf(EDIT, 'bytedance/doubao-seedream-5.5'))
        .catch((e: unknown) => e)
      expect(error).toBeInstanceOf(SellerError)
      failures.push(sellerFailure(error))
    }
    expect(failures).toEqual(['retry', 'retry', 'next-seller', 'fail'])
  })
})

describe('nearestAspect', () => {
  it('gives the closest aspect ratio the Vertex protocol takes', () => {
    expect([nearestAspect(1080, 1350), nearestAspect(1200, 628), nearestAspect(1024, 1024)]).toEqual([
      '3:4',
      '16:9',
      '1:1',
    ])
  })
})
