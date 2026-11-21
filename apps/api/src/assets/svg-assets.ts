// SVG files in the asset library, read and drawn on a thread of their own (svg-worker.ts), so no
// file can hold up the API's other requests or take its memory. Each file is read and drawn in one
// job; jobs go to the thread one at a time, in the drawing turn, and only a few may wait. Each job
// has a time limit, which starts once the thread is ready, and the thread's CanvasKit memory and
// heap have ceilings. The thread is ended past a job's time, when it fails, once its memory grew
// past what it started with, or after 10 seconds with nothing to do, and the next file starts a new
// one. A file is refused with a sentence when it passes the SVG reader's limits, needs more memory
// than the thread may take, or takes longer than its time.
import { Worker } from 'node:worker_threads'

import { type ImageHeader, MAX_SVG_BYTES } from '@dazbee/schema'
import { SVG_TYPE, svgMarkup } from '@dazbee/svg'

import { inDrawingTurn } from '../drawing/drawing-turn.ts'
import type { SvgAnswer, SvgJob, SvgReady, SvgReply, SvgThreadData } from './svg-worker.ts'

/** A file refused with a sentence that says why, which the person who added it is told. */
export class SvgRefused extends Error {}
/** A file not read because too many wait to be: it may be added again in a moment. */
export class SvgBusy extends Error {}

/** A file read and drawn: its type and size, and its thumbnail as a PNG. */
export interface SvgAsset {
  header: ImageHeader
  png: Uint8Array
}

/** The thread with what tells when it is ready for a job. */
interface SvgThread {
  worker: Worker
  ready: Promise<void>
}

/** How long reading and drawing one file may take: the thread is ended past it. */
export const SVG_TIME_LIMIT_MS = 10_000

/** How long the thread may take to load CanvasKit and the fonts before it is taken to have failed. */
const SVG_START_LIMIT_MS = 5_000
/** CanvasKit's memory when it starts, which the thread may keep. */
const CANVASKIT_START_MEMORY = 128 * 2 ** 20
/**
 * The bytes CanvasKit's memory may grow to on the thread: room to decode a 6000 × 4000 picture a
 * file embeds and draw it small, and the most the thread's drawing adds to the API's memory.
 */
const SVG_MEMORY_LIMIT = 192 * 2 ** 20
/** The thread's JavaScript heap: a 5 MB file of 4,900 paths is read and drawn within it. */
const SVG_HEAP_LIMITS = { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 }
/** How long the thread is kept with nothing to do, for the next file of an upload of several. */
const SVG_IDLE_MS = 10_000
/** The files that may be read at once or wait to be; each waits holding its bytes. */
const MAX_SVG_JOBS = 4
const TOO_MUCH_MEMORY = 'This SVG file needs too much memory to draw'

/** The thread, started for the first file and kept until it is ended. */
let svgThread: SvgThread | undefined
/** What ends the thread once it has had nothing to do for SVG_IDLE_MS. */
let idleTimer: NodeJS.Timeout | undefined
/** The id the next job takes, which its answer carries back. */
let nextJob = 0
/** The files being read or waiting to be. */
let svgJobs = 0

/**
 * The SVG file's type and size, its sides rounded up to whole pixels, and its thumbnail, `size`
 * pixels on the longer side; null when it isn't one we can read as layers. Throws SvgRefused when
 * it is too complex or too big to draw or takes longer than `timeoutMs`, and SvgBusy when too many
 * files wait to be read.
 */
export async function readSvgAsset(
  bytes: Uint8Array,
  size: number,
  timeoutMs = SVG_TIME_LIMIT_MS,
): Promise<SvgAsset | null> {
  const answer = await onSvgThread(bytes, size, timeoutMs)
  if (!answer || 'unreadable' in answer) return null
  if (!('png' in answer)) throw refusal(answer)
  const { width, height, png } = answer
  return {
    header: { contentType: SVG_TYPE, width: Math.max(1, Math.ceil(width)), height: Math.max(1, Math.ceil(height)) },
    png,
  }
}

/** The SVG file's thumbnail, as readSvgAsset draws it; throws when it can't be read. */
export async function svgThumbnail(bytes: Uint8Array, size: number): Promise<Uint8Array> {
  const read = await readSvgAsset(bytes, size)
  if (!read) throw new Error('not an SVG file that can be read as layers')
  return read.png
}

/**
 * What the thread makes of the file, in its drawing turn; null when the bytes aren't SVG markup,
 * which are told apart inside the turn, so only one file at a time is held as text. Past
 * `timeoutMs`, or past its heap, the thread is ended and the file refused; a thread that failed, or
 * whose memory grew, is ended before the turn is over, so its memory is given back before the next
 * drawing starts.
 */
async function onSvgThread(bytes: Uint8Array, size: number, timeoutMs: number): Promise<SvgAnswer | null> {
  if (bytes.length > MAX_SVG_BYTES) return null
  if (svgJobs >= MAX_SVG_JOBS) throw new SvgBusy('Dazbee is reading other SVG files; add this one again in a minute')
  svgJobs++
  try {
    return await inDrawingTurn(async () => {
      const text = svgText(bytes)
      if (!text) return null
      clearTimeout(idleTimer)
      const thread = (svgThread ??= startThread())
      let reply: SvgReply
      try {
        reply = await replyFrom(thread, { id: nextJob++, text, size }, timeoutMs)
      } catch (error) {
        await endThread(thread)
        throw error
      }
      if ('tooMuchMemory' in reply || 'error' in reply || reply.memory > CANVASKIT_START_MEMORY) await endThread(thread)
      else idleTimer = setTimeout(() => void endThread(thread), SVG_IDLE_MS).unref()
      return reply
    })
  } finally {
    svgJobs--
  }
}

/** The bytes as SVG markup: UTF-8 text whose first element is <svg>. Null for anything else. */
function svgText(bytes: Uint8Array): string | null {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  return svgMarkup(text)
}

/** A new thread, which keeps the process alive only while it works on a file. */
function startThread(): SvgThread {
  const worker = new Worker(new URL('./svg-worker.ts', import.meta.url), {
    workerData: { svgMemoryLimit: SVG_MEMORY_LIMIT } satisfies SvgThreadData,
    resourceLimits: SVG_HEAP_LIMITS,
  })
  worker.unref()
  const ready = new Promise<void>((resolve) => {
    const told = (message: SvgReady | SvgReply) => {
      if (!('ready' in message)) return
      worker.off('message', told)
      resolve()
    }
    worker.on('message', told)
  })
  // A thread that fails or stops between files is started again for the next one.
  const forget = () => {
    if (svgThread?.worker === worker) svgThread = undefined
  }
  worker.on('error', forget)
  worker.on('exit', forget)
  return { worker, ready }
}

/**
 * The thread's reply to the job, once it is ready; rejected past `timeoutMs` from then, or when
 * the thread fails, stops or doesn't get ready first.
 */
function replyFrom({ worker, ready }: SvgThread, job: SvgJob, timeoutMs: number): Promise<SvgReply> {
  return new Promise<SvgReply>((resolve, reject) => {
    let timer = setTimeout(
      () => done(() => reject(new Error(`the SVG thread did not start in ${SVG_START_LIMIT_MS / 1000} seconds`))),
      SVG_START_LIMIT_MS,
    )
    let settled = false
    const replied = (reply: SvgReady | SvgReply) => {
      if ('id' in reply && reply.id === job.id) done(() => resolve(reply))
    }
    const failed = (error: Error & { code?: string }) =>
      done(() => reject(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new SvgRefused(TOO_MUCH_MEMORY) : error))
    const stopped = (code: number) => done(() => reject(new Error(`the SVG thread stopped (${code})`)))
    worker.on('message', replied)
    worker.on('error', failed)
    worker.on('exit', stopped)
    worker.ref()
    void ready.then(() => {
      if (settled) return
      clearTimeout(timer)
      timer = setTimeout(
        () => done(() => reject(new SvgRefused(`This SVG file took more than ${timeoutMs / 1000} seconds to draw`))),
        timeoutMs,
      )
      worker.postMessage(job)
    })
    /** Settles the job once, leaving the thread to the next. */
    function done(settle: () => void) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      worker.off('message', replied)
      worker.off('error', failed)
      worker.off('exit', stopped)
      worker.unref()
      settle()
    }
  })
}

/** Ends the thread, once it is the one kept or no longer is, and resolves once it has stopped. */
async function endThread({ worker }: SvgThread) {
  if (svgThread?.worker === worker) svgThread = undefined
  await worker.terminate()
}

/** The error a thread's answer that is neither the file read nor unreadable stands for. */
function refusal(answer: SvgAnswer): Error {
  if ('tooBig' in answer) return new SvgRefused(`This SVG file is too complex to draw: ${answer.tooBig}`)
  if ('tooMuchMemory' in answer) return new SvgRefused(TOO_MUCH_MEMORY)
  return new Error('error' in answer ? answer.error : 'the SVG thread answered nothing it was asked')
}
