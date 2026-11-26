// ZenMux's adapter on its recorded Seedream answer and on answers shaped as its OpenAI protocol gives them,
// priced from the migration's price list. No call leaves the machine.
import { describe, expect, it } from 'vitest'

import type { CallInput } from '@dazbee/schema'

import { priceUsage } from '../price-list.ts'
import { db } from '../test-ai.ts'
import { SellerCutOff, SellerError, sellerFailure, type SellerRequest } from './seller.ts'
import { expectDeclared, fakeFetch, fixture, referencesOf, testPicture } from './test-fetch.ts'
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
    call: { job: 'job', function: 'reading', preset: 'luna', index: 0 },
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

  it('sends a marked copy to Seedream as one more reference, billed as one', async () => {
    const { fetch, sent } = fakeFetch([[':predict', { body: fixture('zenmux-seedream.json') }]])
    const marked = { ...EDIT, marks: 'workspaces/w/originals/marks' } as CallInput
    const answer = await zenmuxSeller('test-key', { fetch }).call(requestOf(marked, 'bytedance/doubao-seedream-5.5'))
    expect(JSON.parse(String(sent[0]?.body)).instances[0].referenceImages).toHaveLength(2)
    expect(answer.usage).toEqual({ picture: 1, 'reference-picture': 2 })
    expectDeclared('zenmux', 'picture', 'bytedance/doubao-seedream-5.5', answer.usage)
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
    expectDeclared('zenmux', 'text', 'openai/gpt-6-luna', answer.usage)
  })

  it('sends a text call’s reasoning effort as ZenMux takes it, and never a speed tier', async () => {
    const { fetch, sent } = fakeFetch([['/chat/completions', { body: CHAT }]])
    await zenmuxSeller('test-key', { fetch }).call({
      ...requestOf(TEXT, 'openai/gpt-6-luna'),
      options: { effort: 'none', tier: 'fast' },
    })
    const body = JSON.parse(String(sent[0]?.body))
    expect(body.reasoning_effort).toBe('none')
    expect(body.service_tier).toBeUndefined()
    const plain = fakeFetch([['/chat/completions', { body: CHAT }]])
    await zenmuxSeller('test-key', { fetch: plain.fetch }).call(requestOf(TEXT, 'openai/gpt-6-luna'))
    expect(JSON.parse(String(plain.sent[0]?.body)).reasoning_effort).toBeUndefined()
  })

  it('sends the call’s output limit, and reads an answer that stopped at it as cut off with its usage', async () => {
    const cut = JSON.stringify({
      id: 'chatcmpl-cut',
      choices: [{ index: 0, message: { role: 'assistant', content: '{"ideas":["Bo' }, finish_reason: 'length' }],
      usage: { prompt_tokens: 120, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 20 } },
    })
    for (const input of [TEXT, { ...TEXT, schema: undefined }]) {
      const { fetch, sent } = fakeFetch([['/chat/completions', { body: cut }]])
      const error = await zenmuxSeller('test-key', { fetch })
        .call(requestOf({ ...input, maxOutputTokens: 900 } as CallInput, 'openai/gpt-6-luna'))
        .catch((e: unknown) => e)
      expect(JSON.parse(String(sent[0]?.body)).max_completion_tokens).toBe(900)
      expect(error).toBeInstanceOf(SellerCutOff)
      expect((error as SellerCutOff).usage).toEqual({
        'input-token': 100,
        'cached-input-token': 20,
        'output-token': 40,
      })
    }
  })

  it('makes Muse pictures through its OpenAI Images API, priced per picture', async () => {
    const { fetch, sent } = fakeFetch([['/images/generations', { body: fixture('meta-images.json') }]])
    const picture: CallInput = { kind: 'picture', prompt: 'A cup.', pictures: [], width: 1024, height: 1024 }
    const answer = await zenmuxSeller('test-key', { fetch }).call(requestOf(picture, 'meta/muse-image-1.0'))
    expect(sent[0]?.url).toBe('https://zenmux.ai/api/v1/images/generations')
    expect(answer.usage).toEqual({ picture: 1 })
    expectDeclared('zenmux', 'picture', 'meta/muse-image-1.0', answer.usage)
  })

  it('edits with Muse through its OpenAI Images API when the call has references', async () => {
    const { fetch, sent } = fakeFetch([['/images/edits', { body: fixture('meta-images.json') }]])
    const answer = await zenmuxSeller('test-key', { fetch }).call(requestOf(EDIT, 'meta/muse-image-1.0'))
    expect(sent[0]?.url).toBe('https://zenmux.ai/api/v1/images/edits')
    expect(answer.usage).toEqual({ picture: 1 })
  })

  it('edits with GPT Image through its OpenAI Images API, reporting its tokens', async () => {
    const { fetch, sent } = fakeFetch([['/images/edits', { body: fixture('openai-images.json') }]])
    const answer = await zenmuxSeller('test-key', { fetch }).call(requestOf(EDIT, 'openai/gpt-image-2.5-sunburst'))
    expect(sent[0]?.url).toBe('https://zenmux.ai/api/v1/images/edits')
    expect(answer.usage).toEqual({ 'input-token': 34, 'image-input-token': 0, 'image-output-token': 439 })
    expectDeclared('zenmux', 'picture', 'openai/gpt-image-2.5-sunburst', answer.usage)
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
