// What a seller's adapter does: make one AI call to the seller and report what it gave back, the usage it
// reported and its request id. Also the error an adapter throws, how the call function reads it, and the
// registry of the adapters in use.
import type { CallInput, CallKind, Usage } from '@dazbee/schema'

/** A picture a seller made, as bytes, before it is stored. */
export interface PictureBytes {
  bytes: Uint8Array
  type: string
  width: number
  height: number
}

/** What a seller gave back, before its pictures are stored. */
export type SellerOutput =
  | { kind: 'text'; text: string; json?: unknown }
  | { kind: 'pictures'; pictures: PictureBytes[] }
  | { kind: 'layers'; layers: PictureBytes[]; gpuSeconds: number }

/** One call as an adapter is asked to make it. */
export interface SellerRequest {
  /** The seller's own name for the model. */
  model: string
  input: CallInput
  /** The options the AI step's model passes, such as a picture's quality. */
  options: Record<string, unknown>
  /** Aborted when the call times out or its job is cancelled. */
  signal: AbortSignal
  /** Reads a stored picture the input names. */
  readPicture(key: string): Promise<Uint8Array>
  /** Keeps the seller's request id on the call-log row, for a seller that answers later. */
  keepRequestId(id: string): Promise<void>
  /** The request id of a call an earlier attempt started, to ask the seller about instead of calling again. */
  resumeId?: string
}

/** What a call gave back: its output, the usage the seller reported, its request id and its own cost, if it gives one. */
export interface SellerAnswer {
  output: SellerOutput
  usage: Usage
  requestId?: string
  /** The seller's own cost for the call, in its currency, where it gives one. */
  reportedCost?: number
}

/**
 * What a seller says of a request asked about later: made (and charged), with the usage it was charged for,
 * ended without a result, or still going.
 */
export type RequestStatus = { state: 'done'; usage: Usage } | { state: 'failed' } | { state: 'pending' }

/** One seller's adapter. */
export interface SellerAdapter {
  seller: string
  call(request: SellerRequest): Promise<SellerAnswer>
  /** The most calls a minute we may make of each kind, from the seller's docs at our tier. */
  perMinute?: Partial<Record<CallKind, number>>
  /** Whether the seller answers a call later by its request id, so an attempt can pick up an earlier one's call. */
  resumable?: boolean
  /** Asks the seller about a request for `input` by its id, for a seller that answers that. */
  status?(requestId: string, input: CallInput): Promise<RequestStatus>
  /** How long a call of each kind may take here, when not the call function's usual time. */
  timeouts?: Partial<Record<CallKind, number>>
}

/** What a seller's error means for the call: try again, go to the next seller, or fail the call. */
export type SellerFailure = 'retry' | 'next-seller' | 'fail'

/** An error answer from a seller: its HTTP status and its error code, where it gives them. */
export class SellerError extends Error {
  readonly status: number | undefined
  readonly code: string | undefined

  constructor(message: string, { status, code }: { status?: number | undefined; code?: string | undefined } = {}) {
    super(message)
    this.name = 'SellerError'
    this.status = status
    this.code = code
  }
}

/** The adapters in use, by seller. */
const adapters = new Map<string, SellerAdapter>()

/** Puts an adapter in use, in place of any before it for the same seller. */
export function useSeller(adapter: SellerAdapter): void {
  adapters.set(adapter.seller, adapter)
}

/** The adapter in use for `seller`, if there is one. */
export function sellerAdapter(seller: string): SellerAdapter | undefined {
  return adapters.get(seller)
}

/**
 * What `error` from an adapter means: a seller out of money goes to the next seller; a rate limit, a
 * server error or a lost connection is tried again; any other refusal fails the call.
 */
export function sellerFailure(error: unknown): SellerFailure {
  if (error instanceof SellerError) {
    if (error.status === 402 || error.code === 'insufficient_quota') return 'next-seller'
    if (error.status === undefined || error.status === 429 || error.status >= 500) return 'retry'
    return 'fail'
  }
  // fetch rejects with a TypeError when the connection fails.
  return error instanceof TypeError ? 'retry' : 'fail'
}
