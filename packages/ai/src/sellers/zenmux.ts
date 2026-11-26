// ZenMux's adapter: each model on the protocol ZenMux's docs give it. GPT text through the OpenAI protocol's
// chat completions, with the reasoning effort the preset's settings ask for and never a speed tier, which ZenMux
// takes none of, GPT Image and Muse through its OpenAI Images API, and Seedream through the Vertex AI protocol's
// predict call. Keeps `X-ZenMux-RequestId`. Written from ZenMux's docs and model list as read on 25 Nov 2026:
// Seedream takes a resolution tier and an aspect ratio, not pixel sizes; and its chat completion reference as
// read on 26 Nov 2026, which takes the effort as `reasoning_effort`.
import type OpenAI from 'openai'

import { readImageHeader, type TextCall, type Usage } from '@dazbee/schema'

import type { CostReport } from '../daily-check.ts'
import {
  answerOrSellerError,
  effortOf,
  gptImageUsage,
  makeOrEdit,
  pictureAnswer,
  pictureSize,
  pictureType,
  sellerClient,
  type SellerClientOptions,
} from './openai.ts'
import { type SellerAdapter, type SellerAnswer, SellerCutOff, SellerError, type SellerRequest } from './seller.ts'

/** ZenMux's OpenAI protocol. */
const OPENAI_URL = 'https://zenmux.ai/api/v1'

/** ZenMux's Vertex AI protocol. */
const VERTEX_URL = 'https://zenmux.ai/api/vertex-ai/v1'

/** The header ZenMux names each request by. */
const REQUEST_ID = 'x-zenmux-requestid'

/** The aspect ratios the Vertex protocol takes, as width ÷ height. */
const ASPECTS: [string, number][] = [
  ['1:1', 1],
  ['3:4', 3 / 4],
  ['4:3', 4 / 3],
  ['9:16', 9 / 16],
  ['16:9', 16 / 9],
]

/** ZenMux's adapter on `apiKey`. */
export function zenmuxSeller(apiKey: string, options: SellerClientOptions = {}): SellerAdapter {
  const client = sellerClient(apiKey, { baseURL: OPENAI_URL, ...options })
  const fetchOf = options.fetch ?? globalThis.fetch
  return {
    seller: 'zenmux',
    call: (request) =>
      answerOrSellerError(() =>
        request.model.startsWith('bytedance/')
          ? vertexPicture(fetchOf, apiKey, request)
          : callOpenaiProtocol(client, request),
      ),
  }
}

/** The aspect ratio the Vertex protocol takes closest to `width` × `height`. */
export function nearestAspect(width: number, height: number): string {
  const ratio = width / height
  return ASPECTS.reduce((best, next) => (Math.abs(next[1] - ratio) < Math.abs(best[1] - ratio) ? next : best))[0]
}

async function callOpenaiProtocol(client: OpenAI, request: SellerRequest): Promise<SellerAnswer> {
  const { input } = request
  if (input.kind === 'text') return chatText(client, request, input)
  if (input.kind === 'layer-split') throw new SellerError('ZenMux makes no layer split', { status: 400 })
  const common = {
    model: request.model,
    prompt: input.prompt,
    size: pictureSize(input),
    n: 1,
    // GPT Image takes the preset's quality; Muse takes none.
    ...(request.model.startsWith('openai/')
      ? { quality: String(request.options.quality ?? 'medium') as 'medium' }
      : {}),
  }
  const { data, response } = await makeOrEdit(client, request, common)
  // Muse is billed per picture made; GPT Image by its tokens.
  const usage: Usage = request.model.startsWith('meta/') ? { picture: data.data?.length ?? 0 } : gptImageUsage(data)
  return pictureAnswer(data, response.headers.get(REQUEST_ID), usage)
}

async function chatText(client: OpenAI, request: SellerRequest, input: TextCall): Promise<SellerAnswer> {
  const effort = effortOf(request.options)
  const pictures = await Promise.all(
    input.pictures.map(async (key) => {
      const bytes = await request.readPicture(key)
      const type = readImageHeader(bytes)?.contentType ?? 'image/png'
      return {
        type: 'image_url' as const,
        image_url: { url: `data:${type};base64,${Buffer.from(bytes).toString('base64')}` },
      }
    }),
  )
  const { data, response } = await client.chat.completions
    .create(
      {
        model: request.model,
        messages: [
          { role: 'system', content: input.instructions },
          { role: 'user', content: [{ type: 'text', text: input.prompt }, ...pictures] },
        ],
        ...(input.schema
          ? {
              response_format: {
                type: 'json_schema',
                json_schema: { name: 'answer', schema: input.schema, strict: true },
              },
            }
          : {}),
        ...(input.maxOutputTokens ? { max_completion_tokens: input.maxOutputTokens } : {}),
        ...(effort ? { reasoning_effort: effort } : {}),
      },
      { signal: request.signal },
    )
    .withResponse()
  const text = data.choices[0]?.message.content ?? ''
  const cached = data.usage?.prompt_tokens_details?.cached_tokens ?? 0
  const usage: Usage = {
    'input-token': (data.usage?.prompt_tokens ?? 0) - cached,
    'cached-input-token': cached,
    'output-token': data.usage?.completion_tokens ?? 0,
  }
  const requestId = response.headers.get(REQUEST_ID) ?? data.id
  if (data.choices[0]?.finish_reason === 'length') throw new SellerCutOff(usage, requestId)
  const answer: SellerAnswer = {
    output: { kind: 'text', text, ...(input.schema ? { json: JSON.parse(text) } : {}) },
    usage,
  }
  if (requestId) answer.requestId = requestId
  return answer
}

/** A Seedream picture or edit through the Vertex protocol's predict call, billed per picture made and per reference. */
async function vertexPicture(fetchOf: typeof fetch, apiKey: string, request: SellerRequest): Promise<SellerAnswer> {
  const { input } = request
  if (input.kind !== 'picture') {
    throw new SellerError(`ZenMux's Vertex protocol makes no ${input.kind} call`, { status: 400 })
  }
  const references = await request.references()
  const referenceImages = references.map((bytes, i) => ({
    referenceType: 'REFERENCE_TYPE_RAW',
    referenceId: i + 1,
    referenceImage: { bytesBase64Encoded: Buffer.from(bytes).toString('base64'), mimeType: pictureType(bytes) },
  }))
  const [publisher, model] = request.model.split('/')
  const response = await fetchOf(`${VERTEX_URL}/publishers/${publisher}/models/${model}:predict`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      instances: [{ prompt: input.prompt, ...(referenceImages.length > 0 ? { referenceImages } : {}) }],
      parameters: { sampleCount: 1, aspectRatio: nearestAspect(input.width, input.height), sampleImageSize: '1K' },
      // ZenMux passes a top-level imageSize through to the model; without it Seedream makes 2K at the 2K price.
      imageSize: '1K',
    }),
    signal: request.signal,
  })
  const body = (await response.json().catch(() => ({}))) as {
    predictions?: { bytesBase64Encoded?: string }[]
    error?: { message?: string; code?: string | number; status?: string }
  }
  if (!response.ok) {
    throw new SellerError(body.error?.message ?? `ZenMux answered ${response.status}`, {
      status: response.status,
      code: body.error?.status ?? (body.error?.code === undefined ? undefined : String(body.error.code)),
    })
  }
  const pictures = (body.predictions ?? []).map((p) => ({ b64_json: p.bytesBase64Encoded ?? null }))
  return pictureAnswer({ data: pictures }, response.headers.get(REQUEST_ID), {
    picture: pictures.length,
    'reference-picture': references.length,
  })
}

/**
 * ZenMux's cost for a UTC day from its management cost API (a personal management key), for one API key when
 * `keyId` is given: its pay-as-you-go total in dollars; null while ZenMux has no figure for the day.
 */
export function zenmuxCostReport({
  managementKey,
  keyId,
  fetch: fetchOf = globalThis.fetch,
}: {
  managementKey: string
  keyId?: string | undefined
  fetch?: typeof fetch
}): CostReport {
  return async (day) => {
    const query = new URLSearchParams({
      type: 'cost',
      query_dimension: 'BIZ_DT',
      query_time: day.replaceAll('-', ''),
      bill_types: 'metered',
      ...(keyId ? { api_key_ids: keyId } : {}),
    })
    const response = await fetchOf(`${OPENAI_URL}/management/cost?${query}`, {
      headers: { authorization: `Bearer ${managementKey}` },
    })
    if (!response.ok) throw new Error(`ZenMux's cost API answered ${response.status}`)
    const body = (await response.json()) as { data?: { summary?: { totalCost?: string | null } } }
    const total = body.data?.summary?.totalCost
    return total === null || total === undefined ? null : { currency: 'USD', cost: Number(total) }
  }
}
