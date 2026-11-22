// The pool of matcher workers, sized to the device (#172, In the browser). It holds nothing until
// the first piece comes: then it starts workers one at a time, each once the one before has started
// and pieces still wait, up to the most the device's cores and memory allow, always leaving a core
// to the page. CanvasKit's and ONNX Runtime's WebAssembly are compiled once on the page and posted
// to each worker. A worker is ended 15 s after it has nothing to do, at once when the tab is hidden
// or the page is left, and after a piece that leaves CanvasKit's heap past 512 MB; the compiled
// modules go with the last one. A worker that crashes is ended, its piece goes back on the queue and
// the pool shrinks by one; when a single worker fails twice, the pieces left stay pictures.
import type { TextStep } from '@dazbee/matchers'
import type { FontFamily, MatchAnswer, MatchJob, PictureWhy } from '@dazbee/schema'

/** The worker the pool posts to: a dedicated worker, or a stand-in in a test. */
export type MatchWorker = Pick<Worker, 'postMessage' | 'terminate' | 'onmessage' | 'onerror'>

/** The font catalog a job's fonts are found in, and the path a brand's uploaded face is read at, before its id. */
export interface MatchFonts {
  catalog: readonly FontFamily[]
  uploadPath: string
}

/** A job as a worker is sent it, once, before its first piece. */
export interface WorkerJob {
  id: number
  job: MatchJob
  fonts: MatchFonts
}

/** CanvasKit's and ONNX Runtime's WebAssembly, compiled on the page. */
export interface CompiledModules {
  canvasKit: WebAssembly.Module
  onnxRuntime: WebAssembly.Module
}

/** What the pool tells a worker: to start, to match a job's piece, and to forget a job that ended. */
export type MatchMessage =
  | ({ kind: 'matchStart' } & CompiledModules)
  | { kind: 'matchPiece'; id: number; jobId: number; index: number; job?: WorkerJob }
  | { kind: 'matchForget'; jobId: number }

/**
 * What a worker answers: it started or couldn't, a piece's step began, a piece's answer with
 * CanvasKit's heap after it, or a piece broke the worker (it ran out of memory), which then is ended.
 */
export type MatchReply =
  | { kind: 'matchReady' }
  | { kind: 'matchStartFailed'; message: string }
  | { kind: 'matchStep'; id: number; step: TextStep }
  | { kind: 'matchAnswer'; id: number; answer: MatchAnswer; heap: number }
  | { kind: 'matchBroken'; id: number; message: string }

/** What the pool is sized from: the device's cores and its memory in GB, when the browser says. */
export interface Device {
  cores: number
  memoryGb?: number | undefined
}

/** Whether the page is hidden or left, and who is told when that changes. */
export interface PageShown {
  hidden(): boolean
  onChange(listener: () => void): () => void
}

/** Who hears a job's pieces: each step as it begins, and each answer. */
export interface PoolListener {
  step(index: number, step: TextStep): void
  answer(index: number, answer: MatchAnswer): void
}

export interface MatchPool {
  /** Queues the job's pieces at `indexes`; `listener` hears their steps and answers. */
  add(job: WorkerJob, indexes: readonly number[], listener: PoolListener): void
  /** Drops the job's pieces still waiting and ends the workers matching its others; none is answered. */
  cancel(jobId: number): void
  /** Whether workers failed to start twice, so this browser can't run the matchers. */
  readonly unsupported: boolean
  destroy(): void
}

const MB = 2 ** 20
const GB = 2 ** 30

/**
 * A text worker's peak memory: CanvasKit's heap, ONNX Runtime's and the model, a piece's fonts. Chrome's
 * renderer process grew by 404 MB matching a held-out piece in one worker, and by 1,101 MB in three.
 */
export const TEXT_WORKER_PEAK = 410 * MB
/** How long a worker with nothing to do is kept for a piece that may come. */
export const IDLE_MS = 15_000
/** CanvasKit's heap past which a worker is ended after its piece: the heap never gives memory back. */
export const HEAP_LIMIT = 512 * MB

/** The share of the device's memory the pool may take. */
const MEMORY_SHARE = 1 / 4
/** The most memory the pool takes, on any device. */
const MOST_MEMORY = 1.5 * GB
/** The pool's memory where the browser doesn't say the device's. */
const UNKNOWN_MEMORY = 256 * MB
/** How many times a pool down to one worker sees it fail before the pieces left stay pictures. */
const FAILS_AT_ONE = 2
/** How many workers may fail to start, one after another, before this browser counts as unable. */
const START_FAILS = 2

/**
 * The most workers the device takes: its cores but one, and as many as its memory budget holds at
 * `peak` each (a quarter of its memory, at most 1.5 GB; 256 MB when the browser doesn't say); at least 1.
 */
export function poolLimit({ cores, memoryGb }: Device, peak = TEXT_WORKER_PEAK): number {
  const budget = memoryGb === undefined ? UNKNOWN_MEMORY : Math.min(memoryGb * GB * MEMORY_SHARE, MOST_MEMORY)
  return Math.max(1, Math.min(cores - 1, Math.floor(budget / peak)))
}

/** The page's visibility from the document: hidden, or left (until it is shown again from the back-forward cache). */
export function documentShown(): PageShown {
  let left = false
  return {
    hidden: () => left || document.visibilityState === 'hidden',
    onChange(listener) {
      const leave = () => {
        left = true
        listener()
      }
      const back = () => {
        left = false
        listener()
      }
      document.addEventListener('visibilitychange', listener)
      window.addEventListener('pagehide', leave)
      window.addEventListener('pageshow', back)
      return () => {
        document.removeEventListener('visibilitychange', listener)
        window.removeEventListener('pagehide', leave)
        window.removeEventListener('pageshow', back)
      }
    },
  }
}

/** A job in the pool: who hears it, and its pieces not yet answered. */
interface PooledJob {
  job: WorkerJob
  listener: PoolListener
  left: Set<number>
}

/** One piece to match. */
interface Task {
  id: number
  job: PooledJob
  index: number
}

/** A worker: starting, idle (with the timer that ends it) or matching a piece; and the jobs it was sent. */
interface Slot {
  worker: MatchWorker
  state: 'starting' | 'idle' | 'busy'
  task?: Task | undefined
  idle?: ReturnType<typeof setTimeout> | undefined
  jobs: Set<number>
}

export function matchPool({
  start,
  device,
  compile,
  page,
}: {
  /** Starts a worker. */
  start: () => MatchWorker
  device: Device
  /** Compiles the modules each worker is posted, once while any worker lives. */
  compile: () => Promise<CompiledModules>
  page: PageShown
}): MatchPool {
  const most = poolLimit(device)
  let dropped = 0
  let failsAtOne = 0
  let startFails = 0
  let unsupported = false
  let modules: Promise<CompiledModules> | undefined
  let nextTask = 0
  const queue: Task[] = []
  const slots: Slot[] = []
  const jobs = new Map<number, PooledJob>()
  const stopListening = page.onChange(shownChanged)

  /** The most workers now: the device's, less one for each that crashed, at least 1. */
  const limit = () => Math.max(1, most - dropped)

  /** Gives waiting pieces to idle workers, starts one more while pieces wait, and times the idle ones out. */
  function fill() {
    if (page.hidden()) return
    for (const slot of slots) {
      if (slot.state !== 'idle') continue
      const task = queue.shift()
      if (!task) break
      give(slot, task)
    }
    if (queue.length > 0 && slots.length < limit() && !slots.some((slot) => slot.state === 'starting')) startWorker()
    for (const slot of slots) if (slot.state === 'idle' && !slot.idle) slot.idle = setTimeout(() => end(slot), IDLE_MS)
  }

  function give(slot: Slot, task: Task) {
    clearTimeout(slot.idle)
    slot.idle = undefined
    slot.state = 'busy'
    slot.task = task
    const { job } = task.job
    const sent = slot.jobs.has(job.id)
    slot.jobs.add(job.id)
    const message: MatchMessage = {
      kind: 'matchPiece',
      id: task.id,
      jobId: job.id,
      index: task.index,
      ...(sent ? {} : { job }),
    }
    slot.worker.postMessage(message)
  }

  function startWorker() {
    const slot: Slot = { worker: start(), state: 'starting', jobs: new Set() }
    slots.push(slot)
    slot.worker.onmessage = ({ data }: MessageEvent<MatchReply>) => heard(slot, data)
    slot.worker.onerror = (event) => {
      event.preventDefault()
      broke(slot)
    }
    const compiled = (modules ??= compile())
    compiled.then(
      (posted) => {
        if (slots.includes(slot)) slot.worker.postMessage({ kind: 'matchStart', ...posted } satisfies MatchMessage)
      },
      () => {
        if (modules === compiled) modules = undefined
        if (slots.includes(slot)) startFailed(slot)
      },
    )
  }

  function heard(slot: Slot, reply: MatchReply) {
    if (!slots.includes(slot)) return
    if (reply.kind === 'matchReady') {
      startFails = 0
      slot.state = 'idle'
      return fill()
    }
    if (reply.kind === 'matchStartFailed') return startFailed(slot)
    if (reply.kind === 'matchBroken') return broke(slot)
    const task = slot.task
    if (task?.id !== reply.id) return
    if (reply.kind === 'matchStep') return task.job.listener.step(task.index, reply.step)
    slot.task = undefined
    slot.state = 'idle'
    if (reply.heap > HEAP_LIMIT) end(slot)
    answered(task, reply.answer)
    fill()
  }

  function answered(task: Task, answer: MatchAnswer) {
    const pooled = task.job
    if (jobs.get(pooled.job.id) !== pooled) return
    pooled.left.delete(task.index)
    if (pooled.left.size === 0) ended(pooled)
    pooled.listener.answer(task.index, answer)
  }

  /** A job all answered or cancelled: the workers sent it forget it. */
  function ended(pooled: PooledJob) {
    jobs.delete(pooled.job.id)
    for (const slot of slots)
      if (slot.jobs.delete(pooled.job.id))
        slot.worker.postMessage({ kind: 'matchForget', jobId: pooled.job.id } satisfies MatchMessage)
  }

  /** A worker that crashed or ran out of memory: ended, its piece queued again, and the pool one smaller. */
  function broke(slot: Slot) {
    if (slot.state === 'starting') return startFailed(slot)
    const task = slot.task
    end(slot)
    if (task && jobs.get(task.job.job.id) === task.job) queue.unshift(task)
    if (limit() > 1) dropped++
    else if (++failsAtOne >= FAILS_AT_ONE) return failAll('failed')
    fill()
  }

  function startFailed(slot: Slot) {
    end(slot)
    if (++startFails < START_FAILS) return fill()
    unsupported = true
    failAll('unsupported')
  }

  /** Ends every worker and answers every piece left a picture, for `why`. */
  function failAll(why: PictureWhy) {
    failsAtOne = 0
    for (const slot of [...slots]) end(slot)
    queue.length = 0
    for (const pooled of [...jobs.values()]) {
      jobs.delete(pooled.job.id)
      for (const index of [...pooled.left].sort((a, b) => a - b))
        pooled.listener.answer(index, { kind: 'picture', why })
    }
  }

  function end(slot: Slot) {
    const at = slots.indexOf(slot)
    if (at < 0) return
    slots.splice(at, 1)
    clearTimeout(slot.idle)
    slot.worker.terminate()
    if (slots.length === 0) modules = undefined
  }

  /** Hidden or left, every worker ends at once and its piece waits for the page to be shown again. */
  function shownChanged() {
    if (!page.hidden()) return fill()
    const matching: Task[] = []
    for (const slot of [...slots]) {
      if (slot.task && jobs.get(slot.task.job.job.id) === slot.task.job) matching.push(slot.task)
      end(slot)
    }
    queue.unshift(...matching.sort((a, b) => a.id - b.id))
  }

  return {
    add(job, indexes, listener) {
      if (unsupported) {
        for (const index of indexes) listener.answer(index, { kind: 'picture', why: 'unsupported' })
        return
      }
      if (indexes.length === 0) return
      const pooled: PooledJob = { job, listener, left: new Set(indexes) }
      jobs.set(job.id, pooled)
      for (const index of indexes) queue.push({ id: nextTask++, job: pooled, index })
      fill()
    },
    cancel(jobId) {
      const pooled = jobs.get(jobId)
      if (!pooled) return
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i]?.job === pooled) queue.splice(i, 1)
      // A worker still starting with nothing left to match is not needed either.
      for (const slot of [...slots])
        if (slot.task?.job === pooled || (slot.state === 'starting' && queue.length === 0)) end(slot)
      ended(pooled)
      fill()
    },
    get unsupported() {
      return unsupported
    },
    destroy() {
      stopListening()
      for (const slot of [...slots]) end(slot)
      queue.length = 0
      jobs.clear()
    },
  }
}
