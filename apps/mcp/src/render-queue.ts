// The process's side of the render worker: renders wait here and are posted to the worker one at a time, so a job
// holds no copy of its design or bytes until it is drawn. Past the renders that may wait, a render answers busy with
// the seconds to wait. A render that takes too long, or a worker that fails, ends the worker; the next render starts
// a fresh one.
import { Worker } from 'node:worker_threads'

import { AGENT_RENDER_MAX_SCALE, type AgentRender } from '@dazbee/export'
import type { Design } from '@dazbee/schema'

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

/** The renders waiting for the worker, drawn one at a time. */
export interface RenderQueue {
  /**
   * The frame drawn on the worker once the renders before it are. A tool refusal says when too many wait, with the
   * seconds to wait, when no PNG of the frame fits, or when it took too long to draw.
   */
  draw(render: FrameRender): Promise<AgentRender>
  /** The whole seconds to wait when as many renders wait as may, so the next would be refused; else 0. */
  busy(): number
  /** Ends the worker; renders waiting or drawn are refused. */
  close(): void
}

/** What the queue holds to: how many renders may wait, how long one may take, and how the worker starts. */
export interface RenderQueueOptions {
  waiting: number
  timeoutMs?: number
  start?: () => RenderThread
}

/** A render waiting or being drawn, with what settles its call. */
interface Pending {
  job: RenderJob
  /** Whether the worker ends once it is drawn, for the memory it grew to. */
  big: boolean
  resolve(render: AgentRender): void
  reject(error: Error): void
}

/** What a render is told once the server is stopping. */
const STOPPING = 'This server is stopping; try again in a moment'
/** How long a render is taken to last before any has been drawn. */
const FIRST_GUESS_MS = 1000
/** The weight the latest render's time takes in the time a render is taken to last. */
const LATEST_WEIGHT = 0.2

/** The renders of the process, at most `waiting` waiting beside the one being drawn. */
export function renderQueue({ waiting, timeoutMs = RENDER_TIMEOUT_MS, start = startWorker }: RenderQueueOptions) {
  /** The worker, started on the first render and again after one ends. */
  let thread: RenderThread | undefined
  /** The render on the worker, with when it was posted and the timer that ends it. */
  let drawing: (Pending & { at: number; timer: NodeJS.Timeout }) | undefined
  /** The renders waiting, first come first. */
  const queued: Pending[] = []
  /** How long a render has lasted lately, in milliseconds. */
  let lasts = FIRST_GUESS_MS
  /** The id the next job takes, which its answer carries back. */
  let nextId = 0
  /** Whether the queue was closed: it takes no render after. */
  let closed = false

  function busy() {
    if (!drawing || queued.length < waiting) return 0
    return Math.max(1, Math.ceil((lasts * (queued.length + 1)) / 1000))
  }

  function draw(render: FrameRender): Promise<AgentRender> {
    if (closed) return Promise.reject(new ToolRefusal(STOPPING))
    const wait = busy()
    if (wait > 0)
      return Promise.reject(new ToolRefusal(`Dazbee is drawing other renders; try again in ${wait} seconds`))
    const frame = render.design.frames[render.frameId]
    if (!frame) return Promise.reject(new Error(`no frame "${render.frameId}"`))
    const { maxSize, pixels } = drawnAt(frame, render.maxSize)
    const job = { ...render, design: JSON.stringify(render.design), maxSize, id: nextId++ }
    return new Promise((resolve, reject) => {
      queued.push({ job, big: pixels > BIG_RENDER_PIXELS, resolve, reject })
      next()
    })
  }

  /** Posts the first render waiting, once the worker is free. */
  function next() {
    const pending = drawing ? undefined : queued.shift()
    if (!pending) return
    const worker = (thread ??= started())
    const timer = setTimeout(
      () =>
        failed(
          worker,
          new ToolRefusal(`The frame took more than ${timeoutMs / 1000} seconds to draw; ask for a smaller maxSize`),
        ),
      timeoutMs,
    )
    drawing = { ...pending, at: performance.now(), timer }
    worker.ref()
    try {
      worker.postMessage(pending.job)
    } catch (error) {
      failed(worker, error instanceof Error ? error : new Error(String(error)))
    }
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

  /** Settles the render the worker answered, and posts the next. */
  function answered(worker: RenderThread, answer: RenderAnswer) {
    const done = drawing
    if (worker !== thread || !done || answer.id !== done.job.id) return
    drawing = undefined
    clearTimeout(done.timer)
    lasts += (performance.now() - done.at - lasts) * LATEST_WEIGHT
    if (done.big) end(worker)
    else worker.unref()
    if ('png' in answer) done.resolve(answer)
    else if ('tooBig' in answer)
      done.reject(new ToolRefusal(`No picture of the frame “${done.job.frameId}” is small enough to send`))
    else done.reject(new Error(answer.error))
    next()
  }

  /** Ends a worker that failed or took too long, refusing its render with `error`, and posts the next. */
  function failed(worker: RenderThread, error: Error) {
    if (worker !== thread) return
    end(worker)
    const done = drawing
    drawing = undefined
    if (done) {
      clearTimeout(done.timer)
      done.reject(error)
    }
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
    if (thread) failed(thread, refused)
  }

  return { draw, busy, close } satisfies RenderQueue
}

/** The render worker, a thread of its own. */
function startWorker(): RenderThread {
  return new Worker(new URL('./render-worker.ts', import.meta.url))
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
