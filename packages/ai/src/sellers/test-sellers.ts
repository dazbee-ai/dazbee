// Test sellers: adapters scripted, try by try, to answer (at once or after a wait), fail with a status, time
// out or report a given usage. Imported by tests only.
import { setTimeout as sleep } from 'node:timers/promises'

import { CALL_KINDS, type Usage } from '@dazbee/schema'

import { type SellerAdapter, type SellerAnswer, SellerError, type SellerOutput, type SellerRequest } from './seller.ts'

/** What a test seller does on one try. */
export type TestTry =
  | { answer?: SellerOutput; usage?: Usage; requestId?: string; reportedCost?: number; afterMs?: number }
  | { fail: number; code?: string }
  | { timeOut: true; requestId?: string }

/** A test seller and what it was asked. */
export interface TestSeller extends SellerAdapter {
  /** Every request it was sent, in order. */
  requests: SellerRequest[]
}

/** How long a test seller's call may take before it times out. */
export const TEST_TIMEOUT_MS = 200

/** The usage a test seller reports when its try names none. */
const USAGE: Usage = { 'input-token': 1000, 'output-token': 500 }

/**
 * A seller named `seller` that plays `tries` in order, then answers every try after them, each after `afterMs`
 * when given. An answer with no output gives text, or one 8 × 8 picture for a picture call. A call times
 * out after `timeoutMs`. A `resumable` seller says it answers later by request id.
 */
export function testSeller(
  seller: string,
  tries: TestTry[] = [],
  {
    afterMs = 0,
    timeoutMs = TEST_TIMEOUT_MS,
    resumable = false,
  }: { afterMs?: number; timeoutMs?: number; resumable?: boolean } = {},
): TestSeller {
  const requests: SellerRequest[] = []
  return {
    seller,
    requests,
    timeouts: Object.fromEntries(CALL_KINDS.map((kind) => [kind, timeoutMs])),
    resumable,
    async call(request) {
      const script = tries[requests.length] ?? {}
      requests.push(request)
      if ('fail' in script)
        throw new SellerError(`test failure ${script.fail}`, { status: script.fail, code: script.code })
      if ('timeOut' in script) {
        if (script.requestId) await request.keepRequestId(script.requestId)
        return new Promise<never>(() => undefined)
      }
      const wait = script.afterMs ?? afterMs
      if (wait > 0) await sleep(wait, undefined, { signal: request.signal })
      const answer: SellerAnswer = {
        output: script.answer ?? defaultOutput(request),
        usage: script.usage ?? USAGE,
        requestId: script.requestId ?? `${seller}-${requests.length}`,
      }
      if (script.reportedCost !== undefined) answer.reportedCost = script.reportedCost
      return answer
    },
  }
}

function defaultOutput(request: SellerRequest): SellerOutput {
  const picture = { bytes: new Uint8Array(8), type: 'image/png', width: 8, height: 8 }
  if (request.input.kind === 'text') return { kind: 'text', text: 'test answer' }
  if (request.input.kind === 'layer-split') return { kind: 'layers', layers: [picture], gpuSeconds: 17.5 }
  return { kind: 'pictures', pictures: [picture] }
}
