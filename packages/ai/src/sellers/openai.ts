// OpenAI's adapter: text through the Responses API, with a JSON schema when the call gives one and the reasoning
// effort and speed tier its preset's settings ask for, and pictures through the Images API (generate and edit)
// as base64 PNG, with the usage OpenAI reports by kind of token, at the tier the call ran on, and its request id.
// Written from OpenAI's API reference and price list as read on 25 Nov 2026, its reasoning and Fast mode guides
// as read on 26 Nov 2026, and its prompt caching guide as read on 27 Nov 2026. Also the pieces Meta's and
// OpenRouter's adapters share, since their APIs are OpenAI-compatible.
import OpenAI, { APIError, toFile } from 'openai'

import { readImageHeader, type TextCall, type Usage } from '@dazbee/schema'

import type { CostReport } from '../daily-check.ts'
import { sizedReference } from './reference-size.ts'
import { type SellerAdapter, type SellerAnswer, SellerCutOff, SellerError, type SellerRequest } from './seller.ts'
import { atTier, type Tier, tierOf } from './tiers.ts'

/** What an OpenAI-compatible picture answer holds, as both OpenAI and Meta give it. */
export interface PictureAnswer {
  data?: { b64_json?: string | null }[] | null
  usage?: {
    input_tokens?: number
    input_tokens_details?: { image_tokens?: number; text_tokens?: number }
    output_tokens?: number
  } | null
}

/** What a picture call asks an OpenAI-compatible Images API for, whether it makes a picture or edits some. */
export type PictureParams = OpenAI.Images.ImageGenerateParamsNonStreaming &
  Omit<OpenAI.Images.ImageEditParamsNonStreaming, 'image'>

/** How an adapter reaches its seller: tests give a `fetch` that answers from recorded answers. */
export interface SellerClientOptions {
  fetch?: typeof fetch
  baseURL?: string
}

/** The most picture calls a minute we make of OpenAI: below the lowest images-per-minute limit of its paid tiers. */
const PICTURES_PER_MINUTE = 20

/** The quality a picture call asks for unless its preset's settings say otherwise. */
const QUALITY = 'medium'

/**
 * The `service_tier` OpenAI takes for each tier: `default` is standard, which a project set to Fast would not use
 * unasked.
 */
const SERVICE_TIERS = { standard: 'default', fast: 'fast' } as const satisfies Record<Tier, string>

/** The tier each `service_tier` an answer gives ran on: `priority` is the fast tier's former name. */
const ANSWERED_TIERS: Record<string, Tier> = { default: 'standard', flex: 'standard', fast: 'fast', priority: 'fast' }

/** OpenAI's adapter on `apiKey`. */
export function openaiSeller(apiKey: string, options: SellerClientOptions = {}): SellerAdapter {
  const client = sellerClient(apiKey, options)
  return {
    seller: 'openai',
    perMinute: { picture: PICTURES_PER_MINUTE },
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
export async function pictureFiles(pictures: Uint8Array[]) {
  return Promise.all(
    pictures.map((bytes, i) => {
      const type = pictureType(bytes)
      return toFile(bytes, `picture-${i}.${type.split('/')[1]}`, { type })
    }),
  )
}

/** A picture's MIME type, read from its header; PNG when the header is not one we read. */
export function pictureType(bytes: Uint8Array): string {
  return readImageHeader(bytes)?.contentType ?? 'image/png'
}

/** A picture as a data URL, as sellers take pictures inline. */
export function pictureDataUrl(bytes: Uint8Array): string {
  return `data:${pictureType(bytes)};base64,${Buffer.from(bytes).toString('base64')}`
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

/** The reasoning effort a preset's settings ask for, sent as the seller takes it; none when they set none. */
export function effortOf(options: Record<string, unknown>): OpenAI.ReasoningEffort | undefined {
  return typeof options.effort === 'string' ? (options.effort as OpenAI.ReasoningEffort) : undefined
}

/**
 * A text call through the Responses API, with a JSON schema when the call gives one and the reasoning effort its
 * preset's settings ask for, and, with `tiers`, the speed tier they ask for: its text (and JSON), its usage by
 * kind of token at the tier the answer says it ran on, the request id from `requestIdHeader`, and the seller's
 * own cost where its usage holds one (OpenRouter's `usage.cost`).
 *
 * With `cache`, the call's instructions are the one part the seller's prompt cache keeps: they go first, as a
 * developer message that ends in the call's only cache breakpoint, so every call with the same instructions reads
 * them from the cache, and the prompt and pictures after them, which differ from call to call, are never written
 * to it. The tokens written are counted apart, as the seller bills them. Without `cache` the instructions go as
 * the request's `instructions`.
 */
export async function responsesText(
  client: OpenAI,
  request: SellerRequest,
  input: TextCall,
  {
    requestIdHeader = 'x-request-id',
    tiers = false,
    cache = false,
  }: { requestIdHeader?: string; tiers?: boolean; cache?: boolean } = {},
): Promise<SellerAnswer> {
  const effort = effortOf(request.options)
  const asked = tierOf(request.options)
  const pictures = await Promise.all(
    input.pictures.map(async (key) => ({
      type: 'input_image' as const,
      detail: 'auto' as const,
      image_url: await dataUrl(request, key),
    })),
  )
  const user = { role: 'user' as const, content: [{ type: 'input_text' as const, text: input.prompt }, ...pictures] }
  const { data, response } = await client.responses
    .create(
      {
        model: request.model,
        ...(cache
          ? { input: [...cachedInstructions(input.instructions), user], prompt_cache_options: { mode: 'explicit' } }
          : { instructions: input.instructions, input: [user] }),
        ...(input.schema
          ? { text: { format: { type: 'json_schema', name: 'answer', schema: input.schema, strict: true } } }
          : {}),
        ...(input.maxOutputTokens ? { max_output_tokens: input.maxOutputTokens } : {}),
        ...(effort ? { reasoning: { effort } } : {}),
        ...(tiers ? { service_tier: SERVICE_TIERS[asked] } : {}),
        store: false,
      },
      { signal: request.signal },
    )
    .withResponse()
  const cached = data.usage?.input_tokens_details.cached_tokens ?? 0
  // The input tokens count those read from the cache and those written to it, each billed at a price of its own.
  const written = cache ? (data.usage?.input_tokens_details.cache_write_tokens ?? 0) : 0
  // Reasoning tokens are billed as output tokens, and are counted in them.
  const counted: Usage = {
    'input-token': (data.usage?.input_tokens ?? 0) - cached - written,
    'cached-input-token': cached,
    ...(cache ? { 'cache-write-input-token': written } : {}),
    'output-token': data.usage?.output_tokens ?? 0,
  }
  const usage = tiers ? atTier(counted, ranOn(data.service_tier, asked)) : counted
  const requestId = response.headers.get(requestIdHeader) ?? data.id
  const reported = (data.usage as { cost?: unknown } | undefined)?.cost
  if (data.status === 'incomplete' && data.incomplete_details?.reason === 'max_output_tokens') {
    throw new SellerCutOff(usage, requestId, typeof reported === 'number' ? reported : undefined)
  }
  const answer: SellerAnswer = {
    output: { kind: 'text', text: data.output_text, ...(input.schema ? { json: JSON.parse(data.output_text) } : {}) },
    usage,
  }
  if (typeof reported === 'number') answer.reportedCost = reported
  if (requestId) answer.requestId = requestId
  return answer
}

/**
 * A call's instructions as the developer message a request starts with, ending in a cache breakpoint; nothing for
 * a call with no instructions.
 */
function cachedInstructions(instructions: string) {
  if (!instructions) return []
  const text = {
    type: 'input_text' as const,
    text: instructions,
    prompt_cache_breakpoint: { mode: 'explicit' as const },
  }
  return [{ role: 'developer' as const, content: [text] }]
}

/** A stored picture as a data URL, as sellers take pictures inline. */
export async function dataUrl(request: SellerRequest, key: string): Promise<string> {
  return pictureDataUrl(await request.readPicture(key))
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

/**
 * A picture call through an OpenAI-compatible Images API: a new picture when the call has no reference
 * pictures, and an edit of all of them when it has some.
 */
export async function makeOrEdit(client: OpenAI, request: SellerRequest, params: PictureParams) {
  const references = await request.references()
  return references.length === 0
    ? client.images.generate(params, { signal: request.signal }).withResponse()
    : client.images
        .edit({ ...params, image: await pictureFiles(references) }, { signal: request.signal })
        .withResponse()
}

async function callOpenai(client: OpenAI, request: SellerRequest): Promise<SellerAnswer> {
  const { input } = request
  if (input.kind === 'text') return responsesText(client, request, input, { tiers: true, cache: true })
  if (input.kind === 'layer-split') throw new SellerError('OpenAI makes no layer split', { status: 400 })
  const common = {
    model: request.model,
    prompt: input.prompt,
    size: pictureSize(input),
    quality: String(request.options.quality ?? QUALITY) as 'medium',
    output_format: 'png' as const,
    n: 1,
  }
  // Each reference is sent no bigger than GPT Image bills the fewest image tokens for, one at a time.
  const references = async () => {
    const sized: Uint8Array[] = []
    for (const picture of await request.references()) sized.push(await sizedReference(picture))
    return sized
  }
  const { data, response } = await makeOrEdit(client, { ...request, references }, common)
  return pictureAnswer(data, response.headers.get('x-request-id'), gptImageUsage(data))
}

function roundTo16(value: number): number {
  return Math.max(16, Math.round(value / 16) * 16)
}

/**
 * The tier an answer ran on, from its `service_tier`: standard when it says `default`, as a fast call moved to
 * standard speed does and is billed at standard rates, fast when a fast call says fast; the tier asked for when it
 * names none, one we never ask for, or fast for a call that asked for standard, which is logged. A standard call is
 * so never counted in the fast units, which its model may have no price for.
 */
function ranOn(serviceTier: string | null | undefined, asked: Tier): Tier {
  if (!serviceTier) return asked
  const tier = ANSWERED_TIERS[serviceTier]
  if (tier && !(tier === 'fast' && asked === 'standard')) return tier
  console.warn(JSON.stringify({ msg: 'OpenAI answered on a tier we never ask for', serviceTier, asked }))
  return asked
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
