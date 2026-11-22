import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MatchAnswer, MatchJob, PieceKind } from '@dazbee/schema'

import {
  type Device,
  DONE_MS,
  IDLE_MS,
  type MatcherModule,
  type MatchMessage,
  matchPool,
  type MatchReply,
  type MatchWorker,
  poolLimit,
  WORKER_MEMORY,
} from './match-pool.ts'

/** The answer the stand-in workers give. */
const TEXT: MatchAnswer = { kind: 'picture', why: 'looksDifferent' }
/** The most a text worker may say it holds after its `pieces`-th piece and stay within its share. */
const share = (pieces: number) => WORKER_MEMORY.text.peak - WORKER_MEMORY.text.rest - pieces * WORKER_MEMORY.text.piece
/** What a fresh worker says it holds: CanvasKit's and ONNX Runtime's memories. */
const FRESH = 186 * 2 ** 20

/** A stand-in worker: it keeps what it is posted and answers when told. */
class FakeWorker implements MatchWorker {
  posted: MatchMessage[] = []
  terminated = false
  onmessage: Worker['onmessage'] = null
  onerror: Worker['onerror'] = null
  postMessage(message: MatchMessage) {
    this.posted.push(message)
  }
  terminate() {
    this.terminated = true
  }
  reply(data: MatchReply) {
    this.onmessage?.call(this as unknown as Worker, { data } as MessageEvent)
  }
  crash() {
    this.onerror?.call(this as unknown as Worker, { message: 'out of memory', preventDefault() {} } as ErrorEvent)
  }
  /** The kind of matcher it was started as, once it was. */
  matcher() {
    return this.posted.flatMap((message) => (message.kind === 'matchStart' ? [message.matcher] : []))[0]
  }
  /** The pieces posted to it, by task id. */
  pieces() {
    return this.posted.flatMap((message) => (message.kind === 'matchPiece' ? [message] : []))
  }
  /** Answers its last piece with `answer`, saying it holds `memory`. */
  answerLast(answer: MatchAnswer = TEXT, memory = FRESH) {
    const piece = this.pieces().at(-1)
    if (!piece) throw new Error('no piece was posted')
    this.reply({ kind: 'matchAnswer', id: piece.id, answer, memory })
  }
}

const LAPTOP: Device = { cores: 4, memoryGb: 8 }
const PHONE: Device = { cores: 4, memoryGb: 2 }
/** A device of many cores whose budget is the most, 1.5 GB. */
const WORKSTATION: Device = { cores: 16, memoryGb: 16 }
const BUDGET = 1.5 * 2 ** 30
const rect = { x: 0, y: 0, width: 1, height: 1 }
const job = (pieces: number, kind: PieceKind = 'text') =>
  ({
    picture: '',
    pieces: Array.from({ length: pieces }, () => (kind === 'text' ? { kind, rect, words: 'A' } : { kind, rect })),
    kit: { colors: {}, fonts: {}, textStyles: [] },
    setting: 'hybrid',
  }) as MatchJob
const fonts = { catalog: [], uploadPath: '/fonts/' }
const range = (count: number) => Array.from({ length: count }, (_, i) => i)

/** A pool on a stand-in device and page, its workers, the answers it gave and the compiles it asked for. */
function pool(device: Device) {
  const made: FakeWorker[] = []
  const answers = new Map<number, MatchAnswer>()
  let hidden = false
  let shownChanged = () => {}
  const compile = vi.fn((module: MatcherModule) => Promise.resolve({ module } as unknown as WebAssembly.Module))
  const matcher = matchPool({
    start: () => {
      const worker = new FakeWorker()
      made.push(worker)
      return worker
    },
    device,
    compile,
    page: {
      hidden: () => hidden,
      onChange(listener) {
        shownChanged = listener
        return () => {}
      },
    },
  })
  /** Adds a job of `pieces` pieces of a kind; its answers are kept under `answers`, or a map of its own. */
  const add = (pieces: number, id = 0, kind: PieceKind = 'text', kept = answers) =>
    matcher.add({ id, job: job(pieces, kind), fonts }, range(pieces), {
      step: () => {},
      answer: (index, answer) => kept.set(index, answer),
    })
  /** The workers not ended. */
  const alive = () => made.filter((worker) => !worker.terminated)
  /** The modules compiled, in order. */
  const compiled = () => compile.mock.calls.map(([module]) => module)
  /** Lets the compile resolve, then the newest worker answer that it started. */
  const startNewest = async () => {
    await vi.advanceTimersByTimeAsync(0)
    made.at(-1)?.reply({ kind: 'matchReady' })
  }
  const setHidden = (value: boolean) => {
    hidden = value
    shownChanged()
  }
  return { matcher, made, answers, compile, compiled, add, alive, startNewest, setHidden }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('poolLimit', () => {
  it('leaves a core to the page and keeps within a quarter of the memory, at most 1.5 GB', () => {
    expect(poolLimit(LAPTOP, 'text')).toBe(3)
    expect(poolLimit({ cores: 16, memoryGb: 8 }, 'text')).toBe(3)
    expect(poolLimit(PHONE, 'text')).toBe(1)
  })

  it('takes 256 MB, so one worker, when the browser doesn’t say its memory, and one worker on one core', () => {
    expect(poolLimit({ cores: 8 }, 'text')).toBe(1)
    expect(poolLimit({ cores: 1, memoryGb: 8 }, 'text')).toBe(1)
  })

  it('holds more shape workers than text workers, a shape worker’s peak being smaller', () => {
    expect(WORKER_MEMORY.shape.peak).toBeLessThan(WORKER_MEMORY.text.peak)
    expect(poolLimit(WORKSTATION, 'shape')).toBe(Math.floor(BUDGET / WORKER_MEMORY.shape.peak))
    expect(poolLimit(WORKSTATION, 'shape')).toBeGreaterThan(poolLimit(WORKSTATION, 'text'))
  })
})

describe('matchPool', () => {
  it('loads nothing before the first job, and starts one worker for a one-piece job', async () => {
    const { made, compile, add, startNewest, answers, alive } = pool(LAPTOP)
    expect(made).toHaveLength(0)
    expect(compile).not.toHaveBeenCalled()
    add(1)
    await startNewest()
    expect(made).toHaveLength(1)
    expect(made[0]?.posted.map((message) => message.kind)).toEqual(['matchStart', 'matchPiece'])
    made[0]?.answerLast()
    expect(answers.get(0)).toEqual(TEXT)
    expect(alive()).toHaveLength(1)
  })

  it.each([
    ['a 4-core, 8 GB device', LAPTOP, 3],
    ['a 2 GB device', PHONE, 1],
  ])('starts ten pieces on %s in %i workers, one at a time', async (_, device, workers) => {
    const { made, add, startNewest } = pool(device)
    add(10)
    for (let started = 1; started <= workers; started++) {
      await vi.advanceTimersByTimeAsync(0)
      // The next starts only once this one has.
      expect(made).toHaveLength(started)
      await startNewest()
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(made).toHaveLength(workers)
    expect(made.map((worker) => worker.pieces().length)).toEqual(Array(workers).fill(1))
  })

  it('compiles once for every worker, and leaves no worker and nothing compiled 2 s after the last job', async () => {
    const { made, compiled, add, startNewest, alive, answers } = pool(LAPTOP)
    add(2)
    await startNewest()
    await startNewest()
    expect(compiled()).toEqual(['canvasKit', 'onnxRuntime'])
    for (const worker of made) worker.answerLast()
    expect(answers.size).toBe(2)
    await vi.advanceTimersByTimeAsync(DONE_MS - 1)
    expect(alive()).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(alive()).toHaveLength(0)
    add(1, 1)
    await startNewest()
    expect(compiled()).toEqual(['canvasKit', 'onnxRuntime', 'canvasKit', 'onnxRuntime'])
  })

  it('keeps a worker with nothing to do 15 s while a job is still matched, so the next job reuses it', async () => {
    const { made, add, startNewest, alive } = pool(LAPTOP)
    add(2)
    await startNewest()
    await startNewest()
    made[0]?.answerLast()
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1)
    expect(alive()).toHaveLength(2)
    add(1, 1)
    expect(made[0]?.pieces().map((piece) => piece.jobId)).toEqual([0, 1])
    made[1]?.answerLast()
    made[0]?.answerLast()
    await vi.advanceTimersByTimeAsync(DONE_MS)
    expect(alive()).toHaveLength(0)
    expect(made).toHaveLength(2)
  })

  it('tells a worker a job once, and to forget it once the job ends', async () => {
    const { made, add, startNewest } = pool(PHONE)
    add(2)
    await startNewest()
    made[0]?.answerLast()
    made[0]?.answerLast()
    const pieces = made[0]?.pieces() ?? []
    expect(pieces.map((piece) => piece.job !== undefined)).toEqual([true, false])
    expect(made[0]?.posted.at(-1)).toEqual({ kind: 'matchForget', jobId: 0 })
  })

  it('ends every worker at once when the tab is hidden, and matches their pieces once it is shown', async () => {
    const { made, add, startNewest, alive, setHidden } = pool(LAPTOP)
    add(2)
    await startNewest()
    await startNewest()
    setHidden(true)
    expect(alive()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(0)
    expect(made).toHaveLength(2)
    setHidden(false)
    await startNewest()
    expect(made[2]?.pieces().map((piece) => piece.index)).toEqual([0])
  })

  it('retires a worker whose piece left it past its share, and a fresh one from the same modules takes the next', async () => {
    const { made, add, startNewest, answers, compile } = pool(PHONE)
    add(3)
    await startNewest()
    made[0]?.answerLast(TEXT, share(1))
    expect(made[0]?.terminated).toBe(false)
    expect(made[0]?.pieces()).toHaveLength(2)
    made[0]?.answerLast(TEXT, share(2) + 1)
    expect(answers.get(1)).toEqual(TEXT)
    expect(made[0]?.terminated).toBe(true)
    await startNewest()
    expect(made[1]?.pieces().map((piece) => piece.index)).toEqual([2])
    expect(compile).toHaveBeenCalledTimes(2)
  })

  it('never runs more workers than the budget holds while it retires them over a long run', async () => {
    const { made, add, answers, alive } = pool(LAPTOP)
    add(30)
    let most = 0
    for (let round = 0; round < 100 && answers.size < 30; round++) {
      await vi.advanceTimersByTimeAsync(0)
      // A worker still starting says it started; each matching one answers, holding more for later pieces.
      for (const worker of alive()) {
        const piece = worker.pieces().at(-1)
        if (worker.posted.length === 1) worker.reply({ kind: 'matchReady' })
        else if (piece && !answers.has(piece.index)) worker.answerLast(TEXT, FRESH + piece.index * 30 * 2 ** 20)
        most = Math.max(most, alive().length)
      }
    }
    expect(answers.size).toBe(30)
    expect(most).toBe(poolLimit(LAPTOP, 'text'))
    expect(made.length).toBeGreaterThan(poolLimit(LAPTOP, 'text'))
  })

  it('lets the compiled modules go with a worker retired when nothing waits', async () => {
    const { made, add, startNewest, compile, alive } = pool(PHONE)
    add(1)
    await startNewest()
    made[0]?.answerLast(TEXT, share(1) + 1)
    expect(alive()).toHaveLength(0)
    add(1, 1)
    await startNewest()
    expect(compile).toHaveBeenCalledTimes(4)
  })

  it('spreads a picture’s many shape pieces over more shape workers than text workers would be, each posted CanvasKit alone', async () => {
    const { made, add, startNewest, compiled } = pool(WORKSTATION)
    add(20, 0, 'shape')
    const most = poolLimit(WORKSTATION, 'shape')
    for (let started = 1; started <= most; started++) {
      await vi.advanceTimersByTimeAsync(0)
      // The next starts only once this one has.
      expect(made).toHaveLength(started)
      await startNewest()
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(made).toHaveLength(most)
    expect(most).toBeGreaterThan(poolLimit(WORKSTATION, 'text'))
    expect(made.map((worker) => worker.matcher())).toEqual(Array(most).fill('shape'))
    expect(made.map((worker) => worker.pieces().length)).toEqual(Array(most).fill(1))
    expect(made[0]?.posted[0]).toEqual({ kind: 'matchStart', matcher: 'shape', canvasKit: { module: 'canvasKit' } })
    expect(compiled()).toEqual(['canvasKit'])
  })

  it('runs a text job and a shape job at once within one budget, each piece on a worker of its kind, and keeps nothing once both end', async () => {
    const { add, alive, made, compiled, startNewest } = pool(WORKSTATION)
    const text = new Map<number, MatchAnswer>()
    const shapes = new Map<number, MatchAnswer>()
    add(2, 0, 'text', text)
    add(12, 1, 'shape', shapes)
    const answered = new Set<number>()
    let most = { text: 0, shape: 0 }
    for (let round = 0; round < 100 && text.size + shapes.size < 14; round++) {
      await vi.advanceTimersByTimeAsync(0)
      const held = alive().reduce((sum, worker) => sum + WORKER_MEMORY[worker.matcher() ?? 'text'].peak, 0)
      expect(held).toBeLessThanOrEqual(BUDGET)
      const count = (kind: PieceKind) => alive().filter((worker) => worker.matcher() === kind).length
      most = { text: Math.max(most.text, count('text')), shape: Math.max(most.shape, count('shape')) }
      for (const worker of alive()) {
        const piece = worker.pieces().at(-1)
        if (worker.posted.length === 1) worker.reply({ kind: 'matchReady' })
        else if (piece && !answered.has(piece.id)) {
          expect(worker.matcher()).toBe(piece.jobId === 0 ? 'text' : 'shape')
          answered.add(piece.id)
          worker.answerLast()
        }
      }
    }
    expect([text.size, shapes.size]).toEqual([2, 12])
    // Both text pieces were matched at once, beside more than one shape worker.
    expect(most.text).toBe(2)
    expect(most.shape).toBeGreaterThan(1)
    await vi.advanceTimersByTimeAsync(DONE_MS)
    expect(alive()).toHaveLength(0)
    const before = compiled().length
    add(1, 2, 'shape')
    await startNewest()
    expect(compiled().slice(before)).toEqual(['canvasKit'])
    expect(made.at(-1)?.matcher()).toBe('shape')
  })

  it('lets go of ONNX Runtime’s module with the last text worker while a shape worker keeps CanvasKit’s', async () => {
    const { made, add, startNewest, compiled } = pool(LAPTOP)
    add(1, 0, 'text')
    await startNewest()
    add(1, 1, 'shape')
    await startNewest()
    expect(made.map((worker) => worker.matcher())).toEqual(['text', 'shape'])
    made[0]?.answerLast()
    await vi.advanceTimersByTimeAsync(IDLE_MS)
    expect(made[0]?.terminated).toBe(true)
    add(1, 2, 'text')
    await startNewest()
    expect(compiled()).toEqual(['canvasKit', 'onnxRuntime', 'onnxRuntime'])
  })

  it('ends an idle worker of another kind when the budget has no room for the kind a piece waits for', async () => {
    const { made, add, startNewest, alive } = pool(PHONE)
    add(1, 0, 'text')
    await startNewest()
    made[0]?.answerLast()
    add(1, 1, 'shape')
    expect(made[0]?.terminated).toBe(true)
    await startNewest()
    expect(alive().map((worker) => worker.matcher())).toEqual(['shape'])
    expect(made[1]?.pieces().map((piece) => piece.jobId)).toEqual([1])
  })

  it('puts a crashed worker’s piece back on the queue, and the pool drops by one', async () => {
    const { made, add, startNewest, alive } = pool(LAPTOP)
    add(10)
    for (let i = 0; i < 3; i++) await startNewest()
    const crashed = made[1]
    const piece = crashed?.pieces()[0]?.index
    crashed?.crash()
    expect(crashed?.terminated).toBe(true)
    // The piece waits first; the pool is now at most 2, which it has.
    await vi.advanceTimersByTimeAsync(0)
    expect(made).toHaveLength(3)
    made[0]?.answerLast()
    expect(made[0]?.pieces().at(-1)?.index).toBe(piece)
    expect(alive()).toHaveLength(2)
  })

  it('answers the pieces left `failed` when a single worker fails twice', async () => {
    const { made, add, startNewest, answers, alive } = pool(PHONE)
    add(3)
    await startNewest()
    made[0]?.answerLast()
    made[0]?.reply({ kind: 'matchBroken', id: made[0].pieces().at(-1)?.id ?? -1, message: 'out of memory' })
    await startNewest()
    expect(made[1]?.pieces().map((piece) => piece.index)).toEqual([1])
    made[1]?.crash()
    expect(answers).toEqual(
      new Map([
        [0, TEXT],
        [1, { kind: 'picture', why: 'failed' }],
        [2, { kind: 'picture', why: 'failed' }],
      ]),
    )
    expect(alive()).toHaveLength(0)
  })

  it('answers every piece `unsupported` when workers fail to start twice, and every later one', async () => {
    const { made, add, answers, matcher } = pool(LAPTOP)
    add(2)
    await vi.advanceTimersByTimeAsync(0)
    made[0]?.reply({ kind: 'matchStartFailed', message: 'no WebAssembly memory' })
    await vi.advanceTimersByTimeAsync(0)
    made[1]?.crash()
    expect([...answers.values()]).toEqual([
      { kind: 'picture', why: 'unsupported' },
      { kind: 'picture', why: 'unsupported' },
    ])
    expect(matcher.unsupported).toBe(true)
    answers.clear()
    add(1, 1)
    expect(answers.get(0)).toEqual({ kind: 'picture', why: 'unsupported' })
    expect(made).toHaveLength(2)
  })

  it('drops a cancelled job’s pieces and ends the workers matching it', async () => {
    const { made, add, startNewest, answers, matcher, alive } = pool(LAPTOP)
    add(5)
    await startNewest()
    await startNewest()
    // Two match its pieces and a third is starting for the three waiting.
    expect(made).toHaveLength(3)
    matcher.cancel(0)
    expect(alive()).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(IDLE_MS)
    expect(made).toHaveLength(3)
    expect(answers.size).toBe(0)
  })

  it('starts counting again after a piece is answered, so failures far apart don’t end the job', async () => {
    const { made, add, startNewest, answers } = pool(PHONE)
    add(3)
    await startNewest()
    made[0]?.crash()
    await startNewest()
    made[1]?.answerLast()
    made[1]?.crash()
    await startNewest()
    expect(made[2]?.pieces().map((piece) => piece.index)).toEqual([1])
    expect(answers).toEqual(new Map([[0, TEXT]]))
  })

  it('matches again a piece whose worker couldn’t load the matcher’s code, as a crash, not a start', async () => {
    const { made, add, startNewest, matcher } = pool(LAPTOP)
    add(1)
    await startNewest()
    made[0]?.reply({ kind: 'matchStartFailed', message: 'chunk failed to load' })
    expect(made[0]?.terminated).toBe(true)
    await startNewest()
    expect(made[1]?.pieces().map((piece) => piece.index)).toEqual([0])
    expect(matcher.unsupported).toBe(false)
  })

  it('answers the pieces left `failed` and ends every worker when destroyed', async () => {
    const { made, add, startNewest, answers, matcher, alive } = pool(LAPTOP)
    add(2)
    await startNewest()
    matcher.destroy()
    expect(alive()).toHaveLength(0)
    expect([...answers.values()]).toEqual([
      { kind: 'picture', why: 'failed' },
      { kind: 'picture', why: 'failed' },
    ])
    expect(made).toHaveLength(2)
  })
})
