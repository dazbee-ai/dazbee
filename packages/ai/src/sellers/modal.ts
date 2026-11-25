// Modal's adapter for the layer split: spawns the deployed layer split app's function (python/layering) through
// Modal's JavaScript SDK, keeps the call's id on the call-log row, and asks for its result 20 s at a time, so
// a worker that restarts picks the same call up again by its id. pg-boss's worker keeps the job's heartbeat
// while it waits. The usage is the seconds the function timed itself, as GPU seconds, with the CPU cores and
// memory it declares for the same seconds. Written from Modal's docs (deployed apps, GPU memory snapshots,
// autoscaling, the JavaScript SDK) and the `modal` package's types as read on 25 Nov 2026.
import { FunctionTimeoutError, InternalFailure, ModalClient, NotFoundError, RemoteError, TimeoutError } from 'modal'

import { type LayerSplitRequest, LayerSplitResult, type Usage } from '@dazbee/schema'

import type { CostReport } from '../daily-check.ts'
import {
  type PictureBytes,
  type SellerAdapter,
  type SellerAnswer,
  SellerError,
  type SellerRequest,
  SellerTimedOut,
} from './seller.ts'

/** A FunctionCall of Modal's SDK, as the adapter uses it. */
export interface ModalFunctionCall {
  readonly functionCallId: string
  get(params?: { timeoutMs?: number }): Promise<unknown>
  cancel(params?: { terminateContainers?: boolean }): Promise<void>
}

/** The part of Modal's SDK the adapter uses: a `ModalClient`, or a test's stand-in for one. */
export interface ModalSdk {
  cls: {
    fromName(
      app: string,
      name: string,
    ): Promise<{
      instance(): Promise<{ method(name: string): { spawn(args?: unknown[]): Promise<ModalFunctionCall> } }>
    }>
  }
  functionCalls: { fromId(id: string): Promise<ModalFunctionCall> }
}

/** The deployed layer split app, its class and the method that splits a picture (python/layering/app.py). */
export const LAYERING = { app: 'dazbee-layering', cls: 'Layering', method: 'split' } as const

/** How long one ask for a call's result waits before it asks again. */
const POLL_MS = 20_000

/** gRPC's status codes for a refused token, which no try again would get past. */
const AUTH_CODES = new Set([7, 16])

/** Modal's adapter, on the token Modal gave the worker. */
export function modalSeller(tokenId: string, tokenSecret: string): SellerAdapter {
  return modalSellerOn(new ModalClient({ tokenId, tokenSecret }))
}

/** Modal's adapter on `sdk`; tests give a stand-in, and a shorter `pollMs`. */
export function modalSellerOn(sdk: ModalSdk, { pollMs = POLL_MS }: { pollMs?: number } = {}): SellerAdapter {
  return {
    seller: 'modal',
    resumable: true,
    call: async (request) => {
      try {
        return await split(sdk, request, pollMs)
      } catch (error) {
        throw modalError(error, request)
      }
    },
  }
}

/** Spawns the split, or picks up the one `request.resumeId` names, and reads its result. */
async function split(sdk: ModalSdk, request: SellerRequest, pollMs: number): Promise<SellerAnswer> {
  const { input } = request
  if (input.kind !== 'layer-split') throw new SellerError(`Modal makes no ${input.kind} call`, { status: 400 })
  let call: ModalFunctionCall
  if (request.resumeId) {
    call = await sdk.functionCalls.fromId(request.resumeId)
  } else {
    const body: LayerSplitRequest = {
      picture: Buffer.from(await request.readPicture(input.picture)).toString('base64'),
      size: input.size,
      ...(input.guidance === undefined ? {} : { guidance: input.guidance }),
      ...(input.plan === undefined ? {} : { plan: input.plan }),
    }
    const layering = await (await sdk.cls.fromName(LAYERING.app, LAYERING.cls)).instance()
    call = await layering.method(LAYERING.method).spawn([body])
    await request.keepRequestId(call.functionCallId)
  }
  const result = LayerSplitResult.parse(await resultOf(call, request.signal, pollMs))
  const layers = result.layers.map((layer): PictureBytes => ({
    bytes: new Uint8Array(Buffer.from(layer.png, 'base64')),
    type: 'image/png',
    width: layer.width,
    height: layer.height,
  }))
  return {
    output: { kind: 'layers', layers, gpuSeconds: result.seconds },
    usage: usageOf(result),
    requestId: call.functionCallId,
  }
}

/**
 * The call's result, asked for `pollMs` at a time until it comes or `signal` aborts. A call the call function
 * timed out is cancelled, since its next try spawns another; a call aborted for any other reason runs on, so a
 * worker that stops can leave it to the next.
 */
async function resultOf(call: ModalFunctionCall, signal: AbortSignal, pollMs: number): Promise<unknown> {
  for (;;) {
    try {
      signal.throwIfAborted()
      return await untilAborted(call.get({ timeoutMs: pollMs }), signal)
    } catch (error) {
      // TimeoutError first: a wait that ran out also matches FunctionTimeoutError, which the SDK deprecates.
      if (error instanceof TimeoutError && !signal.aborted) continue
      if (signal.aborted && isTimeout(signal.reason)) await call.cancel().catch(() => undefined)
      throw error
    }
  }
}

/** `promise`, or a rejection with the signal's reason once `signal` aborts. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function isTimeout(reason: unknown): boolean {
  return reason instanceof DOMException && reason.name === 'TimeoutError'
}

/** The GPU seconds the function timed, and its declared CPU cores and memory for as long. */
function usageOf(result: LayerSplitResult): Usage {
  const exact = (value: number) => Math.round(value * 1e6) / 1e6
  return {
    'gpu-second': exact(result.seconds),
    'cpu-core-second': exact(result.seconds * result.cpuCores),
    'memory-gib-second': exact(result.seconds * result.memoryGib),
  }
}

/**
 * What an error from Modal means for the call: a split Modal timed out is a `SellerTimedOut`; an error the
 * function raised, Modal's own failure or a lost connection is tried again, as is a call to resume that Modal no
 * longer has; an app that isn't deployed or a refused token fails the call. Any other error, such as a result
 * that isn't the contract's, fails it as it is.
 */
function modalError(error: unknown, request: SellerRequest): unknown {
  if (request.signal.aborted || error instanceof SellerError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof FunctionTimeoutError) return new SellerTimedOut(`Modal timed the layer split out: ${message}`)
  if (error instanceof NotFoundError) return new SellerError(message, request.resumeId ? {} : { status: 404 })
  if (error instanceof RemoteError) return new SellerError(message, { status: 500 })
  if (error instanceof InternalFailure) return new SellerError(message, { status: 503 })
  if (isGrpcError(error)) return new SellerError(message, AUTH_CODES.has(error.code) ? { status: 401 } : {})
  return error
}

/** An error of Modal's gRPC client (nice-grpc's `ClientError`), with its status code. */
function isGrpcError(error: unknown): error is Error & { code: number } {
  return (
    error instanceof Error && error.name === 'ClientError' && typeof (error as { code?: unknown }).code === 'number'
  )
}

/** The part of Modal's SDK the cost report uses: its billing report, one item per object and interval. */
export interface ModalBilling {
  workspaceBillingReport(request: {
    startTimestamp: Date
    endTimestamp: Date
    resolution: string
    tagNames: string[]
    environmentIds: string[]
    appIds: string[]
  }): AsyncIterable<{ description: string; cost: string }>
}

/** Modal's cost for a UTC day from its billing report: what the layer split app cost that day, in dollars. */
export function modalCostReport(tokenId: string, tokenSecret: string): CostReport {
  return modalCostReportOn(new ModalClient({ tokenId, tokenSecret }).cpClient as unknown as ModalBilling)
}

/** Modal's cost report on `billing`; tests give a stand-in. */
export function modalCostReportOn(billing: ModalBilling): CostReport {
  return async (day) => {
    const start = new Date(`${day}T00:00:00Z`)
    let cost = 0
    const items = billing.workspaceBillingReport({
      startTimestamp: start,
      endTimestamp: new Date(start.getTime() + 86_400_000),
      resolution: 'd',
      tagNames: [],
      environmentIds: [],
      appIds: [],
    })
    for await (const item of items) if (item.description === LAYERING.app) cost += Number(item.cost)
    return { currency: 'USD', cost }
  }
}
