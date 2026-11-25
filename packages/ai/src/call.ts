// The one function every AI call goes through: it picks the AI step's model and that model's sellers,
// tries each under its pacing and the retry rules, writes a call-log row per try, prices what a call
// delivered and charges it to its AI job's hold, once.
import { and, desc, eq, sql } from 'drizzle-orm'

import { aiCalls, aiJobs, aiSettings, type Db, newId, type Tx } from '@dazbee/db'
import type { CallInput, CallKind, CallOutput, MadePicture } from '@dazbee/schema'

import { charge } from './ledger.ts'
import { pace } from './pacing.ts'
import { priceUsage } from './price-list.ts'
import { type SellerAnswer, sellerFailure, type SellerOutput } from './sellers/seller.ts'
import { routeStep, stepDef, type StepSeller } from './steps.ts'

/** Where the pictures a call reads and makes are kept: the workspace's originals. */
export interface PictureFiles {
  read(key: string): Promise<Uint8Array>
  /** Stores a picture a call made; its key. */
  save(bytes: Uint8Array, type: string): Promise<string>
}

/** One AI call of a job's run. */
export interface AiCall {
  job: { id: string; workspaceId: string }
  /** The run of the job making the call. */
  attempt: number
  /** The call's place in its job, the same on every run. */
  callIndex: number
  step: string
  input: CallInput
  /** Aborted when the job is cancelled or its worker stops. */
  signal: AbortSignal
  /** The sellers to try, in order, in place of the model's own; only the bill-check script passes it. */
  sellers?: string[]
  files?: PictureFiles
}

/** Why a call failed for good: a seller refused it, or no seller was left to try. */
export class CallFailed extends Error {
  readonly reason: 'refused' | 'no-seller'

  constructor(reason: 'refused' | 'no-seller', message: string) {
    super(message)
    this.name = 'CallFailed'
    this.reason = reason
  }
}

/** How long a call of each kind may take before it counts as failed (and as an unknown call). */
export const TIMEOUTS: Record<CallKind, number> = {
  text: 60_000,
  picture: 150_000,
  'picture-edit': 150_000,
  'layer-split': 600_000,
}

/** How many times a call is tried on one seller before the next. */
const TRIES_PER_SELLER = 2

/**
 * Makes `call` and gives its output. A call already done for the same job and call index gives its output
 * again without calling the seller. Throws `CallFailed` when it fails for good, and the signal's reason
 * when it is aborted; an aborted call is logged as unknown and charged to no workspace.
 */
export async function callAi(db: Db, call: AiCall): Promise<CallOutput> {
  const def = stepDef(call.step)
  if (def.kind !== call.input.kind) throw new Error(`the AI step ${call.step} makes ${def.kind} calls`)
  const done = await doneOutput(db, call)
  if (done) return done
  const route = await routeStep(db, call.step, call.sellers)
  let lastError = 'no seller can take it'
  for (const seller of route.sellers) {
    for (let tried = 0; tried < TRIES_PER_SELLER; tried++) {
      const row = await startTry(db, call, route.model, seller.seller)
      const result = await tryOnce(db, call, route.options, seller, row)
      if (result.ok) return finish(db, call, route.model, seller.seller, row, result.answer)
      lastError = result.error
      if (result.next === 'fail')
        throw new CallFailed('refused', `${seller.seller} refused ${call.step}: ${result.error}`)
      if (result.next === 'next-seller') break
    }
  }
  throw new CallFailed('no-seller', `no seller made ${call.step}: ${lastError}`)
}

/** What one try came to: an answer, or the error and what follows it. */
type TryResult =
  { ok: true; answer: SellerAnswer } | { ok: false; error: string; next: 'retry' | 'next-seller' | 'fail' }

/**
 * The output of the call when an earlier try of it is done; the call is charged now if the run that made
 * it couldn't charge it and this run can.
 */
async function doneOutput(db: Db, call: AiCall): Promise<CallOutput | null> {
  const [row] = await db
    .select({ id: aiCalls.id, chargeCost: aiCalls.chargeCost })
    .from(aiCalls)
    .where(and(eq(aiCalls.jobId, call.job.id), eq(aiCalls.callIndex, call.callIndex), eq(aiCalls.state, 'done')))
    .orderBy(desc(aiCalls.try))
    .limit(1)
  if (!row) return null
  const [job] = await db.select({ outputs: aiJobs.callOutputs }).from(aiJobs).where(eq(aiJobs.id, call.job.id))
  const output = job?.outputs[String(call.callIndex)]
  if (!output) return null
  await db.transaction((tx) => chargeIfRunning(tx, call, row.id, row.chargeCost ?? 0n))
  return output
}

/** Writes the call-log row of a new try, as running; its id. */
async function startTry(db: Db, call: AiCall, model: string, seller: string): Promise<string> {
  const id = newId()
  for (let attempt = 0; ; attempt++) {
    try {
      await db.insert(aiCalls).values({
        id,
        jobId: call.job.id,
        workspaceId: call.job.workspaceId,
        callIndex: call.callIndex,
        try: sql`(select coalesce(max(${aiCalls.try}), 0) + 1 from ${aiCalls} where ${aiCalls.jobId} = ${call.job.id} and ${aiCalls.callIndex} = ${call.callIndex})`,
        attempt: call.attempt,
        step: call.step,
        model,
        seller,
      })
      return id
    } catch (error) {
      // Another run of the job took the same try number at the same moment.
      if (attempt >= 2 || !isUniqueViolation(error)) throw error
    }
  }
}

/** Makes one try at `seller` under its pacing and timeout, and logs one that failed. */
async function tryOnce(
  db: Db,
  call: AiCall,
  options: Record<string, unknown>,
  seller: StepSeller,
  row: string,
): Promise<TryResult> {
  const kind = call.input.kind
  // The time a call may take starts once its turn under the seller's pacing comes.
  let timeout: AbortSignal | undefined
  try {
    await pace(`${seller.seller}:${kind}`, seller.adapter.perMinute?.[kind], call.signal)
    timeout = AbortSignal.timeout(seller.adapter.timeouts?.[kind] ?? TIMEOUTS[kind])
    const signal = AbortSignal.any([call.signal, timeout])
    const answer = await untilAborted(
      seller.adapter.call({
        model: seller.sellerModel,
        input: call.input,
        options,
        signal,
        readPicture: (key) => files(call).read(key),
        keepRequestId: (id) => keepRequestId(db, row, id),
      }),
      signal,
    )
    return { ok: true, answer }
  } catch (error) {
    if (call.signal.aborted) {
      await endTry(db, row, 'unknown', 'aborted')
      throw call.signal.reason
    }
    if (timeout?.aborted) {
      await endTry(db, row, 'unknown', 'timed out')
      return { ok: false, error: 'timed out', next: 'retry' }
    }
    const message = error instanceof Error ? error.message : String(error)
    const failure = sellerFailure(error)
    await endTry(db, row, 'failed', failure === 'out-of-money' ? `out of money: ${message}` : message)
    return {
      ok: false,
      error: message,
      next: failure === 'retry' ? 'retry' : failure === 'out-of-money' ? 'next-seller' : 'fail',
    }
  }
}

/**
 * Stores what the call made, prices it, and in one transaction marks its row done, keeps its output on the
 * job and charges it; its output.
 */
async function finish(
  db: Db,
  call: AiCall,
  model: string,
  seller: string,
  row: string,
  answer: SellerAnswer,
): Promise<CallOutput> {
  let output: CallOutput
  try {
    output = await storeOutput(call, answer.output)
  } catch (error) {
    // The seller made and billed it, but we lost what it made.
    await endTry(db, row, 'unknown', `not stored: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
  const priced = await priceUsage(db, seller, model, answer.usage)
  const def = stepDef(call.step)
  const [settings] = await db.select().from(aiSettings)
  if (!settings) throw new Error('the AI settings row is missing')
  const chargeCost = def.fixedCost ? def.fixedCost(settings, call.input) : priced.realCost
  await db.transaction(async (tx) => {
    await tx
      .update(aiCalls)
      .set({
        state: 'done',
        sellerRequestId: answer.requestId ?? sql`${aiCalls.sellerRequestId}`,
        usage: answer.usage,
        currency: priced.currency,
        sellerCost: priced.sellerCost,
        reportedCost: answer.reportedCost === undefined ? null : BigInt(Math.round(answer.reportedCost * 1e6)),
        realCost: priced.realCost,
        chargeCost,
        endedAt: new Date(),
      })
      .where(eq(aiCalls.id, row))
    await tx
      .update(aiJobs)
      .set({ callOutputs: sql`${aiJobs.callOutputs} || ${JSON.stringify({ [call.callIndex]: output })}::jsonb` })
      .where(eq(aiJobs.id, call.job.id))
    await chargeIfRunning(tx, call, row, chargeCost)
  })
  return output
}

/**
 * Charges call-log row `row` `cost` when its job is still running on this run; otherwise the call stays our
 * cost. Locks the job row first, so two runs of the job never charge at once.
 */
async function chargeIfRunning(tx: Tx, call: AiCall, row: string, cost: bigint): Promise<void> {
  const [job] = await tx
    .select({ state: aiJobs.state, attempt: aiJobs.attempt, workspaceId: aiJobs.workspaceId })
    .from(aiJobs)
    .where(eq(aiJobs.id, call.job.id))
    .for('update')
  if (!job || job.state !== 'running' || job.attempt !== call.attempt) return
  await charge(tx, { workspace: job.workspaceId, job: call.job.id, call: row, cost })
}

/** Stores the pictures in `output` as the workspace's originals. */
async function storeOutput(call: AiCall, output: SellerOutput): Promise<CallOutput> {
  if (output.kind === 'text') return output
  const store = async (pictures: SellerOutput & { kind: 'pictures' }) =>
    Promise.all(
      pictures.pictures.map(async (p): Promise<MadePicture> => ({
        key: await files(call).save(p.bytes, p.type),
        width: p.width,
        height: p.height,
      })),
    )
  if (output.kind === 'pictures') return { kind: 'pictures', pictures: await store(output) }
  const layers = await store({ kind: 'pictures', pictures: output.layers })
  return { kind: 'layers', layers, gpuSeconds: output.gpuSeconds }
}

function files(call: AiCall): PictureFiles {
  if (!call.files) throw new Error(`the AI step ${call.step} needs its pictures' storage`)
  return call.files
}

async function keepRequestId(db: Db, row: string, id: string): Promise<void> {
  await db.update(aiCalls).set({ sellerRequestId: id }).where(eq(aiCalls.id, row))
}

/** Marks a try's row failed or unknown, with why. */
async function endTry(db: Db, row: string, state: 'failed' | 'unknown', error: string): Promise<void> {
  await db
    .update(aiCalls)
    .set({ state, error: error.slice(0, 1000), endedAt: new Date() })
    .where(eq(aiCalls.id, row))
}

/** `promise`, or a rejection once `signal` aborts, for an adapter that doesn't stop when asked. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason)
    if (signal.aborted) abort()
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

function isUniqueViolation(error: unknown): boolean {
  const cause = error instanceof Error && 'cause' in error ? error.cause : error
  return typeof cause === 'object' && cause !== null && 'code' in cause && cause.code === '23505'
}
