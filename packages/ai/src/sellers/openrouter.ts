// OpenRouter's adapter: text through its Responses API, and pictures (with reference pictures for an edit)
// through its Images API, keeping OpenRouter's own `usage.cost` beside our pricing and its generation id as
// the request id. Written from OpenRouter's docs as read on 25 Nov 2026: pictures come back as base64,
// Seedream 5.5 is priced per picture made and per reference picture, and its resolution is a tier.
import type OpenAI from 'openai'

import type { Usage } from '@dazbee/schema'

import type { CostReport } from '../daily-check.ts'
import {
  answerOrSellerError,
  dataUrl,
  pictureAnswer,
  responsesText,
  sellerClient,
  type SellerClientOptions,
} from './openai.ts'
import { type SellerAdapter, type SellerAnswer, SellerError, type SellerRequest } from './seller.ts'

/** What OpenRouter's Images API answers. */
interface ImagesAnswer {
  id?: string
  data?: { b64_json?: string | null }[]
  usage?: { cost?: number }
}

/** OpenRouter's API. */
const BASE_URL = 'https://openrouter.ai/api/v1'

/** The aspect ratios OpenRouter's Images API takes, as width ÷ height. */
const ASPECTS: [string, number][] = [
  ['1:1', 1],
  ['2:3', 2 / 3],
  ['3:2', 3 / 2],
  ['3:4', 3 / 4],
  ['4:3', 4 / 3],
  ['4:5', 4 / 5],
  ['5:4', 5 / 4],
  ['9:16', 9 / 16],
  ['16:9', 16 / 9],
  ['21:9', 21 / 9],
]

/** OpenRouter's adapter on `apiKey`. */
export function openrouterSeller(apiKey: string, options: SellerClientOptions = {}): SellerAdapter {
  const client = sellerClient(apiKey, { baseURL: BASE_URL, ...options })
  return {
    seller: 'openrouter',
    call: (request) => answerOrSellerError(() => callOpenrouter(client, request)),
  }
}

/** The resolution tier OpenRouter takes for a picture of `width` × `height`: its own pricing tiers. */
export function resolutionOf(width: number, height: number): '1K' | '1.5K' | '2K' {
  const pixels = width * height
  return pixels <= 1024 * 1024 ? '1K' : pixels <= 1536 * 1536 ? '1.5K' : '2K'
}

/** The aspect ratio OpenRouter takes closest to `width` × `height`. */
export function aspectOf(width: number, height: number): string {
  const ratio = width / height
  return ASPECTS.reduce((best, next) => (Math.abs(next[1] - ratio) < Math.abs(best[1] - ratio) ? next : best))[0]
}

async function callOpenrouter(client: OpenAI, request: SellerRequest): Promise<SellerAnswer> {
  const { input } = request
  if (input.kind === 'text') return responsesText(client, request, input)
  if (input.kind === 'layer-split') throw new SellerError('OpenRouter makes no layer split', { status: 400 })
  const references = input.kind === 'picture-edit' ? input.pictures : []
  const { data, response } = await client
    .post<ImagesAnswer>('/images', {
      body: {
        model: request.model,
        prompt: input.prompt,
        n: 1,
        resolution: resolutionOf(input.width, input.height),
        aspect_ratio: aspectOf(input.width, input.height),
        response_format: 'b64_json',
        ...(references.length > 0
          ? {
              input_references: await Promise.all(
                references.map(async (key) => ({ type: 'image_url', image_url: { url: await dataUrl(request, key) } })),
              ),
            }
          : {}),
      },
      signal: request.signal,
    })
    .withResponse()
  // Seedream is billed per picture made and per reference picture.
  const usage: Usage = { picture: data.data?.length ?? 0, 'reference-picture': references.length }
  const answer = pictureAnswer({ data: data.data ?? [] }, data.id ?? response.headers.get('x-request-id'), usage)
  if (typeof data.usage?.cost === 'number') answer.reportedCost = data.usage.cost
  return answer
}

/**
 * OpenRouter's cost for a UTC day from its activity API (a management key), for one API key when `keyHash` is
 * given: the sum of the day's usage, in dollars. OpenRouter keeps the last 30 completed days; a day it doesn't
 * have yet is null.
 */
export function openrouterCostReport({
  managementKey,
  keyHash,
  fetch: fetchOf = globalThis.fetch,
}: {
  managementKey: string
  keyHash?: string | undefined
  fetch?: typeof fetch
}): CostReport {
  return async (day) => {
    const query = new URLSearchParams({ date: day, ...(keyHash ? { api_key_hash: keyHash } : {}) })
    const response = await fetchOf(`${BASE_URL}/activity?${query}`, {
      headers: { authorization: `Bearer ${managementKey}` },
    })
    if (response.status === 400) return null
    if (!response.ok) throw new Error(`OpenRouter's activity API answered ${response.status}`)
    const body = (await response.json()) as { data?: { usage?: number }[] }
    return { currency: 'USD', cost: (body.data ?? []).reduce((sum, row) => sum + (row.usage ?? 0), 0) }
  }
}
