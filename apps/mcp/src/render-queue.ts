// The process's side of the render worker: renders wait here, at most one of each access, and each is made (its
// design read, its images fetched) only when its turn comes, then posted to the worker, so one render at a time holds
// its bytes. Past the renders that may wait, a render answers busy with the seconds to wait. A render that takes too
// long, or a worker that fails, ends the worker; the next render starts a fresh one.
import { Worker } from 'node:worker_threads'

import { AGENT_RENDER_MAX_SCALE, type AgentRender } from '@dazbee/export'
import { type Design, readImageHeader } from '@dazbee/schema'

import { BIG_RENDER_PIXELS, MAX_RENDER_PIXELS, RENDER_TIMEOUT_MS } from './limits.ts'
import type { RenderAnswer, RenderJob } from './render-worker.ts'
import { ToolRefusal } from './tools/define-tool.ts'

/** The worker as the queue uses it: a Node worker thread running `render-worker.ts`, or a test's stand-in. */
export interface RenderThread {
  postMessage(job: RenderJob): void
  on(event: 'message', listener: (answer: RenderAnswer) => void): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'exit', listener: (code: number) => void): unknown
  ref(): void
  unref(): void
  terminate(): Promise<number>
}

/** A render to draw: the job without its id, with the design as the tab holds it. */
export type FrameRender = Omit<RenderJob, 'id' | 'design'> & { design: Design }

/** A render drawn, with how long the worker took. */
export type DrawnRender = AgentRender & { ms: number }

/** The renders waiting for the worker, drawn one at a time. */
export interface RenderQueue {
  /**
   * The render `make` gives, made once its turn comes and drawn on the worker, for the access `by`. A tool refusal
   * says when too many renders wait, or one of the access's already does, with the seconds to wait; when no PNG of
   * the frame fits; or when it took too long.
   */
  draw(by: string, make: () => Promise<FrameRender>): Promise<DrawnRender>
  /** The whole seconds to wait when a render of `by` would be refused as busy; else 0. */
  busy(by: string): number
  /** Ends the worker; renders waiting or drawn are refused. */
  close(): void
}

/** What the queue holds to: how many renders may wait, how long one may take, and how the worker starts. */
export interface RenderQueueOptions {
  waiting: number
  timeoutMs?: number
  start?: () => RenderThread
}

/** A render waiting, with what settles its call. */
interface Pending {
  by: string
  make: () => Promise<FrameRender>
  resolve(render: DrawnRender): void
  reject(error: Error): void
}

/** The render being made or drawn: its timer, and once made its job and whether it ends the worker. */
interface Drawing extends Pending {
  timer: NodeJS.Timeout
  job?: RenderJob
  /** When the job was posted to the worker. */
  at?: number
  /** Whether the worker ends once it is drawn, for the memory it grew to. */
  big?: boolean
}

/** What a render is told once the server is stopping. */
const STOPPING = 'This server is stopping; try again in a moment'
/** How long a render is taken to last before any has been drawn. */
const FIRST_GUESS_MS = 1000
/** The weight the latest render's time takes in the time a render is taken to last. */
const LATEST_WEIGHT = 0.2

/** The renders of the process, at most `waiting` waiting beside the one being drawn, and one of each access. */
export function renderQueue({ waiting, timeoutMs = RENDER_TIMEOUT_MS, start = startWorker }: RenderQueueOptions) {
  /** The worker, started on the first render and again after one ends. */
  let thread: RenderThread | undefined
  /** The render being made or drawn. */
  let drawing: Drawing | undefined
  /** The renders waiting, first come first. */
  const queued: Pending[] = []
  /** How long a render has lasted lately, in milliseconds. */
  let lasts = FIRST_GUESS_MS
  /** The id the next job takes, which its answer carries back. */
  let nextId = 0
  /** Whether the queue was closed: it takes no render after. */
  let closed = false

  function busy(by: string) {
    if (drawing?.by === by) return secondsFor(1)
    const ahead = queued.findIndex((pending) => pending.by === by)
    if (ahead >= 0) return secondsFor(ahead + 2)
    if (!drawing || queued.length < waiting) return 0
    return secondsFor(queued.length + 1)
  }

  /** The whole seconds `renders` renders take, as they have lately. */
  function secondsFor(renders: number) {
    return Math.max(1, Math.ceil((lasts * renders) / 1000))
  }

  function draw(by: string, make: () => Promise<FrameRender>): Promise<DrawnRender> {
    if (closed) return Promise.reject(new ToolRefusal(STOPPING))
    const wait = busy(by)
    if (wait > 0)
      return Promise.reject(new ToolRefusal(`Dazbee is drawing other renders; try again in ${wait} seconds`))
    return new Promise((resolve, reject) => {
      queued.push({ by, make, resolve, reject })
      next()
    })
  }

  /** Makes the first render waiting, once none is being made or drawn, and posts it to the worker. */
  function next() {
    const pending = drawing ? undefined : queued.shift()
    if (!pending) return
    const current: Drawing = { ...pending, timer: setTimeout(() => timedOut(current), timeoutMs) }
    drawing = current
    pending.make().then(
      (render) => {
        if (drawing === current) post(current, render)
      },
      (error: unknown) => {
        if (drawing === current) settle(current, () => current.reject(asError(error)))
      },
    )
  }

  /** Posts the render made to the worker, started if there is none. */
  function post(current: Drawing, render: FrameRender) {
    const frame = render.design.frames[render.frameId]
    if (!frame) return settle(current, () => current.reject(new Error(`no frame "${render.frameId}"`)))
    const { maxSize, pixels } = drawnAt(frame, render.maxSize)
    current.job = { ...render, design: JSON.stringify(render.design), maxSize, id: nextId++ }
    current.big = pixels + decodedPixels(render.images) > BIG_RENDER_PIXELS
    current.at = performance.now()
    const worker = (thread ??= started())
    worker.ref()
    try {
      worker.postMessage(current.job)
    } catch (error) {
      failed(worker, asError(error))
    }
  }

  /** Refuses a render past its time; the worker drawing it is ended. */
  function timedOut(current: Drawing) {
    if (drawing !== current) return
    const refusal = new ToolRefusal(
      `The frame took more than ${timeoutMs / 1000} seconds to draw; ask for a smaller maxSize`,
    )
    if (current.job && thread) failed(thread, refusal)
    else settle(current, () => current.reject(refusal))
  }

  /** A new worker, which keeps the process alive only while it draws. */
  function started(): RenderThread {
    const worker = start()
    worker.unref()
    worker.on('message', (answer) => answered(worker, answer))
    worker.on('error', (error) => failed(worker, error))
    worker.on('exit', (code) => failed(worker, new Error(`the render worker stopped (${code})`)))
    return worker
  }

  /**
   * Settles the render the worker answered, and makes the next. A worker that answered an error is ended too, since
   * its CanvasKit may have aborted.
   */
  function answered(worker: RenderThread, answer: RenderAnswer) {
    const current = drawing
    const job = current?.job
    if (worker !== thread || !current || !job || answer.id !== job.id) return
    const ms = performance.now() - (current.at ?? 0)
    lasts += (ms - lasts) * LATEST_WEIGHT
    if (current.big || 'error' in answer) end(worker)
    else worker.unref()
    settle(current, () => {
      if ('png' in answer)
        current.resolve({ png: answer.png, width: answer.width, height: answer.height, scale: answer.scale, ms })
      else if ('tooBig' in answer)
        current.reject(new ToolRefusal(`No picture of the frame “${job.frameId}” is small enough to send`))
      else current.reject(new Error(answer.error))
    })
  }

  /** Ends a worker that failed or took too long, refusing its render with `error`, and makes the next. */
  function failed(worker: RenderThread, error: Error) {
    if (worker !== thread) return
    end(worker)
    const current = drawing
    if (current) settle(current, () => current.reject(error))
  }

  /** Ends the render being made or drawn, tells its call with `tell`, and makes the next. */
  function settle(current: Drawing, tell: () => void) {
    clearTimeout(current.timer)
    drawing = undefined
    tell()
    next()
  }

  /** Ends the worker; the next render starts a fresh one. */
  function end(worker: RenderThread) {
    if (thread === worker) thread = undefined
    void worker.terminate()
  }

  function close() {
    closed = true
    const refused = new ToolRefusal(STOPPING)
    for (const pending of queued.splice(0)) pending.reject(refused)
    const current = drawing
    if (thread) end(thread)
    if (current) settle(current, () => current.reject(refused))
  }

  return { draw, busy, close } satisfies RenderQueue
}

/** The pixels images take decoded, read from their headers; an image whose header can't be read counts none. */
export function decodedPixels(images: Readonly<Record<string, Uint8Array>>): number {
  let pixels = 0
  for (const bytes of Object.values(images)) {
    const header = readImageHeader(bytes)
    if (header) pixels += header.width * header.height
  }
  return pixels
}

/** The render worker, a thread of its own. */
function startWorker(): RenderThread {
  return new Worker(new URL('./render-worker.ts', import.meta.url))
}

/** `error` as an Error. */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

/**
 * `maxSize`, made smaller where the frame drawn at it would pass `MAX_RENDER_PIXELS`, and the pixels the frame is
 * drawn at: the scale agentRender first draws at, its longer side fitted to `maxSize` and at most twice its size.
 */
function drawnAt(frame: { width: number; height: number }, maxSize: number) {
  const longer = Math.max(frame.width, frame.height)
  const shorter = Math.max(1, Math.min(frame.width, frame.height))
  const pixelsAt = (size: number) => {
    const scale = Math.min(AGENT_RENDER_MAX_SCALE, size / longer)
    return Math.ceil(frame.width * scale) * Math.ceil(frame.height * scale)
  }
  // The surface's sides are rounded up, so the fit leaves two pixels for that.
  const fitted = Math.min(maxSize, Math.floor(Math.sqrt((MAX_RENDER_PIXELS * longer) / shorter)) - 2)
  return { maxSize: fitted, pixels: pixelsAt(fitted) }
}
