import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ShapeStep, TextStep } from '@dazbee/matchers'
import type { MatchAnswer, MatchJob } from '@dazbee/schema'

import { type Browser, matchClient } from './match-client.ts'
import {
  type Device,
  type MatchMessage,
  matchPool,
  type MatchReply,
  type MatchStep,
  type MatchWorker,
} from './match-pool.ts'

const TEXT_STEPS: TextStep[] = ['reading', 'shortlist', 'fitting', 'finerFit']
const SHAPE_STEPS: ShapeStep[] = ['colourSplit', 'firstPass', 'judging', 'fullPass', 'judging']
const score = (index: number) => ({ ssim: index / 10, inkMissed: 0, far: 0 })
/** The answer the stand-in gives the piece at `index`. */
const answerOf = (index: number): MatchAnswer => ({ kind: 'picture', why: 'looksDifferent', scores: score(index) })

/**
 * A stand-in worker that starts at once and answers each piece through the steps of the matcher it
 * was started as, as a matcher worker does.
 */
class FakeWorker implements MatchWorker {
  posted: MatchMessage[] = []
  matcher: 'text' | 'shape' | undefined
  terminated = false
  onmessage: Worker['onmessage'] = null
  onerror: Worker['onerror'] = null
  private readonly answering: boolean
  constructor(answering: boolean) {
    this.answering = answering
  }
  postMessage(message: MatchMessage) {
    this.posted.push(message)
    if (message.kind === 'matchStart') {
      this.matcher = message.matcher
      this.reply({ kind: 'matchReady' })
    }
    if (message.kind !== 'matchPiece' || !this.answering) return
    for (const step of this.matcher === 'shape' ? SHAPE_STEPS : TEXT_STEPS)
      this.reply({ kind: 'matchStep', id: message.id, step })
    this.reply({ kind: 'matchAnswer', id: message.id, answer: answerOf(message.index), memory: 0 })
  }
  terminate() {
    this.terminated = true
  }
  reply(data: MatchReply) {
    this.onmessage?.call(this as unknown as Worker, { data } as MessageEvent)
  }
}

const LAPTOP: Browser = { webAssembly: true, moduleWorkers: true, cores: 4, memoryGb: 8 }
const fonts = { catalog: [], uploadPath: '/fonts/' }
const rect = { x: 0, y: 0, width: 1, height: 1 }
/** A job of three shape pieces. */
const SHAPES = {
  picture: '',
  pieces: [
    { kind: 'shape', rect },
    { kind: 'shape', rect },
    { kind: 'shape', rect },
  ],
  kit: { colors: {}, fonts: {}, textStyles: [] },
  setting: 'hybrid',
} as MatchJob
/** A job of two text pieces around a shape piece. */
const JOB = {
  picture: '',
  pieces: [
    { kind: 'text', rect, words: 'Sale' },
    { kind: 'shape', rect },
    { kind: 'text', rect, words: 'Now' },
  ],
  kit: { colors: {}, fonts: {}, textStyles: [] },
  setting: 'hybrid',
} as MatchJob

/** A client on a stand-in browser whose pool starts stand-in workers, and the workers it started. */
function client(browser: Browser, answering = true) {
  const made: FakeWorker[] = []
  const makePool = vi.fn((device: Device) =>
    matchPool({
      start: () => {
        const worker = new FakeWorker(answering)
        made.push(worker)
        return worker
      },
      device,
      compile: async () => ({}) as WebAssembly.Module,
      page: { hidden: () => false, onChange: () => () => {} },
    }),
  )
  return { matcher: matchClient({ browser: () => browser, makePool }), made, makePool }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('matchClient', () => {
  it('answers a job’s text and shape pieces in order, each on a worker of its kind, telling each piece’s steps', async () => {
    const { matcher, made } = client(LAPTOP)
    const told = new Map<number, MatchStep[]>()
    const answers = matcher.match(JOB, {
      fonts,
      step: (index, step) => told.set(index, [...(told.get(index) ?? []), step]),
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(await answers).toEqual([answerOf(0), answerOf(1), answerOf(2)])
    expect(told).toEqual(
      new Map<number, MatchStep[]>([
        [0, TEXT_STEPS],
        [1, SHAPE_STEPS],
        [2, TEXT_STEPS],
      ]),
    )
    expect(made.map((worker) => worker.matcher).sort()).toEqual(['shape', 'text'])
  })

  it.each([
    ['text and shape', JOB],
    ['shape', SHAPES],
  ])('ends a %s job when its signal aborts: its workers end and it is answered with the reason', async (_, job) => {
    const { matcher, made } = client(LAPTOP, false)
    const cancel = new AbortController()
    const answers = matcher.match(job, { fonts, signal: cancel.signal })
    await vi.advanceTimersByTimeAsync(0)
    expect(made.length).toBeGreaterThan(0)
    cancel.abort(new Error('cancelled'))
    await expect(answers).rejects.toThrow('cancelled')
    expect(made.every((worker) => worker.terminated)).toBe(true)
  })

  it.each([
    ['without WebAssembly', { ...LAPTOP, webAssembly: false }],
    ['without module workers', { ...LAPTOP, moduleWorkers: false }],
    ['that says it has 1 GB of memory', { ...LAPTOP, memoryGb: 1 }],
  ])('answers every piece `unsupported` in a browser %s, and starts nothing', async (_, browser) => {
    const { matcher, makePool, made } = client(browser)
    const unsupported = { kind: 'picture', why: 'unsupported' }
    expect(await matcher.match(JOB, { fonts })).toEqual([unsupported, unsupported, unsupported])
    expect(await matcher.match(SHAPES, { fonts })).toEqual([unsupported, unsupported, unsupported])
    expect(makePool).not.toHaveBeenCalled()
    expect(made).toHaveLength(0)
  })

  it('runs where the browser doesn’t say its memory', async () => {
    const { matcher } = client({ webAssembly: true, moduleWorkers: true, cores: 2 })
    const answers = matcher.match(JOB, { fonts })
    await vi.advanceTimersByTimeAsync(0)
    expect(await answers).toEqual([answerOf(0), answerOf(1), answerOf(2)])
  })
})
