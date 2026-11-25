// Pixazo's adapter for Seedream 5.5: submit, keep the request id on the call-log row, then poll until the
// picture is made, and download it. A later attempt polls the same request instead of submitting again, and
// the daily settling of unknown calls asks about a request by its id. Written from Pixazo's Seedream page
// (pixazo.ai/models/seedream) as read on 25 Nov 2026: COMPLETED, FAILED and ERROR end a request; ERROR is
// never charged, and a FAILED request charged by mistake is refunded.
import { setTimeout as sleep } from 'node:timers/promises'

import { type CallInput, readImageHeader, referenceCount, type Usage } from '@dazbee/schema'

import { bytesUrl } from './openai.ts'
import { type RequestStatus, type SellerAdapter, type SellerAnswer, SellerError, type SellerRequest } from './seller.ts'

/** What Pixazo's status call answers. */
interface Status {
  request_id?: string
  status?: string
  error?: string | null
  output?: { media_url?: string[] | string; media_type?: string } | null
}

/** Pixazo's gateway. */
const GATEWAY = 'https://gateway.pixazo.ai'

/** How long a Pixazo picture call may take. */
const PIXAZO_TIMEOUT_MS = 300_000

/** How often a request's status is asked for. */
const POLL_MS = 3_000

/** The fewest pixels Seedream 5.5 makes at an exact size; smaller sizes ask for the 1K tier. */
const FEWEST_PIXELS = 921_600

/** Pixazo's adapter on `apiKey`; `fetchOf` and `pollMs` are for tests. */
export function pixazoSeller(
  apiKey: string,
  { fetch: fetchOf = globalThis.fetch, pollMs = POLL_MS }: { fetch?: typeof fetch; pollMs?: number } = {},
): SellerAdapter {
  const headers = {
    'Ocp-Apim-Subscription-Key': apiKey,
    'Cache-Control': 'no-cache',
    'content-type': 'application/json',
  }
  const ask = async (requestId: string, signal?: AbortSignal): Promise<Status> =>
    answerOf<Status>(
      await fetchOf(`${GATEWAY}/v2/requests/status/${requestId}`, { headers, ...(signal ? { signal } : {}) }),
    )
  return {
    seller: 'pixazo',
    resumable: true,
    // Seedream on Pixazo can take over two minutes for an edit, past the usual 150 s.
    timeouts: { picture: PIXAZO_TIMEOUT_MS },
    call: (request) => callPixazo(fetchOf, headers, ask, pollMs, request),
    status: async (requestId, input) => {
      const state = stateOf(await ask(requestId))
      return state === 'done' ? { state, usage: usageOf(input) } : { state }
    },
  }
}

async function callPixazo(
  fetchOf: typeof fetch,
  headers: Record<string, string>,
  ask: (requestId: string, signal?: AbortSignal) => Promise<Status>,
  pollMs: number,
  request: SellerRequest,
): Promise<SellerAnswer> {
  const { input } = request
  if (input.kind !== 'picture') throw new SellerError(`Pixazo makes no ${input.kind} call`, { status: 400 })
  let requestId = request.resumeId
  if (!requestId) {
    const references = await request.references()
    const pixels = input.width * input.height
    const submitted = answerOf<{ request_id?: string }>(
      await fetchOf(`${GATEWAY}/${request.model}/v1/${references.length > 0 ? 'edit-image' : 'text-to-image'}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          prompt: input.prompt,
          size: pixels >= FEWEST_PIXELS ? `${input.width}x${input.height}` : '1K',
          output_format: 'png',
          watermark: false,
          ...(references.length > 0 ? { image: references.map(bytesUrl) } : {}),
        }),
        signal: request.signal,
      }),
    )
    requestId = (await submitted).request_id
    if (!requestId) throw new SellerError('Pixazo gave no request id', { status: 502 })
    await request.keepRequestId(requestId)
  }
  for (;;) {
    const status = await ask(requestId, request.signal)
    const state = stateOf(status)
    if (state === 'done') {
      const url = [status.output?.media_url ?? []].flat()[0]
      if (!url) throw new SellerError('Pixazo gave no picture', { status: 502 })
      // Pixazo's picture links refuse a request with no User-Agent.
      const picture = await fetchOf(url, { headers: { 'User-Agent': 'dazbee' }, signal: request.signal })
      if (!picture.ok) throw new SellerError(`Pixazo's picture answered ${picture.status}`, { status: 502 })
      const bytes = new Uint8Array(await picture.arrayBuffer())
      const header = readImageHeader(bytes)
      if (!header) throw new SellerError('Pixazo’s picture is not a picture', { status: 502 })
      return {
        output: {
          kind: 'pictures',
          pictures: [{ bytes, type: header.contentType, width: header.width, height: header.height }],
        },
        usage: usageOf(input),
        requestId,
      }
    }
    if (state === 'failed') throw new SellerError(`Pixazo: ${status.error ?? status.status}`, { status: 502 })
    await sleep(pollMs, undefined, { signal: request.signal })
  }
}

/** What a request's status means: made (and charged), ended without a picture, or still going. */
function stateOf(status: Status): RequestStatus['state'] {
  const state = String(status.status ?? '').toUpperCase()
  if (state === 'COMPLETED') return 'done'
  if (state === 'FAILED' || state === 'ERROR' || state === 'CANCELLED') return 'failed'
  return 'pending'
}

/** What Seedream on Pixazo charges a call for: the picture made and each reference picture. */
function usageOf(input: CallInput): Usage {
  return { picture: 1, 'reference-picture': input.kind === 'picture' ? referenceCount(input) : 0 }
}

/** The JSON of an answer, or a `SellerError` with its status for an error answer. */
async function answerOf<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as T & { error?: unknown; message?: string }
  if (!response.ok) {
    throw new SellerError(body.message ?? String(body.error ?? `Pixazo answered ${response.status}`), {
      status: response.status,
    })
  }
  return body
}
