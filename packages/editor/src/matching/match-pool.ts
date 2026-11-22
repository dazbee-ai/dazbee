// The pool of matcher workers, sized to the device. A worker matches one kind of piece: a text worker
// holds CanvasKit, ONNX Runtime and the text matcher's model, a shape worker CanvasKit only. The pool
// holds nothing until the first piece comes: then it starts workers one at a time, each of the kind
// of a piece waiting, once the one before has started and pieces still wait, up to the most the
// device's cores allow, always leaving a core to the page, and within one memory budget at each
// worker's peak. Each piece goes to the next free worker of its kind; an idle worker of another kind
// is ended when the budget has no room for a worker a waiting piece needs. CanvasKit's and ONNX
// Runtime's WebAssembly are compiled once on the page, each only when a worker needs it, and posted to
// each worker that does. A worker is ended 15 s after it has nothing to do, 2 s once no job is left,
// and at once when the tab is hidden or the page is left; a compiled module goes with the last worker
// needing it. A worker past its share of the memory budget after a piece is retired, and a fresh one
// from the same compiled modules takes the next piece, so a long run stays within the budget. A worker
// that crashes is ended, its piece goes back on the queue and the pool shrinks by one; when a single
// worker fails twice, the pieces left stay pictures.
import type { ShapeStep, TextStep } from '@dazbee/matchers'
import type { FontFamily, MatchAnswer, MatchJob, PictureWhy, PieceKind } from '@dazbee/schema'

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

/** A WebAssembly module the matcher workers are posted. */
export type MatcherModule = keyof CompiledModules

/** A step of a piece's matching, the text matcher's or the shape matcher's. */
export type MatchStep = TextStep | ShapeStep

/**
 * What the pool tells a worker: to start as a text worker, with both modules, or as a shape worker,
 * with CanvasKit's only; to match a job's piece; and to forget a job that ended.
 */
export type MatchMessage =
  | ({ kind: 'matchStart'; matcher: 'text' } & CompiledModules)
  | ({ kind: 'matchStart'; matcher: 'shape' } & Pick<CompiledModules, 'canvasKit'>)
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
  | { kind: 'matchStep'; id: number; step: MatchStep }
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
  step(index: number, step: MatchStep): void
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

/** One piece to match, and its kind. */
interface Task {
  id: number
  job: PooledJob
  index: number
  kind: PieceKind
}

/**
 * A worker of a kind: starting, idle (with the timer that ends it) or matching a piece; the jobs it
 * was sent, and how many pieces it has matched.
 */
interface Slot {
  worker: MatchWorker
  kind: PieceKind
  state: 'starting' | 'idle' | 'busy'
  task?: Task | undefined
  idle?: ReturnType<typeof setTimeout> | undefined
  jobs: Set<number>
  pieces: number
}

const MB = 2 ** 20
const GB = 2 ** 30

/**
 * How each kind of worker is counted against the budget, since Chrome reports no worker's own memory:
 * its peak, its share of the budget, past which a piece leaves it retired; what a started worker holds
 * that it doesn't count in its answers; and what a piece leaves in it beyond what it counts, until it
 * is collected.
 */
export const WORKER_MEMORY: Record<PieceKind, { peak: number; rest: number; piece: number }> = {
  /**
   * Over the 48 test ads in three text workers, Chrome's renderer process grew by 1,528 MB (509 MB a
   * worker) with none retired, and by 1,323 MB (441 MB a worker) retiring each past its peak. Three
   * fresh workers grew it by 324 MB each, 186 MB of it their WebAssembly memories; the rest is their
   * JavaScript, the matcher's files and the model's bytes, and their share of the compiled code. A
   * piece grew it by 2.7 MB, of which one worker read 1.1 MB of faces.
   */
  text: { peak: 448 * MB, rest: 144 * MB, piece: 2 * MB },
  /**
   * A fresh shape worker matching one piece grew Chrome's renderer process by 200 MB, 128 MB of it
   * CanvasKit's memory. Over the 72 held-out shape pieces, six workers at once grew it by 1,914 MB
   * (319 MB a worker), and the four this peak allows by 1,407 MB; one worker matching them twice over
   * held between 400 and 620 MB, without growing from piece to piece: a shape worker's memory is the
   * pictures of the piece in hand.
   */
  shape: { peak: 352 * MB, rest: 72 * MB, piece: 1 * MB },
}
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
  /** Compiles a module the workers are posted, once while a worker needing it lives or one is replaced. */
  compile: (module: MatcherModule) => Promise<WebAssembly.Module>
  page: PageShown
}): MatchPool {
  /** The pool's memory budget. */
  const budget = memoryBudget(device)
  /** How many workers crashes took off the most of each kind. */
  let dropped = 0
  /** The failures in a row of a pool down to one worker. */
  let failsAtOne = 0
  /** The workers in a row that failed to start. */
  let startFails = 0
  /** Whether workers failed to start twice, so this browser can't run the matchers. */
  let unsupported = false
  /** The compiled modules, compiling or compiled, each while a worker needing it lives. */
  const modules = new Map<MatcherModule, Promise<WebAssembly.Module>>()
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

  /** The most workers of a kind now: the device's, less one for each that crashed, at least 1. */
  const limit = (kind: PieceKind) => Math.max(1, poolLimit(device, kind) - dropped)

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
    for (const index of indexes)
      queue.push({ id: nextTask++, job: pooled, index, kind: job.job.pieces[index]?.kind ?? 'text' })
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

  /**
   * Gives waiting pieces to idle workers of their kind, starts one more while pieces wait, and times
   * the idle ones out.
   */
  function fill() {
    if (page.hidden()) return
    for (const slot of slots) {
      if (slot.state !== 'idle') continue
      const at = queue.findIndex((task) => task.kind === slot.kind)
      const task = queue[at]
      if (!task) continue
      queue.splice(at, 1)
      give(slot, task)
    }
    if (!slots.some((slot) => slot.state === 'starting')) startNeeded()
    const kept = jobs.size > 0 ? IDLE_MS : DONE_MS
    for (const slot of slots) if (slot.state === 'idle' && !slot.idle) slot.idle = setTimeout(() => end(slot), kept)
  }

  /**
   * Starts a worker of the kind of the first piece waiting that one has room for. When none has, an
   * idle worker of another kind is ended to make room for the first piece's kind.
   */
  function startNeeded() {
    const waiting = [...new Set(queue.map((task) => task.kind))]
    const kind = waiting.find(hasRoom)
    if (kind) return startWorker(kind)
    const first = waiting[0]
    const idle = first && slots.find((slot) => slot.state === 'idle' && slot.kind !== first)
    if (!first || !idle) return
    end(idle)
    if (hasRoom(first)) startWorker(first)
  }

  /** Whether a worker of a kind may start: the first one always, else within its most and the memory budget. */
  function hasRoom(kind: PieceKind): boolean {
    if (slots.length === 0) return true
    const held = slots.reduce((sum, slot) => sum + WORKER_MEMORY[slot.kind].peak, 0)
    return slots.length < limit(kind) && held + WORKER_MEMORY[kind].peak <= budget
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

  function startWorker(kind: PieceKind) {
    const slot: Slot = { worker: start(), kind, state: 'starting', jobs: new Set(), pieces: 0 }
    slots.push(slot)
    slot.worker.onmessage = ({ data }: MessageEvent<MatchReply>) => heard(slot, data)
    slot.worker.onerror = (event) => {
      event.preventDefault()
      broke(slot)
    }
    const canvasKit = compiled('canvasKit')
    const started =
      kind === 'text'
        ? Promise.all([canvasKit, compiled('onnxRuntime')]).then(([ck, onnxRuntime]): MatchMessage => ({
            kind: 'matchStart',
            matcher: 'text',
            canvasKit: ck,
            onnxRuntime,
          }))
        : canvasKit.then((ck): MatchMessage => ({ kind: 'matchStart', matcher: 'shape', canvasKit: ck }))
    started.then(
      (message) => {
        if (slots.includes(slot)) slot.worker.postMessage(message)
      },
      () => {
        if (slots.includes(slot)) broke(slot)
      },
    )
  }

  /** The module, compiling or compiled, compiled now if no worker holds it; one that fails is compiled again next time. */
  function compiled(name: MatcherModule): Promise<WebAssembly.Module> {
    const kept = modules.get(name)
    if (kept) return kept
    const compiling = compile(name)
    modules.set(name, compiling)
    compiling.catch(() => {
      if (modules.get(name) === compiling) modules.delete(name)
    })
    return compiling
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
    const { peak, rest, piece } = WORKER_MEMORY[slot.kind]
    if (reply.memory + rest + slot.pieces * piece > peak) end(slot, true)
    answered(task, reply.answer)
    fill()
    releaseModules()
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
    if (limit(slot.kind) > 1) dropped++
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

  /** Ends the worker; a compiled module goes with the last worker needing it, unless it ends for a replacement. */
  function end(slot: Slot, replaced = false) {
    const at = slots.indexOf(slot)
    if (at < 0) return
    slots.splice(at, 1)
    clearTimeout(slot.idle)
    slot.worker.terminate()
    if (!replaced) releaseModules()
  }

  /** Lets go of each compiled module no worker left is posted. */
  function releaseModules() {
    for (const name of [...modules.keys()]) if (!slots.some((slot) => postedTo(slot.kind, name))) modules.delete(name)
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

/** Whether a worker of a kind is posted the module: every worker CanvasKit, a text worker ONNX Runtime too. */
function postedTo(kind: PieceKind, name: MatcherModule): boolean {
  return name === 'canvasKit' || kind === 'text'
}

/**
 * The most workers of a kind the device takes: its cores but one, and as many as its memory budget
 * holds at that kind's peak each; at least 1.
 */
export function poolLimit(device: Device, kind: PieceKind): number {
  return Math.max(1, Math.min(device.cores - 1, Math.floor(memoryBudget(device) / WORKER_MEMORY[kind].peak)))
}

/** The pool's memory budget: a quarter of the device's memory, at most 1.5 GB; 256 MB when the browser doesn't say. */
function memoryBudget({ memoryGb }: Device): number {
  return memoryGb === undefined ? UNKNOWN_MEMORY : Math.min(memoryGb * GB * MEMORY_SHARE, MOST_MEMORY)
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
