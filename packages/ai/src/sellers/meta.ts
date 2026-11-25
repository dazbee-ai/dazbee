// Meta's adapter for Muse Image: pictures through Meta's OpenAI-compatible Images API (generate, and edit with
// reference pictures and no mask), priced per picture. Written from Meta's Model API docs (dev.meta.ai) as read
// on 25 Nov 2026: a flat price per picture, 150 requests a minute, and a size that sets only the aspect ratio.
import type OpenAI from 'openai'

import {
  answerOrSellerError,
  makeOrEdit,
  pictureAnswer,
  pictureSize,
  sellerClient,
  type SellerClientOptions,
} from './openai.ts'
import { type SellerAdapter, type SellerAnswer, SellerError, type SellerRequest } from './seller.ts'

/** Meta's Model API. */
const BASE_URL = 'https://api.meta.ai/v1'

/** Meta's limit on Muse Image requests a minute. */
const REQUESTS_PER_MINUTE = 150

/** Meta's adapter on `apiKey`. */
export function metaSeller(apiKey: string, options: SellerClientOptions = {}): SellerAdapter {
  const client = sellerClient(apiKey, { baseURL: BASE_URL, ...options })
  return {
    seller: 'meta',
    perMinute: { picture: REQUESTS_PER_MINUTE },
    call: (request) => answerOrSellerError(() => callMeta(client, request)),
  }
}

async function callMeta(client: OpenAI, request: SellerRequest): Promise<SellerAnswer> {
  const { input } = request
  if (input.kind !== 'picture') throw new SellerError(`Meta makes no ${input.kind} call`, { status: 400 })
  const common = {
    model: request.model,
    prompt: input.prompt,
    size: pictureSize(input),
    response_format: 'b64_json' as const,
    output_format: 'png' as const,
    n: 1,
  }
  const { data, response } = await makeOrEdit(client, request, common)
  // Meta bills each picture made; the tokens it reports are not priced.
  return pictureAnswer(data, response.headers.get('x-request-id'), { picture: data.data?.length ?? 0 })
}
