// The one function every AI call goes through: it takes the AI function's preset and its model's sellers,
// tries each under its pacing and the retry rules, writes a call-log row per try, prices what a call
// delivered and charges it to its AI job's hold, once.
import { and, desc, eq, inArray, isNotNull, lt, sql } from 'drizzle-orm'

import { aiCalls, aiJobs, type Db, type Tx } from '@dazbee/db'
import {
  AI_PART_TAG,
  AI_TAG,
  type AiAssetTag,
  type CallInput,
  type CallKind,
  type CallOutput,
  type MadePicture,
} from '@dazbee/schema'

import { endCutOff, endTry, keepRequestId, requestOf, resumeTry, startTry } from './call-log.ts'
import { aiFunctionDef, ceilingOf, presetOf } from './functions/ai-function.ts'
import type { AiFunctionDef, Preset } from './functions/types.ts'
import { charge } from './ledger.ts'
import { drawMarks } from './marks.ts'
import { pace } from './pacing.ts'
import { priceUsage } from './price-list.ts'
import { routeModel, type RouteSeller, type SellerRoute } from './seller-route.ts'
import {
  type PictureBytes,
  type SellerAnswer,
  SellerCutOff,
  sellerFailure,
  type SellerOutput,
  SellerTimedOut,
} from './sellers/seller.ts'
import { aiSettingsOf } from './settings.ts'

/** Where the pictures a call reads and makes are kept: the workspace's originals. */
export interface PictureFiles {
  read(key: string): Promise<Uint8Array>
  /** Stores a picture a call made; its key. */
  save(bytes: Uint8Array, type: string): Promise<string>
}

/** Records the pictures a call made as assets of the brand its job is for. */
export interface PictureAssets {
  /** Records, in `tx`, the picture stored under `key` as an asset tagged `tag`; its id. */
  record(tx: Tx, picture: { key: string; bytes: Uint8Array }, tag: AiAssetTag): Promise<string>
}

/** One AI call of a job's run. */
export interface AiCall {
  job: { id: string; workspaceId: string }
  /** The run of the job making the call. */
  attempt: number
  /** The call's place in its job, the same on every run. */
  callIndex: number
  /** The AI feature of the call's job, as the call log keeps it. */
  feature: string
  /** The AI function the call is of, and the name of the preset it runs with. */
  function: string
  preset: string
  input: CallInput
  /** Aborted when the job is cancelled or its worker stops. */
  signal: AbortSignal
  /** The sellers to try, in order, in place of the model's own; only the bill-check script passes it. */
  sellers?: string[]
  files?: PictureFiles
  /** Records each picture the call makes as an asset once the call is kept: a picture tagged `ai`, a layer `ai-part`. */
  assets?: PictureAssets
}

/**
 * Why a call failed for good: a seller refused it, no seller was left to try, a seller made it but we
 * couldn't store or price what it made, or its answer was cut off at its ceiling.
 */
export type CallFailure = 'refused' | 'no-seller' | 'lost' | 'cut-off'

/** A call that failed for good: its job fails, with no try left. */
export class CallFailed extends Error {
  readonly reason: CallFailure

  constructor(reason: CallFailure, message: string) {
    super(message)
    this.name = 'CallFailed'
    this.reason = reason
  }
}

/** What a call runs with: its AI function's declaration and its preset. */
export interface Run {
  def: AiFunctionDef
  preset: Preset
}

/** What one try came to: an answer, or the error and what follows it. */
type TryResult =
  { ok: true; answer: SellerAnswer } | { ok: false; error: string; next: 'retry' | 'next-seller' | 'fail' | 'cut-off' }

/** How long a call of each kind may take before it counts as failed (and as an unknown call). */
export const TIMEOUTS: Record<CallKind, number> = {
  text: 60_000,
  picture: 150_000,
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
  const def = aiFunctionDef(call.function)
  if (def.kind !== call.input.kind) throw new Error(`the AI function ${call.function} makes ${def.kind} calls`)
  const preset = presetOf(call.function, call.preset)
  if (!preset) throw new CallFailed('refused', `the AI function ${call.function} has no preset ${call.preset}`)
  const run: Run = { def, preset }
  const done = await doneOutput(db, call)
  if (done) return done
  // Read, and marked, once before any seller is asked, so a storage failure is no seller's and spends no try.
  const references = await referencePictures(call)
  const referencesOf = () => Promise.resolve(references)
  const route = await routeModel(db, { model: preset.model, kind: def.kind, settings: preset.settings }, call.sellers)
  const resume = await resumable(db, call, route.sellers)
  // A seller still making an earlier attempt's request is asked about it first, then the sellers in their order.
  const order = [
    ...(resume ? [{ seller: resume.seller, askOnly: true }] : []),
    ...route.sellers.map((seller) => ({ seller, askOnly: false })),
  ]
  let lastError = 'no seller can take it'
  for (const { seller, askOnly } of order) {
    // A request the seller may still be making, which the next try at it asks about instead of sending again.
    let pending: { row: string; requestId: string } | null = askOnly ? resume : null
    for (let tried = 0; tried < TRIES_PER_SELLER; tried++) {
      if (askOnly && !pending) break
      const row = await startTry(db, call, run, seller.seller)
      const resumeId = pending ? await resumeTry(db, pending, row) : undefined
      const result = await tryOnce(db, call, run, route, seller, row, referencesOf, resumeId)
      if (result.ok) {
        return finish(db, call, def, { model: route.model, seller: seller.seller, row }, result.answer)
      }
      lastError = result.error
      // A request the seller refuses to answer about is sent again as a new one, not failed for good.
      const next = resumeId && result.next === 'fail' ? 'retry' : result.next
      pending = seller.adapter.resumable && result.next === 'retry' ? await requestOf(db, row) : null
      if (next === 'cut-off')
        throw new CallFailed('cut-off', `${seller.seller} cut ${call.function} off at its ceiling`)
      if (next === 'fail') throw new CallFailed('refused', `${seller.seller} refused ${call.function}: ${result.error}`)
      if (next === 'next-seller') break
    }
  }
  throw new CallFailed('no-seller', `no seller made ${call.function}: ${lastError}`)
}

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

/**
 * Charges try `row` `cost` when its job is still running on this run and no try of the same AI call was
 * charged before; otherwise the call stays our cost. Locks the job row first, so two runs of the job never
 * charge at once, and the one-charge index on the call log refuses a second charged try whatever happens.
 */
async function chargeIfRunning(tx: Tx, call: AiCall, row: string, cost: bigint): Promise<void> {
  const [job] = await tx
    .select({ state: aiJobs.state, attempt: aiJobs.attempt, workspaceId: aiJobs.workspaceId })
    .from(aiJobs)
    .where(eq(aiJobs.id, call.job.id))
    .for('update')
  if (!job || job.state !== 'running' || job.attempt !== call.attempt) return
  const [charged] = await tx
    .select({ id: aiCalls.id })
    .from(aiCalls)
    .where(and(eq(aiCalls.jobId, call.job.id), eq(aiCalls.callIndex, call.callIndex), isNotNull(aiCalls.chargedAt)))
    .limit(1)
  if (charged) return
  await tx.update(aiCalls).set({ chargedAt: new Date() }).where(eq(aiCalls.id, row))
  await charge(tx, { workspace: job.workspaceId, job: call.job.id, call: row, cost })
}

/**
 * An earlier attempt's try of the call that a seller may still be making, for a seller that answers later
 * by its request id: its row, its request id and the seller to ask again.
 */
async function resumable(db: Db, call: AiCall, sellers: RouteSeller[]) {
  const [earlier] = await db
    .select({ id: aiCalls.id, seller: aiCalls.seller, requestId: aiCalls.sellerRequestId })
    .from(aiCalls)
    .where(
      and(
        eq(aiCalls.jobId, call.job.id),
        eq(aiCalls.callIndex, call.callIndex),
        inArray(aiCalls.state, ['running', 'unknown']),
        isNotNull(aiCalls.sellerRequestId),
        lt(aiCalls.attempt, call.attempt),
      ),
    )
    .orderBy(desc(aiCalls.try))
    .limit(1)
  const seller = sellers.find((s) => s.seller === earlier?.seller && s.adapter.resumable)
  return earlier?.requestId && seller ? { row: earlier.id, requestId: earlier.requestId, seller } : null
}

/** Makes one try at `seller` under its pacing and timeout, and logs one that failed. */
async function tryOnce(
  db: Db,
  call: AiCall,
  run: Run,
  route: SellerRoute,
  seller: RouteSeller,
  row: string,
  references: () => Promise<Uint8Array[]>,
  resumeId?: string,
): Promise<TryResult> {
  const kind = call.input.kind
  // The time a call may take starts once its turn under the seller's pacing comes.
  let timeout: AbortSignal | undefined
  try {
    // A seller's limit covers a model as a whole, whatever the AI function or kind of call.
    await pace(`${seller.seller}:${seller.sellerModel}`, seller.adapter.perMinute?.[kind], call.signal)
    timeout = AbortSignal.timeout(run.def.timeoutMs ?? seller.adapter.timeouts?.[kind] ?? TIMEOUTS[kind])
    const signal = AbortSignal.any([call.signal, timeout])
    const answer = await untilAborted(
      seller.adapter.call({
        call: { job: call.job.id, function: call.function, preset: call.preset, index: call.callIndex },
        model: seller.sellerModel,
        input: withCeiling(call, run.preset),
        options: route.settings,
        signal,
        readPicture: (key) => files(call).read(key),
        references,
        keepRequestId: (id) => keepRequestId(db, row, id),
        ...(resumeId ? { resumeId } : {}),
      }),
      signal,
    )
    return { ok: true, answer }
  } catch (error) {
    if (call.signal.aborted) {
      // A call aborted while it waited its turn never reached the seller.
      await endTry(db, row, timeout ? 'unknown' : 'failed', timeout ? 'aborted' : 'aborted before it was sent')
      throw call.signal.reason
    }
    if (timeout?.aborted) {
      await endTry(db, row, 'unknown', 'timed out')
      return { ok: false, error: 'timed out', next: 'retry' }
    }
    if (error instanceof SellerCutOff) {
      await endCutOff(db, row, seller.seller, route.model, error)
      return { ok: false, error: error.message, next: 'cut-off' }
    }
    const message = messageOf(error)
    const next = sellerFailure(error)
    const state = error instanceof SellerTimedOut ? 'unknown' : 'failed'
    await endTry(db, row, state, next === 'next-seller' ? `out of money: ${message}` : message)
    return { ok: false, error: message, next }
  }
}

/** A picture call's reference pictures, with the first one's marked copy last when it has marks. */
async function referencePictures(call: AiCall): Promise<Uint8Array[]> {
  const { input } = call
  if (input.kind !== 'picture') return []
  const pictures = await Promise.all(input.pictures.map((key) => files(call).read(key)))
  const [first] = pictures
  if (!input.marks || !first) return pictures
  return [...pictures, await drawMarks(first, await files(call).read(input.marks))]
}

/** The call's input, a text call's output limit held to its preset's ceiling. */
function withCeiling(call: AiCall, preset: Preset): CallInput {
  const ceiling = ceilingOf(call.function, preset)
  if (call.input.kind !== 'text' || ceiling === undefined) return call.input
  return { ...call.input, maxOutputTokens: Math.min(call.input.maxOutputTokens ?? ceiling, ceiling) }
}

function files(call: AiCall): PictureFiles {
  if (!call.files) throw new Error(`the AI function ${call.function} needs its pictures' storage`)
  return call.files
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

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Stores what the call made, prices it, and in one transaction marks its row done, keeps its output on the
 * job and charges it; its output. A seller made and billed a call whose output can't be stored or priced,
 * so its row becomes unknown, keeping the usage, and the call fails for good.
 */
async function finish(
  db: Db,
  call: AiCall,
  def: AiFunctionDef,
  made: { model: string; seller: string; row: string },
  answer: SellerAnswer,
): Promise<CallOutput> {
  try {
    const stored = await storeOutput(call, answer.output)
    let output = stored.output
    // A replayed answer was made by no seller, so it costs nothing and charges nothing.
    const priced = answer.replayed ? null : await priceUsage(db, made.seller, made.model, answer.usage)
    const chargeCost = !priced
      ? 0n
      : def.fixedCharge
        ? def.fixedCharge(await aiSettingsOf(db), call.input)
        : priced.realCost
    await db.transaction(async (tx) => {
      // The job row first, as every transaction that locks both takes them, so two never wait on each other.
      await tx.select({ id: aiJobs.id }).from(aiJobs).where(eq(aiJobs.id, call.job.id)).for('update')
      const [mine] = await tx
        .update(aiCalls)
        .set({
          state: 'done',
          sellerRequestId: answer.requestId ?? sql`${aiCalls.sellerRequestId}`,
          usage: answer.usage,
          currency: priced?.currency ?? null,
          sellerCost: priced?.sellerCost ?? 0n,
          reportedCost: answer.reportedCost === undefined ? null : BigInt(Math.round(answer.reportedCost * 1e6)),
          realCost: priced?.realCost ?? 0n,
          chargeCost,
          endedAt: new Date(),
        })
        // A row a later try took the request over from is left as it is: that try logs the request.
        .where(and(eq(aiCalls.id, made.row), inArray(aiCalls.state, ['running', 'unknown'])))
        .returning({ id: aiCalls.id })
      if (!mine) return
      output = await withAssets(tx, call, stored)
      await tx
        .update(aiJobs)
        .set({ callOutputs: sql`${aiJobs.callOutputs} || ${JSON.stringify({ [call.callIndex]: output })}::jsonb` })
        .where(eq(aiJobs.id, call.job.id))
      await chargeIfRunning(tx, call, made.row, chargeCost)
    })
    return output
  } catch (error) {
    await endTry(db, made.row, 'unknown', `not kept: ${messageOf(error)}`, answer.usage)
    throw new CallFailed('lost', `${made.seller} made ${call.function}, but it was not kept: ${messageOf(error)}`)
  }
}

/**
 * What a call made, its pictures stored: its output, and each picture's bytes, in order: a split's layers, then its
 * split pieces.
 */
interface Stored {
  output: CallOutput
  bytes: Uint8Array[]
}

/** Stores the pictures in `output` as the workspace's originals: a split's layers, and its split pieces when it cut any. */
async function storeOutput(call: AiCall, output: SellerOutput): Promise<Stored> {
  if (output.kind === 'text') return { output, bytes: [] }
  const save = (pictures: readonly PictureBytes[]) =>
    Promise.all(
      pictures.map(async (p): Promise<MadePicture> => {
        const key = await files(call).save(p.bytes, p.type)
        return { key, width: p.width, height: p.height }
      }),
    )
  if (output.kind === 'pictures') {
    const pictures = await save(output.pictures)
    return { output: { kind: 'pictures', pictures }, bytes: output.pictures.map((p) => p.bytes) }
  }
  const layers = await save(output.layers)
  const cut = output.pieces
  const pictures = cut ? await save(cut.items) : []
  const pieces = cut && {
    width: cut.width,
    height: cut.height,
    items: cut.items.flatMap(({ x, y, part, kind, layer, turned }, i) => {
      const picture = pictures[i]
      return picture ? [{ picture, x, y, part, kind, layer, turned }] : []
    }),
    stuck: cut.stuck,
    closeness: cut.closeness,
    seconds: cut.seconds,
  }
  return {
    output: { kind: 'layers', layers, ...(pieces ? { pieces } : {}), gpuSeconds: output.gpuSeconds },
    bytes: [...output.layers, ...(cut?.items ?? [])].map((p) => p.bytes),
  }
}

/**
 * The stored output with each picture recorded in `tx` as an asset, when the call records them: a picture tagged
 * `ai`, a layer and a split piece `ai-part`.
 */
async function withAssets(tx: Tx, call: AiCall, { output, bytes }: Stored): Promise<CallOutput> {
  const { assets } = call
  if (!assets || output.kind === 'text') return output
  // One at a time, as a transaction's queries run one after another.
  const record = async (pictures: MadePicture[], tag: AiAssetTag, first = 0) => {
    const recorded: MadePicture[] = []
    for (const [i, p] of pictures.entries()) {
      const assetId = await assets.record(tx, { key: p.key, bytes: bytes[first + i] ?? new Uint8Array() }, tag)
      recorded.push({ ...p, assetId })
    }
    return recorded
  }
  if (output.kind === 'pictures') return { ...output, pictures: await record(output.pictures, AI_TAG) }
  const layers = await record(output.layers, AI_PART_TAG)
  const { pieces } = output
  if (!pieces) return { ...output, layers }
  // The pieces' bytes follow the layers'.
  const pictures = await record(
    pieces.items.map((item) => item.picture),
    AI_PART_TAG,
    layers.length,
  )
  const items = pieces.items.map((item, i) => ({ ...item, picture: pictures[i] ?? item.picture }))
  return { ...output, layers, pieces: { ...pieces, items } }
}
