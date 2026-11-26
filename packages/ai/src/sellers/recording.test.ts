// Recording and replaying sellers: a round recorded from the flow seller and replayed with no network, against
// Postgres from Docker Compose, and the replay sellers' choice of recording and wait.
import { mkdtemp, readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { aiCalls, newId } from '@dazbee/db'
import type { CallInput, LayeringInput } from '@dazbee/schema'

import {
  chargedCalls,
  flowDeps,
  flowSeller,
  type FlowWorkspace,
  flowWorkspace,
  ledgerOf,
  PLAN,
  planOf,
  roundOf,
  runFlow,
  saveFlow,
} from '../features/test-features.ts'
import { db, memoryFiles, newSeller } from '../test-ai.ts'
import { recordingSeller, replaySellers } from './recording.ts'
import { type SellerAdapter, SellerError, type SellerRequest, useSeller } from './seller.ts'
import { testSeller } from './test-sellers.ts'

const READ: CallInput = { kind: 'text', instructions: 'Read the ad.', prompt: 'The ad.', pictures: [] }

/** A layering job of two sizes of `who`'s, planned from the draft they came from, at 1024 px. */
async function layeringOf(who: FlowWorkspace): Promise<LayeringInput> {
  const round = await roundOf(who)
  const key = (name: string) => `workspaces/${who.workspace}/originals/${name}`
  return {
    brandId: who.brand,
    designId: round.designId,
    briefId: round.briefId,
    frames: [
      { frameId: newId(), pictureKey: key('square') },
      { frameId: newId(), pictureKey: key('story') },
    ],
    planKey: key('draft'),
    size: 1024,
  }
}

/** A new empty folder for a recording. */
const newRecording = () => mkdtemp(join(tmpdir(), 'dazbee-recording-'))

/** A request for call `index` of job `job`, a call of the AI function and preset named `under`, as `function/preset`. */
function requestOf(under: string, index: number, job = 'job-1', signal = new AbortController().signal): SellerRequest {
  const [fn = '', preset = ''] = under.split('/')
  return {
    call: { job, function: fn, preset, index },
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

/** The recorded calls kept under `under` (`function/preset`) in `dir`, oldest first, as their `call.json`. */
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
    // A recorded call is a real one, charged at its real cost.
    expect(await chargedCalls(recorded)).toEqual([0, 1, 2, 3, 4])
    const real = await db.select().from(aiCalls).where(eq(aiCalls.jobId, recorded))
    for (const row of real) expect(row.chargeCost).toBeGreaterThan(0n)

    const [plan, ...more] = await recordedIn(dir, 'round-plan/light-luna')
    expect(more).toEqual([])
    expect(plan?.files).toEqual(['call.json'])
    expect(plan?.call).toMatchObject({
      function: 'round-plan',
      preset: 'light-luna',
      callIndex: 0,
      job: recorded,
      seller: seller.seller,
      usage: { 'input-token': 1000, 'output-token': 500 },
      request: { input: { kind: 'text', prompt: expect.stringContaining('Harbour Coffee, fresh every morning') } },
      output: { kind: 'text', json: PLAN },
    })
    expect(plan?.call.request.input.instructions).toMatch(/^\d+ characters$/)
    const drafts = await recordedIn(dir, 'draft/gpt-image-medium')
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
    const picture = await readFile(join(dir, 'draft/gpt-image-medium', drafts[0]?.folder ?? '', 'picture-0.png'))
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
      expect(row.sellerRequestId).toMatch(new RegExp(`^replayed:${row.function}/${row.preset}/`))
    }
    expect(rows[0]?.usage).toEqual({ 'input-token': 1000, 'output-token': 500 })
    expect((await ledgerOf(job)).filter((entry) => entry.kind === 'charge')).toEqual([])
  })

  it('writes a layering job’s layers, and a replayed layering charges nothing for its fixed-cost split', async () => {
    const dir = await newRecording()
    const seller = await flowSeller(newSeller('layers'))
    useSeller(recordingSeller(seller, dir))
    const who = await flowWorkspace()
    const recorded = await saveFlow(who, { kind: 'layering', input: await layeringOf(who) })
    expect(await runFlow(recorded, flowDeps(seller))).toMatchObject({ state: 'done' })
    const splits = await recordedIn(dir, 'layer-split/ming')
    expect(splits).toHaveLength(2)
    for (const split of splits) {
      expect(split.files).toEqual(['call.json', 'layer-0.png', 'layer-1.png'])
      expect(split.call.output).toMatchObject({ kind: 'layers', gpuSeconds: 17.5 })
    }

    const [replay] = replaySellers([seller.seller], dir, 1000)
    if (!replay) throw new Error('no replay seller')
    useSeller(replay)
    const other = await flowWorkspace()
    const job = await saveFlow(other, { kind: 'layering', input: await layeringOf(other) })
    expect(await runFlow(job, flowDeps(seller))).toMatchObject({ state: 'done', error: null })
    expect(seller.requests).toHaveLength(5)
    const rows = await db.select().from(aiCalls).where(eq(aiCalls.jobId, job))
    expect(rows.filter((row) => row.function === 'layer-split')).toHaveLength(2)
    for (const row of rows) expect(row).toMatchObject({ state: 'done', realCost: 0n, chargeCost: 0n })
    expect((await ledgerOf(job)).filter((entry) => entry.kind === 'charge')).toEqual([])
  })

  it('gives the answer of a call it could not write down', async () => {
    const recorder = recordingSeller(testSeller('recorder'), '\0 not a folder')
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    expect(await textOf(recorder, requestOf('reading/luna', 0))).toBe('test answer')
    expect(error).toHaveBeenCalledWith(expect.stringContaining('AI call not recorded'))
    error.mockRestore()
  })
})

describe('replaySellers', () => {
  it('answers a call by its AI function, preset and place, else by their recordings in turn, and fails one not recorded', async () => {
    const dir = await newRecording()
    const recorder = recordingSeller(
      testSeller('recorder', [{ answer: { kind: 'text', text: 'one' } }, { answer: { kind: 'text', text: 'two' } }]),
      dir,
    )
    await recorder.call(requestOf('reading/luna', 1))
    await recorder.call(requestOf('reading/luna', 2))
    const [replay] = replaySellers(['replay'], dir, 1000)
    if (!replay) throw new Error('no replay seller')

    expect(await textOf(replay, requestOf('reading/luna', 2, 'other-job'))).toBe('two')
    expect(await textOf(replay, requestOf('reading/luna', 2, 'third-job'))).toBe('two')
    const elsewhere = []
    for (let i = 0; i < 3; i++) elsewhere.push(await textOf(replay, requestOf('reading/luna', 7)))
    expect(elsewhere).toEqual(['one', 'two', 'one'])
    const answer = await replay.call(requestOf('reading/luna', 1))
    expect(answer).toMatchObject({ usage: { 'input-token': 1000, 'output-token': 500 }, replayed: true })
    expect(answer.requestId).toMatch(/^replayed:reading\/luna\//)

    // Another preset of the same AI function has no recording of its own, and never takes this one's.
    await expect(replay.call(requestOf('reading/other', 1))).rejects.toMatchObject({ status: 404 })
    const missing = replay.call(requestOf('refine-plan/luna', 0))
    await expect(missing).rejects.toBeInstanceOf(SellerError)
    await expect(missing).rejects.toMatchObject({ status: 404, message: expect.stringContaining('no recording') })
  })

  it('answers each replayed job from one recorded job, each in turn', async () => {
    const dir = await newRecording()
    const answers = ['plan A', 'read A', 'plan B', 'read B'].map((text) => ({
      answer: { kind: 'text' as const, text },
    }))
    const recorder = recordingSeller(testSeller('recorder', answers), dir)
    await recorder.call(requestOf('layer-plan/sol', 0, 'job-a'))
    await recorder.call(requestOf('reading/luna', 1, 'job-a'))
    await recorder.call(requestOf('layer-plan/sol', 0, 'job-b'))
    await recorder.call(requestOf('reading/luna', 1, 'job-b'))
    const [replay] = replaySellers(['replay'], dir, 1000)
    if (!replay) throw new Error('no replay seller')

    const replayed = async (job: string) => [
      await textOf(replay, requestOf('layer-plan/sol', 0, job)),
      await textOf(replay, requestOf('reading/luna', 1, job)),
      await textOf(replay, requestOf('reading/luna', 2, job)),
    ]
    // Recordings sort by when they were made, so job A's come first.
    const sorted = (await recordedIn(dir, 'reading/luna')).map((r) => r.call.job)
    const [first, second] = sorted[0] === 'job-a' ? ['A', 'B'] : ['B', 'A']
    expect(await replayed('x')).toEqual([`plan ${first}`, `read ${first}`, `read ${first}`])
    expect(await replayed('y')).toEqual([`plan ${second}`, `read ${second}`, `read ${second}`])
    expect(await replayed('z')).toEqual([`plan ${first}`, `read ${first}`, `read ${first}`])
  })

  it('waits the recorded time divided by the speed, and stops when the call is aborted', async () => {
    const dir = await newRecording()
    await recordingSeller(testSeller('recorder', [], { afterMs: 200 }), dir).call(requestOf('reading/luna', 0))
    const [replay] = replaySellers(['replay'], dir, 2)
    if (!replay) throw new Error('no replay seller')

    const started = performance.now()
    await replay.call(requestOf('reading/luna', 0))
    expect(performance.now() - started).toBeGreaterThanOrEqual(90)

    const abort = new AbortController()
    const aborted = performance.now()
    const call = replay.call(requestOf('reading/luna', 0, 'job-1', abort.signal))
    setTimeout(() => abort.abort(new Error('cancelled')), 10)
    await expect(call).rejects.toMatchObject({ name: 'AbortError' })
    expect(performance.now() - aborted).toBeLessThan(80)
  })
})
