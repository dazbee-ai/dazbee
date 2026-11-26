// AI recordings, for development only: a recording seller writes each answer a real seller gives into a folder,
// and replay sellers answer calls from that folder in place of every seller, after about the time the recorded
// call took, at no cost. `useSellersOf` turns them on from AI_RECORD_DIR or AI_REPLAY_DIR, never in production.
//
// A recording holds a folder per AI step, and in it a folder per call: `call.json` and the call's pictures.
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'

import type { CallInput, Usage } from '@dazbee/schema'

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
  step: string
  /** The call's place in its job. */
  callIndex: number
  job: string
  seller: string
  /** The seller's own name for the model. */
  model: string
  /** What the call was asked: its input, a text call's instructions as their length, and the step's options. */
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
        console.error(JSON.stringify({ msg: 'AI call not recorded', step: request.call.step, error: String(error) }))
      }
      return answer
    },
  }
}

/**
 * A replay seller for each of `sellers`, answering every call from the recording in `dir` and calling no seller.
 * A call is answered by a recording of its AI step at its place in the job, else by any recording of its step,
 * each list taken in turn; after the time the recorded call took, divided by `speed`. Its answer is marked replayed,
 * so it costs nothing, and its request id names the recording. A step with no recording fails the call.
 */
export function replaySellers(sellers: string[], dir: string, speed: number): SellerAdapter[] {
  // How many calls each list of recordings has answered, by step and place, or by step alone.
  const turns = new Map<string, number>()
  const call = async (request: SellerRequest): Promise<SellerAnswer> => {
    const { step, index } = request.call
    const recorded = await recordingsOf(dir, step)
    const atIndex = recorded.filter((r) => r.call.callIndex === index)
    const [list, key] = atIndex.length > 0 ? [atIndex, `${step}#${index}`] : [recorded, step]
    const turn = turns.get(key) ?? 0
    const picked = list[turn % list.length]
    if (!picked) throw new SellerError(`no recording of ${step} in ${dir}`, { status: 404, code: 'not_recorded' })
    turns.set(key, turn + 1)
    await sleep(picked.call.ms / speed, undefined, { signal: request.signal })
    return {
      output: await outputOf(picked),
      usage: picked.call.usage,
      requestId: `replayed:${step}/${picked.name}`,
      replayed: true,
    }
  }
  return sellers.map((seller) => ({ seller, call }))
}

/** Writes one call's answer to the recording in `dir`: its pictures, then `call.json`. */
async function writeCall(
  dir: string,
  seller: string,
  request: SellerRequest,
  answer: SellerAnswer,
  ms: number,
): Promise<void> {
  const { job, step, index } = request.call
  const recordedAt = new Date().toISOString()
  const folder = join(dir, step, `${recordedAt.replace(/[:.]/g, '-')}-${job}-${index}`)
  await mkdir(folder, { recursive: true })
  const call: RecordedCall = {
    step,
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

/** The recorded calls of `step` in `dir`, oldest first; none when the step has no folder. */
async function recordingsOf(dir: string, step: string): Promise<Recorded[]> {
  const stepDir = join(dir, step)
  const folders = await readdir(stepDir, { withFileTypes: true }).catch(() => [])
  const recorded: Recorded[] = []
  for (const name of folders
    .filter((f) => f.isDirectory())
    .map((f) => f.name)
    .sort()) {
    // A folder whose `call.json` is not written yet, or is broken, is passed over.
    const path = join(stepDir, name)
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
