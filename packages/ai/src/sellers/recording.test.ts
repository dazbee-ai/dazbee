// Recording and replaying sellers: a round recorded from the flow seller and replayed with no network, against
// Postgres from Docker Compose, and the replay sellers' choice of recording and wait.
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aiCalls } from '@dazbee/db'
import type { CallInput } from '@dazbee/schema'

import {
  flowDeps,
  flowSeller,
  flowWorkspace,
  ledgerOf,
  PLAN,
  planOf,
  roundOf,
  runFlow,
  saveFlow,
} from '../flow/test-flow.ts'
import { db, memoryFiles, newSeller } from '../test-ai.ts'
import { recordingSeller, replaySellers } from './recording.ts'
import { type SellerAdapter, SellerError, type SellerRequest, useSeller } from './seller.ts'
import { testSeller } from './test-sellers.ts'

const READ: CallInput = { kind: 'text', instructions: 'Read the ad.', prompt: 'The ad.', pictures: [] }

/** A new empty folder for a recording. */
const newRecording = () => mkdtemp(join(tmpdir(), 'dazbee-recording-'))

/** A request for call `index` of job `job`, an AI step `step` call. */
function requestOf(step: string, index: number, job = 'job-1', signal = new AbortController().signal): SellerRequest {
  return {
    call: { job, step, index },
    model: 'gpt-6-luna',
    input: READ,
    options: {},
    signal,
    readPicture: async () => new Uint8Array(),
    references: async () => [],
    keepRequestId: async () => undefined,
  }
}

/** The text a call answers `request` with. */
async function textOf(seller: SellerAdapter, request: SellerRequest): Promise<string> {
  const { output } = await seller.call(request)
  return output.kind === 'text' ? output.text : output.kind
}

/** The recorded calls of `step` in `dir`, oldest first, as their `call.json`. */
async function recordedIn(dir: string, step: string) {
  const folders = (await readdir(join(dir, step))).sort()
  return Promise.all(
    folders.map(async (folder) => ({
      folder,
      files: (await readdir(join(dir, step, folder))).sort(),
      call: JSON.parse(await readFile(join(dir, step, folder, 'call.json'), 'utf8')),
    })),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('recordingSeller', () => {
  it('writes each answer of a round, and the replay sellers answer another round from it with no network at no cost', async () => {
    const dir = await newRecording()
    const seller = await flowSeller(newSeller('recorded'))
    useSeller(recordingSeller(seller, dir))
    const who = await flowWorkspace()
    const recorded = await saveFlow(who, { kind: 'round', input: await roundOf(who) })
    expect(await runFlow(recorded, flowDeps(seller))).toMatchObject({ state: 'done' })

    const [plan, ...more] = await recordedIn(dir, 'flow.round-plan')
    expect(more).toEqual([])
    expect(plan?.files).toEqual(['call.json'])
    expect(plan?.call).toMatchObject({
      step: 'flow.round-plan',
      callIndex: 0,
      job: recorded,
      seller: seller.seller,
      usage: { 'input-token': 1000, 'output-token': 500 },
      request: { input: { kind: 'text', prompt: expect.stringContaining('Harbour Coffee, fresh every morning') } },
      output: { kind: 'text', json: PLAN },
    })
    expect(plan?.call.request.input.instructions).toMatch(/^\d+ characters$/)
    const drafts = await recordedIn(dir, 'flow.draft-fast')
    expect(drafts.map((d) => d.call.callIndex).sort()).toEqual([1, 2, 3, 4])
    for (const draft of drafts) {
      expect(draft.files).toEqual(['call.json', 'picture-0.png'])
      expect(draft.call.output).toEqual({
        kind: 'pictures',
        pictures: [{ file: 'picture-0.png', type: 'image/png', width: 16, height: 16 }],
      })
    }

    // The replay: a different brief at a different size, with every request to the network refused.
    const [replay] = replaySellers([seller.seller], dir, 1000)
    if (!replay) throw new Error('no replay seller')
    useSeller(replay)
    const fetch = vi.fn(() => Promise.reject(new Error('no network in a replay')))
    vi.stubGlobal('fetch', fetch)
    const other = await flowWorkspace()
    const round = await roundOf(other, { words: 'Tea for two', size: { width: 1080, height: 1920 } })
    const job = await saveFlow(other, { kind: 'round', input: round })
    const files = memoryFiles()
    expect(await runFlow(job, flowDeps(seller, files))).toMatchObject({ state: 'done', error: null })

    expect(fetch).not.toHaveBeenCalled()
    expect(seller.requests).toHaveLength(5)
    expect(await planOf(round.briefId)).toEqual(PLAN)
    const picture = await readFile(join(dir, 'flow.draft-fast', drafts[0]?.folder ?? '', 'picture-0.png'))
    expect([...files.saved.values()].map((bytes) => Buffer.from(bytes).equals(picture))).toEqual([
      true,
      true,
      true,
      true,
    ])
    const rows = await db.select().from(aiCalls).where(eq(aiCalls.jobId, job)).orderBy(aiCalls.callIndex)
    expect(rows).toHaveLength(5)
    for (const row of rows) {
      expect(row).toMatchObject({ state: 'done', sellerCost: 0n, realCost: 0n, chargeCost: 0n, currency: null })
      expect(row.sellerRequestId).toMatch(new RegExp(`^replayed:${row.step}/`))
    }
    expect(rows[0]?.usage).toEqual({ 'input-token': 1000, 'output-token': 500 })
    expect((await ledgerOf(job)).filter((entry) => entry.kind === 'charge')).toEqual([])
  })

  it('gives the answer of a call it could not write down', async () => {
    const recorder = recordingSeller(testSeller('recorder'), '\0 not a folder')
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await textOf(recorder, requestOf('flow.read', 0))).toBe('test answer')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('AI call not recorded'))
    error.mockRestore()
  })
})

describe('replaySellers', () => {
  it('answers a call by its step and place, else by its step’s recordings in turn, and fails a step not recorded', async () => {
    const dir = await newRecording()
    const recorder = recordingSeller(
      testSeller('recorder', [{ answer: { kind: 'text', text: 'one' } }, { answer: { kind: 'text', text: 'two' } }]),
      dir,
    )
    await recorder.call(requestOf('flow.read', 1))
    await recorder.call(requestOf('flow.read', 2))
    const [replay] = replaySellers(['replay'], dir, 1000)
    if (!replay) throw new Error('no replay seller')

    expect(await textOf(replay, requestOf('flow.read', 2, 'other-job'))).toBe('two')
    expect(await textOf(replay, requestOf('flow.read', 2, 'third-job'))).toBe('two')
    const elsewhere = []
    for (let i = 0; i < 3; i++) elsewhere.push(await textOf(replay, requestOf('flow.read', 7)))
    expect(elsewhere).toEqual(['one', 'two', 'one'])
    const answer = await replay.call(requestOf('flow.read', 1))
    expect(answer).toMatchObject({ usage: { 'input-token': 1000, 'output-token': 500 }, replayed: true })
    expect(answer.requestId).toMatch(/^replayed:flow\.read\//)

    const missing = replay.call(requestOf('flow.refine-plan', 0))
    await expect(missing).rejects.toBeInstanceOf(SellerError)
    await expect(missing).rejects.toMatchObject({ status: 404, message: expect.stringContaining('no recording') })
  })

  it('waits the recorded time divided by the speed, and stops when the call is aborted', async () => {
    const dir = await newRecording()
    await recordingSeller(testSeller('recorder', [], { afterMs: 200 }), dir).call(requestOf('flow.read', 0))
    const [replay] = replaySellers(['replay'], dir, 2)
    if (!replay) throw new Error('no replay seller')

    const started = performance.now()
    await replay.call(requestOf('flow.read', 0))
    expect(performance.now() - started).toBeGreaterThanOrEqual(90)

    const abort = new AbortController()
    const call = replay.call(requestOf('flow.read', 0, 'job-1', abort.signal))
    abort.abort(new Error('cancelled'))
    await expect(call).rejects.toThrow()
  })
})
