import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { MatchAnswer, MatchJob } from '@dazbee/schema'

import {
  type Device,
  HEAP_LIMIT,
  IDLE_MS,
  type MatchMessage,
  matchPool,
  type MatchReply,
  type MatchWorker,
  poolLimit,
} from './match-pool.ts'

/** The answer the stand-in workers give. */
const TEXT: MatchAnswer = { kind: 'picture', why: 'looksDifferent' }

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
  /** The pieces posted to it, by task id. */
  pieces() {
    return this.posted.flatMap((message) => (message.kind === 'matchPiece' ? [message] : []))
  }
  /** Answers its last piece with `answer`, CanvasKit's heap at `heap`. */
  answerLast(answer: MatchAnswer = TEXT, heap = 128 * 2 ** 20) {
    const piece = this.pieces().at(-1)
    if (!piece) throw new Error('no piece was posted')
    this.reply({ kind: 'matchAnswer', id: piece.id, answer, heap })
  }
}

const LAPTOP: Device = { cores: 4, memoryGb: 8 }
const PHONE: Device = { cores: 4, memoryGb: 2 }
const job = (pieces: number) =>
  ({
    picture: '',
    pieces: Array.from({ length: pieces }, () => ({
      kind: 'text',
      rect: { x: 0, y: 0, width: 1, height: 1 },
      words: 'A',
    })),
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
  const compile = vi.fn(async () => ({ canvasKit: {} as WebAssembly.Module, onnxRuntime: {} as WebAssembly.Module }))
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
  const add = (pieces: number, id = 0) =>
    matcher.add({ id, job: job(pieces), fonts }, range(pieces), {
      step: () => {},
      answer: (index, answer) => answers.set(index, answer),
    })
  /** The workers not ended. */
  const alive = () => made.filter((worker) => !worker.terminated)
  /** Lets the compile resolve, then the newest worker answer that it started. */
  const startNewest = async () => {
    await vi.advanceTimersByTimeAsync(0)
    made.at(-1)?.reply({ kind: 'matchReady' })
  }
  const setHidden = (value: boolean) => {
    hidden = value
    shownChanged()
  }
  return { matcher, made, answers, compile, add, alive, startNewest, setHidden }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('poolLimit', () => {
  it('leaves a core to the page and keeps within a quarter of the memory, at most 1.5 GB', () => {
    expect(poolLimit(LAPTOP)).toBe(3)
    expect(poolLimit({ cores: 16, memoryGb: 8 })).toBe(3)
    expect(poolLimit(PHONE)).toBe(1)
  })

  it('takes 256 MB, so one worker, when the browser doesn’t say its memory, and one worker on one core', () => {
    expect(poolLimit({ cores: 8 })).toBe(1)
    expect(poolLimit({ cores: 1, memoryGb: 8 })).toBe(1)
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

  it('compiles once for every worker, and leaves no worker and nothing compiled 15 s after the last piece', async () => {
    const { made, compile, add, startNewest, alive, answers } = pool(LAPTOP)
    add(2)
    await startNewest()
    await startNewest()
    expect(compile).toHaveBeenCalledTimes(1)
    for (const worker of made) worker.answerLast()
    expect(answers.size).toBe(2)
    await vi.advanceTimersByTimeAsync(IDLE_MS - 1)
    expect(alive()).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(1)
    expect(alive()).toHaveLength(0)
    add(1, 1)
    await startNewest()
    expect(compile).toHaveBeenCalledTimes(2)
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

  it('ends a worker whose piece left CanvasKit’s heap past 512 MB, and starts a fresh one for the next', async () => {
    const { made, add, startNewest, answers } = pool(PHONE)
    add(2)
    await startNewest()
    made[0]?.answerLast(TEXT, HEAP_LIMIT + 1)
    expect(answers.get(0)).toEqual(TEXT)
    expect(made[0]?.terminated).toBe(true)
    await startNewest()
    expect(made[1]?.pieces().map((piece) => piece.index)).toEqual([1])
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
})
