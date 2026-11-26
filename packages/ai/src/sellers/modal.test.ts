// Modal's adapter with Modal's SDK faked: the layer split spawned, asked about and read, picked up again by its
// call id after a restart, a split Modal timed out, and what a split is charged and logged at, through the call
// function on the layer split AI function, its preset's model and the migration's prices. No call leaves the machine.
import { asc, eq } from 'drizzle-orm'
import { FunctionTimeoutError, TimeoutError } from 'modal'
import { beforeAll, describe, expect, it } from 'vitest'

import { aiCalls } from '@dazbee/db'
import type { CallInput, LayerSplitRequest, LayerSplitResult } from '@dazbee/schema'

import { callAi, CallFailed } from '../call.ts'
import { aiFunctionDef } from '../functions/ai-function.ts'
import { hold } from '../ledger.ts'
import { priceUsage } from '../price-list.ts'
import { aiSettingsOf } from '../settings.ts'
import { addFunction, addGrant, addJob, db, memoryFiles, newWorkspace, RUPEE, setJob, TEST_PRESET } from '../test-ai.ts'
import { billedSeconds, LAYERING, type ModalFunctionCall, type ModalSdk, modalSellerOn } from './modal.ts'
import { useSeller } from './seller.ts'
import { expectDeclared } from './test-fetch.ts'

/** A 1 × 1 PNG, as a layer the app gives back. */
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

const RESULT: LayerSplitResult = {
  layers: [
    { png: PNG, width: 1, height: 1 },
    { png: PNG, width: 1, height: 1 },
  ],
  seconds: 17.5,
  cpuCores: 4,
  memoryGib: 32,
}

/** What one ask for a call's result does: wait out its time, wait until the worker stops, answer, or fail. */
type Ask = 'wait' | 'hang' | { result: unknown } | { fail: Error }

/** A fake of Modal's SDK whose calls answer each ask from `asks` in turn, and what it was asked. */
function fakeModal(asks: Ask[]) {
  const seen = { spawned: [] as unknown[][], fromId: [] as string[], asks: 0, cancelled: [] as string[] }
  let next = 0
  const callOf = (functionCallId: string): ModalFunctionCall => ({
    functionCallId,
    get: async () => {
      seen.asks++
      const ask = asks[Math.min(next++, asks.length - 1)] ?? 'wait'
      if (ask === 'wait') throw new TimeoutError('no result yet')
      if (ask === 'hang') return new Promise(() => undefined)
      if ('fail' in ask) throw ask.fail
      return ask.result
    },
    cancel: async () => {
      seen.cancelled.push(functionCallId)
    },
  })
  const sdk: ModalSdk = {
    cls: {
      fromName: async (app, name) => {
        expect([app, name]).toEqual([LAYERING.app, LAYERING.cls])
        return {
          instance: async () => ({
            method: (method) => {
              expect(method).toBe(LAYERING.method)
              return {
                spawn: async (args = []) => {
                  seen.spawned.push(args)
                  return callOf(`fc-${seen.spawned.length}`)
                },
              }
            },
          }),
        }
      },
    },
    functionCalls: {
      fromId: async (id) => {
        seen.fromId.push(id)
        return callOf(id)
      },
    },
  }
  return { sdk, seen }
}

/** A running `layer-split` job of a workspace of its own with ₹100, holding ₹10, and its picture. */
/** The model the layer split runs. */
const LAYER_SPLIT_MODEL = 'ming-image-0.1-design-layer'

/** A layer split function of this file's own, on the layer split's model and with its fixed charge. */
let split: string

beforeAll(async () => {
  const made = await addFunction([], {
    kind: 'layer-split',
    model: LAYER_SPLIT_MODEL,
    fixedCharge: aiFunctionDef('layer-split').fixedCharge,
  })
  split = made.fn
})

async function splitJob(attempt = 1) {
  const workspace = newWorkspace()
  await addGrant(workspace, 100n * RUPEE)
  const id = await addJob(workspace, { attempt })
  await db.transaction((tx) => hold(tx, { workspace, job: id, cost: 10n * RUPEE }))
  const files = memoryFiles()
  const picture = await files.save(new Uint8Array([1, 2, 3]), 'image/png')
  const input: CallInput = { kind: 'layer-split', picture, size: 1024 }
  return { job: { id, workspaceId: workspace }, files, input }
}

async function callRows(job: string) {
  return db.select().from(aiCalls).where(eq(aiCalls.jobId, job)).orderBy(asc(aiCalls.try))
}

describe('billedSeconds', () => {
  it('gives the first call a container serves its start and the wait before it stops', () => {
    expect(billedSeconds({ ...RESULT, startSeconds: 40, idleSeconds: null, waitSeconds: 5 })).toBe(62.5)
  })

  it('gives a later call the wait since the container’s last call, and no start or last wait again', () => {
    expect(billedSeconds({ ...RESULT, startSeconds: null, idleSeconds: 2, waitSeconds: 5 })).toBe(19.5)
    expect(billedSeconds({ ...RESULT, startSeconds: null, idleSeconds: 0, waitSeconds: 5 })).toBe(17.5)
  })

  it('adds a container’s calls up to the time it ran: its start, its work, its waits and its last wait', () => {
    const calls: LayerSplitResult[] = [
      { ...RESULT, seconds: 20, startSeconds: 35, idleSeconds: null, waitSeconds: 5 },
      { ...RESULT, seconds: 10, startSeconds: null, idleSeconds: 0.5, waitSeconds: 5 },
      { ...RESULT, seconds: 18, startSeconds: null, idleSeconds: 3, waitSeconds: 5 },
    ]
    expect(calls.reduce((sum, call) => sum + billedSeconds(call), 0)).toBe(35 + 20 + 0.5 + 10 + 3 + 18 + 5)
  })

  it('counts the seconds the function worked for an app that reports no start or wait', () => {
    expect(billedSeconds(RESULT)).toBe(17.5)
  })
})

describe('modalSellerOn', () => {
  it('spawns the split, keeps its call id, asks until its result comes and reads the layers', async () => {
    const { sdk, seen } = fakeModal(['wait', 'wait', { result: RESULT }])
    useSeller(modalSellerOn(sdk, { pollMs: 1 }))
    const { job, files, input } = await splitJob()
    const output = await callAi(db, {
      job,
      attempt: 1,
      callIndex: 0,
      feature: 'layering',
      function: split,
      preset: TEST_PRESET,
      input,
      signal: new AbortController().signal,
      files,
    })
    // The request says when it was asked for, for a container that starts for it.
    const sent: LayerSplitRequest = { picture: 'AQID', size: 1024, askedAt: expect.any(Number) as number }
    expect(seen.spawned).toEqual([[sent]])
    const [[{ askedAt }]] = seen.spawned as [[LayerSplitRequest]]
    expect(Math.abs(Date.now() - (askedAt ?? 0))).toBeLessThan(60_000)
    expect(seen.asks).toBe(3)
    expect(output).toMatchObject({
      kind: 'layers',
      gpuSeconds: 17.5,
      layers: [
        { width: 1, height: 1 },
        { width: 1, height: 1 },
      ],
    })
    const [row] = await callRows(job.id)
    expect(row).toMatchObject({ seller: 'modal', state: 'done', sellerRequestId: 'fc-1' })
  })

  it('picks up the split an earlier attempt spawned by its call id after a restart, and spawns none', async () => {
    const { sdk, seen } = fakeModal(['wait', 'hang', { result: RESULT }])
    useSeller(modalSellerOn(sdk, { pollMs: 1 }))
    const { job, files, input } = await splitJob()
    const stop = new AbortController()
    const first = callAi(db, {
      job,
      attempt: 1,
      callIndex: 0,
      feature: 'layering',
      function: split,
      preset: TEST_PRESET,
      input,
      signal: stop.signal,
      files,
    })
    while (seen.asks < 2) await new Promise((resolve) => setTimeout(resolve, 5))
    stop.abort('taken-back')
    await expect(first).rejects.toBe('taken-back')
    await setJob(job.id, { attempt: 2 })
    const signal = new AbortController().signal
    const output = await callAi(db, {
      job,
      attempt: 2,
      callIndex: 0,
      feature: 'layering',
      function: split,
      preset: TEST_PRESET,
      input,
      signal,
      files,
    })
    expect(output.kind).toBe('layers')
    expect(seen.spawned).toHaveLength(1)
    expect(seen.fromId).toEqual(['fc-1'])
    expect(seen.cancelled).toEqual([])
    const rows = await callRows(job.id)
    expect(rows.map((r) => [r.attempt, r.state, r.sellerRequestId])).toEqual([
      [1, 'failed', 'fc-1'],
      [2, 'done', 'fc-1'],
    ])
  })

  it('logs a split Modal timed out as unknown and fails the call without trying again', async () => {
    const { sdk, seen } = fakeModal([{ fail: new FunctionTimeoutError('Function timed out after 480s') }])
    useSeller(modalSellerOn(sdk, { pollMs: 1 }))
    const { job, files, input } = await splitJob()
    const call = callAi(db, {
      job,
      attempt: 1,
      callIndex: 0,
      feature: 'layering',
      function: split,
      preset: TEST_PRESET,
      input,
      signal: new AbortController().signal,
      files,
    })
    await expect(call).rejects.toBeInstanceOf(CallFailed)
    expect(seen.spawned).toHaveLength(1)
    const rows = await callRows(job.id)
    expect(rows).toMatchObject([{ state: 'unknown', sellerRequestId: 'fc-1', chargedAt: null }])
    expect(rows[0]?.error).toContain('Modal timed the layer split out')
  })

  it('logs the start and the last wait of a cold call as usage too', async () => {
    const cold = { ...RESULT, startSeconds: 40, idleSeconds: null, waitSeconds: 5 }
    const { sdk } = fakeModal([{ result: cold }])
    useSeller(modalSellerOn(sdk, { pollMs: 1 }))
    const { job, files, input } = await splitJob()
    const output = await callAi(db, {
      job,
      attempt: 1,
      callIndex: 0,
      feature: 'layering',
      function: split,
      preset: TEST_PRESET,
      input,
      signal: new AbortController().signal,
      files,
    })
    // The output keeps the seconds the split itself took.
    expect(output).toMatchObject({ kind: 'layers', gpuSeconds: 17.5 })
    const [row] = await callRows(job.id)
    expect(row?.usage).toEqual({ 'gpu-second': 62.5, 'cpu-core-second': 250, 'memory-gib-second': 2000 })
    expect(row?.chargeCost).toBe((await aiSettingsOf(db)).layerSplit1024)
  })

  it('charges the fixed amount for the size and logs the GPU, CPU and memory cost', async () => {
    const { sdk } = fakeModal([{ result: RESULT }])
    useSeller(modalSellerOn(sdk, { pollMs: 1 }))
    const { job, files, input } = await splitJob()
    await callAi(db, {
      job,
      attempt: 1,
      callIndex: 0,
      feature: 'layering',
      function: split,
      preset: TEST_PRESET,
      input,
      signal: new AbortController().signal,
      files,
    })
    const settings = await aiSettingsOf(db)
    const [row] = await callRows(job.id)
    // 17.5 GPU-seconds at US$0.001097, 70 core-seconds at US$0.0000131 and 560 GiB-seconds at US$0.00000222:
    // US$0.0191975 + US$0.000917 + US$0.0012432, with no fee.
    expect(row).toMatchObject({
      usage: { 'gpu-second': 17.5, 'cpu-core-second': 70, 'memory-gib-second': 560 },
      currency: 'USD',
      sellerCost: 21_358n,
      chargeCost: settings.layerSplit1024,
    })
    expectDeclared('modal', 'layer-split', 'ming-image-0.1-design-layer', row?.usage ?? {})
    const priced = await priceUsage(db, 'modal', 'ming-image-0.1-design-layer', row?.usage ?? {})
    expect(row?.realCost).toBe(priced.realCost)
  })
})
