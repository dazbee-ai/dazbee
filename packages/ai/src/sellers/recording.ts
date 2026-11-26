// AI recordings, for development only: a recording seller writes each answer a real seller gives into a folder,
// and replay sellers answer calls from that folder in place of every seller, after about the time the recorded
// call took, at no cost. `useSellersOf` turns them on from AI_RECORD_DIR or AI_REPLAY_DIR, never in production.
//
// A recording holds a folder per AI function, in it a folder per preset, and in that a folder per call: `call.json`
// and the call's pictures.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import { CALL_KINDS, type CallInput, type Usage } from '@dazbee/schema'

import {
  type PictureBytes,
  type SellerAdapter,
  type SellerAnswer,
  SellerError,
  type SellerOutput,
  type SellerRequest,
} from './seller.ts'

/** A recorded picture: its file beside `call.json`, its type and its size. */
export interface RecordedPicture {
  file: string
  type: string
  width: number
  height: number
}

/** What a recorded call gave back, its pictures as files. */
export type RecordedOutput =
  | { kind: 'text'; text: string; json?: unknown }
  | { kind: 'pictures'; pictures: RecordedPicture[] }
  | { kind: 'layers'; layers: RecordedPicture[]; gpuSeconds: number }

/** One recorded call, as its `call.json` holds it. */
export interface RecordedCall {
  function: string
  preset: string
  /** The call's place in its job. */
  callIndex: number
  job: string
  seller: string
  /** The seller's own name for the model. */
  model: string
  /** What the call was asked: its input, a text call's instructions as their length, and the preset's settings. */
  request: { input: unknown; options: Record<string, unknown> }
  /** How long the seller took to answer, in milliseconds. */
  ms: number
  usage: Usage
  requestId?: string
  /** The seller's own cost for the call, in its currency, where it gave one. */
  reportedCost?: number
  output: RecordedOutput
  recordedAt: string
}

/** A recorded call, the name of the folder it sits in and that folder's path. */
interface Recorded {
  name: string
  path: string
  call: RecordedCall
}

/** The file each recorded call is kept in, inside its folder. */
const CALL_FILE = 'call.json'

/** How long a replayed call may take: longer than any seller's call may, so one replayed at speed 1 or more never times out. */
const REPLAY_TIMEOUT_MS = 600_000

/** The file extension of each picture type a seller gives back. */
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/**
 * `seller` with every answer it gives also written to the recording in `dir`. A call whose answer can't be written
 * still gives its answer, and the failure is logged.
 */
export function recordingSeller(seller: SellerAdapter, dir: string): SellerAdapter {
  return {
    ...seller,
    async call(request) {
      const started = performance.now()
      const answer = await seller.call(request)
      const ms = Math.round(performance.now() - started)
      try {
        await writeCall(dir, seller.seller, request, answer, ms)
      } catch (error) {
        const { function: fn, preset } = request.call
        console.error(JSON.stringify({ msg: 'AI call not recorded', function: fn, preset, error: String(error) }))
      }
      return answer
    },
  }
}

/**
 * A replay seller for each of `sellers`, answering every call from the recording in `dir` and calling no seller.
 * Each replayed job takes its answers from one recorded job, picked at its first call from the jobs that recorded
 * that call's AI function with its preset, each in turn, so a plan and the calls made from it stay together. A call
 * is answered by that job's recording at its place in the job, else that job's recordings of its function and preset,
 * else any job's recording of them at its place, else any recording of them, each list taken in turn; after the time
 * the recorded call took, divided by `speed`. Its answer is marked replayed, so it costs nothing, and its request id
 * names the recording. A function and preset with no recording fail the call, so a call never takes another
 * preset's answer.
 */
export function replaySellers(sellers: string[], dir: string, speed: number): SellerAdapter[] {
  // The recorded job each replayed job takes its answers from.
  const pins = new Map<string, string>()
  // How many times each list of recordings has been taken from, by the list's key.
  const turns = new Map<string, number>()
  const take = <T>(list: T[], key: string): T | undefined => {
    const turn = turns.get(key) ?? 0
    const item = list[turn % list.length]
    if (item !== undefined) turns.set(key, turn + 1)
    return item
  }
  const call = async (request: SellerRequest): Promise<SellerAnswer> => {
    const { job, index } = request.call
    const under = recordedUnder(request)
    const recorded = await recordingsOf(dir, under)
    if (!pins.has(job)) {
      const pin = take([...new Set(recorded.map((r) => r.call.job))], `jobs of ${under}`)
      if (pin !== undefined) pins.set(job, pin)
    }
    const pin = pins.get(job)
    const ofJob = recorded.filter((r) => r.call.job === pin)
    const atIndex = (list: Recorded[]) => list.filter((r) => r.call.callIndex === index)
    const picked =
      atIndex(ofJob)[0] ??
      take(ofJob, `${pin} ${under}`) ??
      take(atIndex(recorded), `${under}#${index}`) ??
      take(recorded, under)
    if (!picked) throw new SellerError(`no recording of ${under} in ${dir}`, { status: 404, code: 'not_recorded' })
    await sleep(picked.call.ms / speed, undefined, { signal: request.signal })
    return {
      output: await outputOf(picked),
      usage: picked.call.usage,
      requestId: `replayed:${under}/${picked.name}`,
      replayed: true,
    }
  }
  const timeouts = Object.fromEntries(CALL_KINDS.map((kind) => [kind, REPLAY_TIMEOUT_MS]))
  return sellers.map((seller) => ({ seller, call, timeouts }))
}

/** Writes one call's answer to the recording in `dir`: its pictures, then `call.json`. */
async function writeCall(
  dir: string,
  seller: string,
  request: SellerRequest,
  answer: SellerAnswer,
  ms: number,
): Promise<void> {
  const { job, index } = request.call
  const recordedAt = new Date().toISOString()
  const folder = join(dir, recordedUnder(request), `${recordedAt.replace(/[:.]/g, '-')}-${job}-${index}`)
  await mkdir(folder, { recursive: true })
  const call: RecordedCall = {
    function: request.call.function,
    preset: request.call.preset,
    callIndex: index,
    job,
    seller,
    model: request.model,
    request: { input: factsOf(request.input), options: request.options },
    ms,
    usage: answer.usage,
    ...(answer.requestId === undefined ? {} : { requestId: answer.requestId }),
    ...(answer.reportedCost === undefined ? {} : { reportedCost: answer.reportedCost }),
    output: await writeOutput(folder, answer.output),
    recordedAt,
  }
  await writeFile(join(folder, CALL_FILE), `${JSON.stringify(call, null, 2)}\n`)
}

/** The folder a call's recordings sit in, under the recording's: its AI function's, then its preset's. */
function recordedUnder(request: SellerRequest): string {
  return `${request.call.function}/${request.call.preset}`
}

/** The facts of a call's input worth keeping: a text call's long instructions are kept as their length. */
function factsOf(input: CallInput): unknown {
  if (input.kind !== 'text') return input
  return { ...input, instructions: `${input.instructions.length} characters` }
}

/** Writes an output's pictures into `folder`; the output as `call.json` keeps it. */
async function writeOutput(folder: string, output: SellerOutput): Promise<RecordedOutput> {
  const write = (pictures: PictureBytes[], name: string) =>
    Promise.all(
      pictures.map(async (p, i): Promise<RecordedPicture> => {
        const file = `${name}-${i}.${EXTENSIONS[p.type] ?? 'bin'}`
        await writeFile(join(folder, file), p.bytes)
        return { file, type: p.type, width: p.width, height: p.height }
      }),
    )
  if (output.kind === 'text') return output
  if (output.kind === 'pictures') return { kind: 'pictures', pictures: await write(output.pictures, 'picture') }
  return { kind: 'layers', layers: await write(output.layers, 'layer'), gpuSeconds: output.gpuSeconds }
}

/** The recorded calls kept under `under` in `dir`, oldest first; none when it has no folder. */
async function recordingsOf(dir: string, under: string): Promise<Recorded[]> {
  const underDir = join(dir, under)
  const folders = await readdir(underDir, { withFileTypes: true }).catch(() => [])
  const recorded: Recorded[] = []
  for (const name of folders
    .filter((f) => f.isDirectory())
    .map((f) => f.name)
    .sort()) {
    // A folder whose `call.json` is not written yet, or is broken, is passed over.
    const path = join(underDir, name)
    const text = await readFile(join(path, CALL_FILE), 'utf8').catch(() => null)
    if (text === null) continue
    try {
      recorded.push({ name, path, call: JSON.parse(text) as RecordedCall })
    } catch {
      continue
    }
  }
  return recorded
}

/** A recorded call's output, its pictures read back as bytes. */
async function outputOf({ path, call }: Recorded): Promise<SellerOutput> {
  const { output } = call
  const read = (pictures: RecordedPicture[]) =>
    Promise.all(
      pictures.map(async (p): Promise<PictureBytes> => {
        const bytes = new Uint8Array(await readFile(join(path, p.file)))
        return { bytes, type: p.type, width: p.width, height: p.height }
      }),
    )
  if (output.kind === 'text') return output
  if (output.kind === 'pictures') return { kind: 'pictures', pictures: await read(output.pictures) }
  return { kind: 'layers', layers: await read(output.layers), gpuSeconds: output.gpuSeconds }
}
