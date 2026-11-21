// SVG files in the asset library, read and drawn on a thread of their own (svg-worker.ts), so no
// file can hold up the API's other requests or take its memory. Each file is read and drawn in one
// job; jobs go to the thread one at a time, in the drawing turn, and only a few may wait. Each job
// has a time limit, which starts once the thread is ready, and the thread's CanvasKit memory and
// heap have ceilings. The thread is ended past a job's time, when it fails, or once its memory grew
// past what it started with. The API starts the thread when it starts, and a thread that was ready
// is started again as soon as it ends, so a file seldom waits for one; a file that comes while one
// starts waits for it as long as its request may wait. A file is refused with a sentence when it
// passes the SVG reader's limits, needs more memory than the thread may take, or takes longer than
// its time.
import { Worker } from 'node:worker_threads'

import { type ImageHeader, MAX_SVG_BYTES } from '@dazbee/schema'
import { SVG_TYPE, svgMarkup } from '@dazbee/svg'

import { inDrawingTurn } from '../drawing/drawing-turn.ts'
import type { SvgAnswer, SvgJob, SvgReady, SvgReply, SvgThreadData } from './svg-worker.ts'

/** A file refused with a sentence that says why, which the person who added it is told. */
export class SvgRefused extends Error {}
/** A file not read now, because too many wait to be or the thread isn't ready: it may be added again in a moment. */
export class SvgBusy extends Error {}

/** A file read and drawn: its type and size, and its thumbnail as a PNG. */
export interface SvgAsset {
  header: ImageHeader
  png: Uint8Array
}

/** What a reader is made with: the API's reader takes the defaults, and tests change them. */
export interface SvgReaderSettings {
  /** The module the thread runs: svg-worker.ts, or a stand-in that runs it after a held start. */
  threadFile: URL
  /** How long the thread may take to load CanvasKit and the fonts before it is ended as stuck. */
  startLimitMs: number
  /** How long after it comes a file may wait for the thread to be ready before it is answered busy. */
  waitLimitMs: number
}

/** SVG files read and drawn on a thread of their own, kept ready once started. */
export interface SvgReader {
  /**
   * The SVG file's type and size, its sides rounded up to whole pixels, and its thumbnail, `size`
   * pixels on the longer side; null when it isn't one we can read as layers. Throws SvgRefused when
   * it is too complex or too big to draw or takes longer than `timeoutMs` once the thread is ready,
   * and SvgBusy when too many files wait to be read or the thread isn't ready within the file's wait.
   */
  read(bytes: Uint8Array, size: number, timeoutMs?: number): Promise<SvgAsset | null>
  /** Starts the thread unless one is kept; resolves true once it is ready, false when it failed to get ready. */
  start(): Promise<boolean>
  /** Ends the thread and starts no other; resolves once it has stopped. */
  end(): Promise<void>
}

/** The thread, and whether it got ready: true once it posted `ready`, false when it stopped first. */
interface SvgThread {
  worker: Worker
  ready: Promise<boolean>
}

/** How long reading and drawing one file may take: the thread is ended past it. */
export const SVG_TIME_LIMIT_MS = 10_000
/**
 * How long the thread may take to get ready. A start loads CanvasKit's 9 MB of wasm and the fonts:
 * 0.7–1.0 s on an idle dev machine, 1.3 s pinned to one of its cores, and up to 10 s on that core
 * shared with four busy threads. The live server's one CPU may be slower, so a start there under
 * load may take 15 s; 60 s is four times that. No file waits that long for it (SVG_WAIT_LIMIT_MS):
 * past it, a start counts as stuck.
 */
export const SVG_START_LIMIT_MS = 60_000
/**
 * How long a file may wait for the thread to be ready, from when it comes. A typical file draws in
 * about a second, so a file that waits all of it is still answered within the 30 s an agent's call
 * to the API waits (apps/mcp/src/api.ts).
 */
export const SVG_WAIT_LIMIT_MS = 20_000

/** CanvasKit's memory when it starts, which the thread may keep. */
const CANVASKIT_START_MEMORY = 128 * 2 ** 20
/**
 * The bytes CanvasKit's memory may grow to on the thread: room to decode a 6000 × 4000 picture a
 * file embeds and draw it small, and the most the thread's drawing adds to the API's memory.
 */
const SVG_MEMORY_LIMIT = 192 * 2 ** 20
/** The thread's JavaScript heap: a 5 MB file of 4,900 paths is read and drawn within it. */
const SVG_HEAP_LIMITS = { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 }
/** The files that may be read at once or wait to be; each waits holding its bytes. */
const MAX_SVG_JOBS = 4
const TOO_MUCH_MEMORY = 'This SVG file needs too much memory to draw'
const NOT_READY = 'Dazbee is getting ready to read SVG files; add this one again in a minute'

/** The API's reader, whose thread main.ts starts with the API. */
const apiReader = svgReader()

/** The SVG file as the API's reader reads it (SvgReader's `read`). */
export function readSvgAsset(bytes: Uint8Array, size: number, timeoutMs = SVG_TIME_LIMIT_MS): Promise<SvgAsset | null> {
  return apiReader.read(bytes, size, timeoutMs)
}

/** The SVG file's thumbnail, as readSvgAsset draws it; throws when it can't be read. */
export async function svgThumbnail(bytes: Uint8Array, size: number): Promise<Uint8Array> {
  const read = await readSvgAsset(bytes, size)
  if (!read) throw new Error('not an SVG file that can be read as layers')
  return read.png
}

/** Starts the API's thread ahead of the first file (SvgReader's `start`). */
export function startSvgThread(): Promise<boolean> {
  return apiReader.start()
}

/** A reader of SVG files whose thread starts with the first file or `start`, and is kept ready from then. */
export function svgReader(settings: Partial<SvgReaderSettings> = {}): SvgReader {
  const {
    threadFile = new URL('./svg-worker.ts', import.meta.url),
    startLimitMs = SVG_START_LIMIT_MS,
    waitLimitMs = SVG_WAIT_LIMIT_MS,
  } = settings

  /** The thread, from its start until it stops. */
  let thread: SvgThread | undefined
  /** The id the next job takes, which its answer carries back. */
  let nextJob = 0
  /** The files being read or waiting to be. */
  let jobs = 0
  /** Whether the reader was ended, after which no thread starts. */
  let ended = false

  /** The thread kept, started now when there is none. */
  function kept(): SvgThread {
    thread ??= startThread()
    return thread
  }

  /**
   * A new thread, which keeps the process alive only while it works on a file. It is ended when it
   * isn't ready within startLimitMs. Once it was ready, it is started again as soon as it stops; one
   * that never got ready is started again only when a file or `start` asks.
   */
  function startThread(): SvgThread {
    const worker = new Worker(threadFile, {
      workerData: { svgMemoryLimit: SVG_MEMORY_LIMIT } satisfies SvgThreadData,
      resourceLimits: SVG_HEAP_LIMITS,
    })
    worker.unref()
    let wasReady = false
    const ready = new Promise<boolean>((resolve) => {
      const stuck = setTimeout(() => void worker.terminate(), startLimitMs).unref()
      const told = (message: SvgReady | SvgReply) => {
        if ('ready' in message) settle(true)
      }
      const stopped = () => settle(false)
      worker.on('message', told)
      worker.on('exit', stopped)
      /** Settles whether the thread got ready, once. */
      function settle(isReady: boolean) {
        wasReady = isReady
        clearTimeout(stuck)
        worker.off('message', told)
        worker.off('exit', stopped)
        resolve(isReady)
      }
    })
    worker.on('exit', () => {
      if (thread?.worker !== worker) return
      thread = undefined
      if (wasReady && !ended) kept()
    })
    // A failure during a job reaches that job (replyFrom); any other ends the thread, whose exit is
    // handled above.
    worker.on('error', () => {})
    return { worker, ready }
  }

  /**
   * What the thread makes of the file, in its drawing turn; null when the bytes aren't SVG markup,
   * which are told apart inside the turn, so only one file at a time is held as text. Past
   * `timeoutMs`, or past its heap, the thread is ended and the file refused; a thread that failed, or
   * whose memory grew, is ended before the turn is over, so its memory is given back before the next
   * drawing starts.
   */
  async function onThread(bytes: Uint8Array, size: number, timeoutMs: number): Promise<SvgAnswer | null> {
    if (bytes.length > MAX_SVG_BYTES) return null
    if (jobs >= MAX_SVG_JOBS) throw new SvgBusy('Dazbee is reading other SVG files; add this one again in a minute')
    const waitUntil = Date.now() + waitLimitMs
    jobs++
    try {
      return await inDrawingTurn(async () => {
        const text = svgText(bytes)
        if (!text) return null
        const used = kept()
        if (!(await readyBy(used, waitUntil))) throw new SvgBusy(NOT_READY)
        let reply: SvgReply
        try {
          reply = await replyFrom(used.worker, { id: nextJob++, text, size }, timeoutMs)
        } catch (error) {
          await used.worker.terminate()
          throw error
        }
        if ('tooMuchMemory' in reply || 'error' in reply || reply.memory > CANVASKIT_START_MEMORY)
          await used.worker.terminate()
        return reply
      })
    } finally {
      jobs--
    }
  }

  async function read(bytes: Uint8Array, size: number, timeoutMs = SVG_TIME_LIMIT_MS): Promise<SvgAsset | null> {
    const answer = await onThread(bytes, size, timeoutMs)
    if (!answer || 'unreadable' in answer) return null
    if (!('png' in answer)) throw refusal(answer)
    const { width, height, png } = answer
    return {
      header: { contentType: SVG_TYPE, width: Math.max(1, Math.ceil(width)), height: Math.max(1, Math.ceil(height)) },
      png,
    }
  }

  function start(): Promise<boolean> {
    return ended ? Promise.resolve(false) : kept().ready
  }

  async function end() {
    ended = true
    await thread?.worker.terminate()
  }

  return { read, start, end }
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

/** Whether the thread is ready by `until`, a time from Date.now(); false too when it stopped before it got ready. */
function readyBy({ ready }: SvgThread, until: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const late = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), Math.max(0, until - Date.now()))
  })
  return Promise.race([ready, late]).finally(() => clearTimeout(timer))
}

/** The ready thread's reply to the job; rejected past `timeoutMs`, or when the thread fails or stops first. */
function replyFrom(worker: Worker, job: SvgJob, timeoutMs: number): Promise<SvgReply> {
  return new Promise<SvgReply>((resolve, reject) => {
    const replied = (reply: SvgReady | SvgReply) => {
      if ('id' in reply && reply.id === job.id) done(() => resolve(reply))
    }
    const failed = (error: Error & { code?: string }) =>
      done(() => reject(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new SvgRefused(TOO_MUCH_MEMORY) : error))
    const stopped = (code: number) => done(() => reject(new Error(`the SVG thread stopped (${code})`)))
    const timer = setTimeout(
      () => done(() => reject(new SvgRefused(`This SVG file took more than ${timeoutMs / 1000} seconds to draw`))),
      timeoutMs,
    )
    worker.on('message', replied)
    worker.on('error', failed)
    worker.on('exit', stopped)
    worker.ref()
    worker.postMessage(job)
    /** Settles the job, leaving the thread to the next; the listeners are gone after the first call. */
    function done(settle: () => void) {
      clearTimeout(timer)
      worker.off('message', replied)
      worker.off('error', failed)
      worker.off('exit', stopped)
      worker.unref()
      settle()
    }
  })
}

/** The error a thread's answer that is neither the file read nor unreadable stands for. */
function refusal(answer: SvgAnswer): Error {
  if ('tooBig' in answer) return new SvgRefused(`This SVG file is too complex to draw: ${answer.tooBig}`)
  if ('tooMuchMemory' in answer) return new SvgRefused(TOO_MUCH_MEMORY)
  return new Error('error' in answer ? answer.error : 'the SVG thread answered nothing it was asked')
}
