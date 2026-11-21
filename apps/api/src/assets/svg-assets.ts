// SVG files in the asset library, read and drawn on a thread of their own (svg-worker.ts), so no
// file can hold up the API's other requests or take its memory. Files go to the thread one at a
// time, in the drawing turn, each with a time limit; the thread's CanvasKit memory and heap have
// ceilings. It is ended past a file's time, when it fails, once its memory grew past what it
// started with, or after 10 seconds with nothing to do, and the next file starts a new one. A file is
// refused with a sentence when it passes the SVG reader's limits, needs more memory than the thread
// may take, or takes longer than its time.
import { Worker } from 'node:worker_threads'

import { type ImageHeader, MAX_SVG_BYTES } from '@dazbee/schema'
import { SVG_TYPE, svgMarkup } from '@dazbee/svg'

import { inDrawingTurn } from '../drawing/drawing-turn.ts'
import type { SvgAnswer, SvgJob, SvgReply, SvgThreadData, SvgWork } from './svg-worker.ts'

/** A file refused with a sentence that says why, which the person who added it is told. */
export class SvgRefused extends Error {}

/** How long reading a file or drawing its thumbnail may take: the thread is ended past it. */
export const SVG_TIME_LIMIT_MS = 10_000

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
const TOO_MUCH_MEMORY = 'This SVG file needs too much memory to draw'

/** The thread, started for the first file and kept until it is ended. */
let svgThread: Worker | undefined
/** What ends the thread once it has had nothing to do for SVG_IDLE_MS. */
let idleTimer: NodeJS.Timeout | undefined
/** The id the next job takes, which its answer carries back. */
let nextJob = 0

/**
 * An SVG file's type and size, its sides rounded up to whole pixels; null when it isn't one we can
 * read as layers. Throws SvgRefused when it is too complex to read or takes longer than `timeoutMs`.
 */
export async function readSvgHeader(bytes: Uint8Array, timeoutMs = SVG_TIME_LIMIT_MS): Promise<ImageHeader | null> {
  const text = svgText(bytes)
  if (!text) return null
  const answer = await onSvgThread({ kind: 'header', text }, 'read', timeoutMs)
  if ('unreadable' in answer) return null
  if (!('header' in answer)) throw refusal(answer)
  const { width, height } = answer.header
  return { contentType: SVG_TYPE, width: Math.max(1, Math.ceil(width)), height: Math.max(1, Math.ceil(height)) }
}

/**
 * The file's layers drawn in a see-through frame, `size` pixels on the longer side, as a PNG.
 * Throws SvgRefused when it is too complex or too big to draw, or takes longer than `timeoutMs`.
 */
export async function svgThumbnail(
  bytes: Uint8Array,
  size: number,
  timeoutMs = SVG_TIME_LIMIT_MS,
): Promise<Uint8Array> {
  const text = svgText(bytes)
  if (!text) throw new Error('not an SVG file')
  const answer = await onSvgThread({ kind: 'thumbnail', text, size }, 'draw', timeoutMs)
  if ('png' in answer) return answer.png
  if ('unreadable' in answer) throw new Error(`the SVG file can't be read: ${answer.unreadable}`)
  throw refusal(answer)
}

/** The bytes as SVG markup: UTF-8 text whose first element is <svg>. Null for anything else. */
function svgText(bytes: Uint8Array): string | null {
  if (bytes.length > MAX_SVG_BYTES) return null
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  return svgMarkup(text)
}

/**
 * What the thread makes of the job, in the job's drawing turn. Past `timeoutMs`, or past its heap,
 * the thread is ended and the file refused; a thread that failed, or whose memory grew, is ended
 * before the turn is over, so its memory is given back before the next drawing starts.
 */
function onSvgThread(work: SvgWork, verb: 'read' | 'draw', timeoutMs: number): Promise<SvgAnswer> {
  return inDrawingTurn(async () => {
    clearTimeout(idleTimer)
    const thread = (svgThread ??= startThread())
    let reply: SvgReply
    try {
      reply = await replyFrom(thread, { ...work, id: nextJob++ }, verb, timeoutMs)
    } catch (error) {
      await endThread(thread)
      throw error
    }
    if ('tooMuchMemory' in reply || 'error' in reply || reply.memory > CANVASKIT_START_MEMORY) await endThread(thread)
    else idleTimer = setTimeout(() => void endThread(thread), SVG_IDLE_MS).unref()
    return reply
  })
}

/** A new thread, which keeps the process alive only while it works on a file. */
function startThread(): Worker {
  const thread = new Worker(new URL('./svg-worker.ts', import.meta.url), {
    workerData: { svgMemoryLimit: SVG_MEMORY_LIMIT } satisfies SvgThreadData,
    resourceLimits: SVG_HEAP_LIMITS,
  })
  thread.unref()
  // A thread that fails or stops between files is started again for the next one.
  const forget = () => {
    if (svgThread === thread) svgThread = undefined
  }
  thread.on('error', forget)
  thread.on('exit', forget)
  return thread
}

/** The thread's reply to the job; rejected past `timeoutMs`, or when the thread fails or stops first. */
function replyFrom(thread: Worker, job: SvgJob, verb: 'read' | 'draw', timeoutMs: number): Promise<SvgReply> {
  return new Promise<SvgReply>((resolve, reject) => {
    const timer = setTimeout(
      () => done(() => reject(new SvgRefused(`This SVG file took more than ${timeoutMs / 1000} seconds to ${verb}`))),
      timeoutMs,
    )
    const replied = (reply: SvgReply) => {
      if (reply.id === job.id) done(() => resolve(reply))
    }
    const failed = (error: Error & { code?: string }) =>
      done(() => reject(error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? new SvgRefused(TOO_MUCH_MEMORY) : error))
    const stopped = (code: number) => done(() => reject(new Error(`the SVG thread stopped (${code})`)))
    thread.on('message', replied)
    thread.on('error', failed)
    thread.on('exit', stopped)
    thread.ref()
    thread.postMessage(job)
    /** Settles the job once, leaving the thread to the next. */
    function done(settle: () => void) {
      clearTimeout(timer)
      thread.off('message', replied)
      thread.off('error', failed)
      thread.off('exit', stopped)
      thread.unref()
      settle()
    }
  })
}

/** Ends the thread, once it is the one kept or no longer is, and resolves once it has stopped. */
async function endThread(thread: Worker) {
  if (svgThread === thread) svgThread = undefined
  await thread.terminate()
}

/** The error a thread's answer that is neither the job done nor unreadable stands for. */
function refusal(answer: SvgAnswer): Error {
  if ('tooBig' in answer) return new SvgRefused(`This SVG file is too complex to draw: ${answer.tooBig}`)
  if ('tooMuchMemory' in answer) return new SvgRefused(TOO_MUCH_MEMORY)
  return new Error('error' in answer ? answer.error : 'the SVG thread answered nothing it was asked')
}
