// The pool of matcher workers, sized to the device. It holds nothing until
// the first piece comes: then it starts workers one at a time, each once the one before has started
// and pieces still wait, up to the most the device's cores and memory allow, always leaving a core
// to the page. CanvasKit's and ONNX Runtime's WebAssembly are compiled once on the page and posted
// to each worker. A worker is ended 15 s after it has nothing to do, 2 s once no job is left, and at
// once when the tab is hidden or the page is left; the compiled modules go with the last one. A
// worker past its share of the memory budget after a piece is retired, and a fresh one from the same
// compiled modules takes the next piece, so a long run stays within the budget. A worker that crashes is ended, its piece
// goes back on the queue and the pool shrinks by one; when a single worker fails twice, the pieces
// left stay pictures.
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
 * What a worker answers: it started or couldn't, a piece's step began, a piece's answer with the
 * bytes it holds after it (its WebAssembly memories and the faces it has read), or a piece broke the
 * worker (it ran out of memory), which then is ended.
 */
export type MatchReply =
  | { kind: 'matchReady' }
  | { kind: 'matchStartFailed'; message: string }
  | { kind: 'matchStep'; id: number; step: TextStep }
  | { kind: 'matchAnswer'; id: number; answer: MatchAnswer; memory: number }
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

/** A job in the pool: who hears it, and its pieces not yet answered. */
interface PooledJob {
  job: WorkerJob
  listener: PoolListener
  unanswered: Set<number>
}

/** One piece to match. */
interface Task {
  id: number
  job: PooledJob
  index: number
}

/**
 * A worker: starting, idle (with the timer that ends it) or matching a piece; the jobs it was sent,
 * and how many pieces it has matched.
 */
interface Slot {
  worker: MatchWorker
  state: 'starting' | 'idle' | 'busy'
  task?: Task | undefined
  idle?: ReturnType<typeof setTimeout> | undefined
  jobs: Set<number>
  pieces: number
}

const MB = 2 ** 20
const GB = 2 ** 30

/**
 * A text worker's peak memory, its share of the budget: a worker is retired once a piece leaves it
 * past this. Chrome's renderer process grew by 1,330 MB matching the 48 test ads in three workers.
 */
export const TEXT_WORKER_PEAK = 448 * MB
/**
 * What a started text worker holds that it doesn't count in its answers: its JavaScript, the matcher's
 * files and the model's bytes, its share of the compiled code. Three fresh workers grew Chrome's
 * renderer process by 324 MB each, 186 MB of it their WebAssembly memories.
 */
export const WORKER_REST = 144 * MB
/**
 * What a piece leaves in a worker beyond the faces it read, until it is collected, since Chrome
 * reports no worker's own memory: over the 48 test ads, three workers grew Chrome's renderer process
 * by 2.7 MB a piece, and one worker read 1.1 MB of faces a piece.
 */
export const PIECE_REST = 2 * MB
/** How long a worker with nothing to do is kept, while a job is still being matched, for a piece that may come. */
export const IDLE_MS = 15_000
/** How long a worker is kept once no job is left, for a job that follows at once. */
export const DONE_MS = 2_000

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

export function matchPool({
  start,
  device,
  compile,
  page,
}: {
  /** Starts a worker. */
  start: () => MatchWorker
  device: Device
  /** Compiles the modules each worker is posted, once while any worker lives or one is replaced. */
  compile: () => Promise<CompiledModules>
  page: PageShown
}): MatchPool {
  /** The most workers the device takes. */
  const most = poolLimit(device)
  /** How many workers crashes took off `most`. */
  let dropped = 0
  /** The failures in a row of a pool down to one worker. */
  let failsAtOne = 0
  /** The workers in a row that failed to start. */
  let startFails = 0
  /** Whether workers failed to start twice, so this browser can't run the matchers. */
  let unsupported = false
  /** The compiled modules, compiling or compiled, while any worker lives. */
  let modules: Promise<CompiledModules> | undefined
  /** The next piece's id. */
  let nextTask = 0
  /** The pieces waiting for a worker, the first next. */
  const queue: Task[] = []
  /** The workers, starting, idle or matching. */
  const slots: Slot[] = []
  /** The jobs not all answered, by id. */
  const jobs = new Map<number, PooledJob>()
  /** Stops hearing whether the page is hidden. */
  const stopListening = page.onChange(shownChanged)

  /** The most workers now: the device's, less one for each that crashed, at least 1. */
  const limit = () => Math.max(1, most - dropped)

  /** Whether the task's job is still in the pool. */
  const waitedFor = (task: Task | undefined): task is Task => !!task && jobs.get(task.job.job.id) === task.job

  function add(job: WorkerJob, indexes: readonly number[], listener: PoolListener) {
    if (unsupported) {
      for (const index of indexes) listener.answer(index, { kind: 'picture', why: 'unsupported' })
      return
    }
    if (indexes.length === 0) return
    const pooled: PooledJob = { job, listener, unanswered: new Set(indexes) }
    jobs.set(job.id, pooled)
    for (const index of indexes) queue.push({ id: nextTask++, job: pooled, index })
    fill()
  }

  function cancel(jobId: number) {
    const pooled = jobs.get(jobId)
    if (!pooled) return
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i]?.job === pooled) queue.splice(i, 1)
    // A worker still starting with nothing left to match is not needed either.
    for (const slot of [...slots])
      if (slot.task?.job === pooled || (slot.state === 'starting' && queue.length === 0)) end(slot)
    ended(pooled)
    fill()
  }

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
    const kept = jobs.size > 0 ? IDLE_MS : DONE_MS
    for (const slot of slots) if (slot.state === 'idle' && !slot.idle) slot.idle = setTimeout(() => end(slot), kept)
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
    const slot: Slot = { worker: start(), state: 'starting', jobs: new Set(), pieces: 0 }
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
        if (slots.includes(slot)) broke(slot)
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
    if (reply.kind === 'matchStartFailed' || reply.kind === 'matchBroken') return broke(slot)
    const task = slot.task
    if (task?.id !== reply.id) return
    if (reply.kind === 'matchStep') return task.job.listener.step(task.index, reply.step)
    slot.task = undefined
    slot.state = 'idle'
    failsAtOne = 0
    slot.pieces++
    // Past its share, the worker is retired, and the compiled modules kept for the replacement `fill` starts.
    if (reply.memory + WORKER_REST + slot.pieces * PIECE_REST > TEXT_WORKER_PEAK) end(slot, true)
    answered(task, reply.answer)
    fill()
    if (slots.length === 0) modules = undefined
  }

  function answered(task: Task, answer: MatchAnswer) {
    if (!waitedFor(task)) return
    const pooled = task.job
    pooled.unanswered.delete(task.index)
    if (pooled.unanswered.size === 0) ended(pooled)
    pooled.listener.answer(task.index, answer)
  }

  /**
   * A job all answered or cancelled: the workers sent it forget it, and once no job is left, the idle
   * ones are timed again to end sooner.
   */
  function ended(pooled: PooledJob) {
    jobs.delete(pooled.job.id)
    for (const slot of slots) {
      if (slot.jobs.delete(pooled.job.id))
        slot.worker.postMessage({ kind: 'matchForget', jobId: pooled.job.id } satisfies MatchMessage)
      if (jobs.size === 0) {
        clearTimeout(slot.idle)
        slot.idle = undefined
      }
    }
  }

  /**
   * A worker that failed: one starting counts toward this browser being unable; one matching (it
   * crashed or ran out of memory) is ended, its piece queued again, and the pool one smaller.
   */
  function broke(slot: Slot) {
    const { state, task } = slot
    end(slot)
    if (state === 'starting') {
      if (++startFails < START_FAILS) return fill()
      unsupported = true
      return failAll('unsupported')
    }
    if (waitedFor(task)) queue.unshift(task)
    if (limit() > 1) dropped++
    else if (++failsAtOne >= FAILS_AT_ONE) return failAll('failed')
    fill()
  }

  /** Ends every worker and answers every piece left a picture, for `why`. */
  function failAll(why: PictureWhy) {
    failsAtOne = 0
    for (const slot of [...slots]) end(slot)
    queue.length = 0
    for (const pooled of [...jobs.values()]) {
      jobs.delete(pooled.job.id)
      for (const index of [...pooled.unanswered].sort((a, b) => a - b))
        pooled.listener.answer(index, { kind: 'picture', why })
    }
  }

  /** Ends the worker; the compiled modules go with the last one, unless it ends for a replacement. */
  function end(slot: Slot, replaced = false) {
    const at = slots.indexOf(slot)
    if (at < 0) return
    slots.splice(at, 1)
    clearTimeout(slot.idle)
    slot.worker.terminate()
    if (slots.length === 0 && !replaced) modules = undefined
  }

  /** Hidden or left, every worker ends at once and its piece waits for the page to be shown again. */
  function shownChanged() {
    if (!page.hidden()) return fill()
    const matching: Task[] = []
    for (const slot of [...slots]) {
      if (waitedFor(slot.task)) matching.push(slot.task)
      end(slot)
    }
    queue.unshift(...matching.sort((a, b) => a.id - b.id))
  }

  /** Stops listening to the page and ends every worker; every piece left stays a picture, `failed`. */
  function destroy() {
    stopListening()
    failAll('failed')
  }

  return {
    add,
    cancel,
    get unsupported() {
      return unsupported
    },
    destroy,
  }
}

/**
 * The most workers the device takes: its cores but one, and as many as its memory budget holds at
 * a text worker's peak each (a quarter of its memory, at most 1.5 GB; 256 MB when the browser doesn't say); at least 1.
 */
export function poolLimit({ cores, memoryGb }: Device): number {
  const budget = memoryGb === undefined ? UNKNOWN_MEMORY : Math.min(memoryGb * GB * MEMORY_SHARE, MOST_MEMORY)
  return Math.max(1, Math.min(cores - 1, Math.floor(budget / TEXT_WORKER_PEAK)))
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
