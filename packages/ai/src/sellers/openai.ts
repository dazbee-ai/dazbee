// OpenAI's adapter: text through the Responses API, with a JSON schema when the call gives one, and pictures
// through the Images API (generate and edit) as base64 PNG, with the usage OpenAI reports by kind of token
// and its request id. Written from OpenAI's API reference and price list as read on 25 Nov 2026. Also the
// pieces Meta's adapter shares, since Meta's API is OpenAI-compatible.
import OpenAI, { APIError, toFile } from 'openai'

import { readImageHeader, type TextCall, type Usage } from '@dazbee/schema'

import type { CostReport } from '../daily-check.ts'
import { type SellerAdapter, type SellerAnswer, SellerError, type SellerRequest } from './seller.ts'

/** What an OpenAI-compatible picture answer holds, as both OpenAI and Meta give it. */
export interface PictureAnswer {
  data?: { b64_json?: string | null }[] | null
  usage?: {
    input_tokens?: number
    input_tokens_details?: { image_tokens?: number; text_tokens?: number }
    output_tokens?: number
  } | null
}

/** How an adapter reaches its seller: tests give a `fetch` that answers from recorded answers. */
export interface SellerClientOptions {
  fetch?: typeof fetch
  baseURL?: string
}

/** The most picture calls a minute we make of OpenAI: below the lowest images-per-minute limit of its paid tiers. */
const PICTURES_PER_MINUTE = 20

/** The quality a picture call asks for unless its AI step's options say otherwise. */
const QUALITY = 'medium'

/** OpenAI's adapter on `apiKey`. */
export function openaiSeller(apiKey: string, options: SellerClientOptions = {}): SellerAdapter {
  const client = sellerClient(apiKey, options)
  return {
    seller: 'openai',
    perMinute: { picture: PICTURES_PER_MINUTE, 'picture-edit': PICTURES_PER_MINUTE },
    call: (request) => answerOrSellerError(() => callOpenai(client, request)),
  }
}

/** An OpenAI SDK client that retries nothing and times out never: the call function does both. */
export function sellerClient(apiKey: string, { fetch, baseURL }: SellerClientOptions): OpenAI {
  return new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: 20 * 60_000,
    ...(fetch ? { fetch } : {}),
    ...(baseURL ? { baseURL } : {}),
  })
}

/** Runs `call`, turning an error answer into a `SellerError` with its status and code. */
export async function answerOrSellerError(call: () => Promise<SellerAnswer>): Promise<SellerAnswer> {
  try {
    return await call()
  } catch (error) {
    if (error instanceof APIError && error.status !== undefined) {
      throw new SellerError(error.message, { status: error.status, code: error.code ?? error.type ?? undefined })
    }
    throw error
  }
}

/** The size an OpenAI-compatible picture call asks for: the call's own, each side a multiple of 16. */
export function pictureSize(input: { width: number; height: number }): `${number}x${number}` {
  return `${roundTo16(input.width)}x${roundTo16(input.height)}`
}

/** The reference pictures of an edit, as files to upload. */
export async function pictureFiles(request: SellerRequest, keys: string[]) {
  return Promise.all(
    keys.map(async (key, i) => {
      const bytes = await request.readPicture(key)
      const type = readImageHeader(bytes)?.contentType ?? 'image/png'
      return toFile(bytes, `picture-${i}.${type.split('/')[1]}`, { type })
    }),
  )
}

/** A picture answer: its one picture, sized from its own header, with the request id and `usage`. */
export function pictureAnswer(data: PictureAnswer, requestId: string | null, usage: Usage): SellerAnswer {
  const b64 = data.data?.[0]?.b64_json
  if (!b64) throw new Error('the answer holds no picture')
  const bytes = new Uint8Array(Buffer.from(b64, 'base64'))
  const header = readImageHeader(bytes)
  if (!header) throw new Error('the answer’s picture is not a picture')
  const answer: SellerAnswer = {
    output: {
      kind: 'pictures',
      pictures: [{ bytes, type: header.contentType, width: header.width, height: header.height }],
    },
    usage,
  }
  if (requestId) answer.requestId = requestId
  return answer
}

/**
 * A text call through the Responses API, with a JSON schema when the call gives one: its text (and JSON), its
 * usage by kind of token, the request id from `requestIdHeader`, and the seller's own cost where its usage
 * holds one (OpenRouter's `usage.cost`).
 */
export async function responsesText(
  client: OpenAI,
  request: SellerRequest,
  input: TextCall,
  requestIdHeader = 'x-request-id',
): Promise<SellerAnswer> {
  const pictures = await Promise.all(
    input.pictures.map(async (key) => ({
      type: 'input_image' as const,
      detail: 'auto' as const,
      image_url: await dataUrl(request, key),
    })),
  )
  const { data, response } = await client.responses
    .create(
      {
        model: request.model,
        instructions: input.instructions,
        input: [{ role: 'user', content: [{ type: 'input_text', text: input.prompt }, ...pictures] }],
        ...(input.schema
          ? { text: { format: { type: 'json_schema', name: 'answer', schema: input.schema, strict: true } } }
          : {}),
        ...(input.maxOutputTokens ? { max_output_tokens: input.maxOutputTokens } : {}),
        store: false,
      },
      { signal: request.signal },
    )
    .withResponse()
  const cached = data.usage?.input_tokens_details.cached_tokens ?? 0
  const answer: SellerAnswer = {
    output: { kind: 'text', text: data.output_text, ...(input.schema ? { json: JSON.parse(data.output_text) } : {}) },
    // Reasoning tokens are billed as output tokens, and are counted in them.
    usage: {
      'input-token': (data.usage?.input_tokens ?? 0) - cached,
      'cached-input-token': cached,
      'output-token': data.usage?.output_tokens ?? 0,
    },
  }
  const reported = (data.usage as { cost?: unknown } | undefined)?.cost
  if (typeof reported === 'number') answer.reportedCost = reported
  const requestId = response.headers.get(requestIdHeader) ?? data.id
  if (requestId) answer.requestId = requestId
  return answer
}

/** A stored picture as a data URL, as sellers take pictures inline. */
export async function dataUrl(request: SellerRequest, key: string): Promise<string> {
  const bytes = await request.readPicture(key)
  const type = readImageHeader(bytes)?.contentType ?? 'image/png'
  return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`
}

/** A GPT Image answer's usage: text and picture tokens in, and every token out, which is the picture's. */
export function gptImageUsage(data: PictureAnswer): Usage {
  const details = data.usage?.input_tokens_details
  return {
    'input-token': details?.text_tokens ?? 0,
    'image-input-token': details?.image_tokens ?? 0,
    'image-output-token': data.usage?.output_tokens ?? 0,
  }
}

async function callOpenai(client: OpenAI, request: SellerRequest): Promise<SellerAnswer> {
  const { input } = request
  if (input.kind === 'text') return responsesText(client, request, input)
  if (input.kind === 'layer-split') throw new SellerError('OpenAI makes no layer split', { status: 400 })
  const common = {
    model: request.model,
    prompt: input.prompt,
    size: pictureSize(input),
    quality: String(request.options.quality ?? QUALITY) as 'medium',
    output_format: 'png' as const,
    n: 1,
  }
  const { data, response } =
    input.kind === 'picture'
      ? await client.images.generate(common, { signal: request.signal }).withResponse()
      : await client.images
          .edit({ ...common, image: await pictureFiles(request, input.pictures) }, { signal: request.signal })
          .withResponse()
  return pictureAnswer(data, response.headers.get('x-request-id'), gptImageUsage(data))
}

function roundTo16(value: number): number {
  return Math.max(16, Math.round(value / 16) * 16)
}

/**
 * OpenAI's cost for a UTC day from its Costs API (an admin key), for one project when `projectId` is given:
 * the sum of the day's bucket, in dollars before tax; null when OpenAI gives no bucket for the day yet.
 */
export function openaiCostReport({
  adminKey,
  projectId,
  fetch: fetchOf = globalThis.fetch,
}: {
  adminKey: string
  projectId?: string | undefined
  fetch?: typeof fetch
}): CostReport {
  return async (day) => {
    const start = Date.parse(`${day}T00:00:00Z`) / 1000
    const query = new URLSearchParams({
      start_time: String(start),
      end_time: String(start + 86_400),
      bucket_width: '1d',
      limit: '1',
      ...(projectId ? { project_ids: projectId } : {}),
    })
    const response = await fetchOf(`https://api.openai.com/v1/organization/costs?${query}`, {
      headers: { authorization: `Bearer ${adminKey}` },
    })
    if (!response.ok) throw new Error(`OpenAI's Costs API answered ${response.status}`)
    const body = (await response.json()) as {
      data?: { start_time?: number; results?: { amount?: { value?: number } }[] }[]
    }
    const bucket = body.data?.find((b) => b.start_time === start)
    if (!bucket) return null
    const cost = (bucket.results ?? []).reduce((sum, r) => sum + (r.amount?.value ?? 0), 0)
    return { currency: 'USD', cost }
  }
}
