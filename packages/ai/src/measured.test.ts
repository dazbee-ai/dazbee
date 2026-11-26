// A preset's cost and seconds, from its first guess to what its own done calls measured, and its done calls,
// cut-offs and failures as the admin page counts them.
import { describe, expect, it } from 'vitest'

import { aiCalls, newId } from '@dazbee/db'
import type { CallState } from '@dazbee/schema'

import { CUT_OFF } from './call-log.ts'
import type { Preset } from './functions/types.ts'
import { presetMeasured, presetNumbers } from './measured.ts'
import { addJob, db, newWorkspace } from './test-ai.ts'

/** A preset guessed at ₹5 and 50 s. */
const PRESET: Preset = { model: 'test-model', settings: {}, guess: { cost: 5_000_000n, seconds: 50 } }

/** A function name no other test uses. */
const newFunction = () => `test-function-${newId()}`

/** Three days, in milliseconds. */
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000

/**
 * Logs calls of `fn`'s preset `name`, each of `cost` millionths and `seconds`, the first given the oldest. They
 * start three days ago, so they never count towards today's spending stop, which every test's jobs share.
 */
async function logCalls(
  fn: string,
  name: string,
  calls: { cost: bigint; seconds: number; state?: CallState; requestId?: string; error?: string }[],
  seller = 'openai',
): Promise<void> {
  const workspace = newWorkspace()
  const job = await addJob(workspace)
  const first = Date.now() - THREE_DAYS - calls.length * 60_000
  await db.insert(aiCalls).values(
    calls.map(({ cost, seconds, state = 'done', requestId, error }, index) => {
      const startedAt = new Date(first + index * 60_000)
      return {
        id: newId(),
        jobId: job,
        workspaceId: workspace,
        callIndex: index,
        try: 1,
        attempt: 1,
        feature: 'calls',
        function: fn,
        preset: name,
        kind: 'text' as const,
        model: PRESET.model,
        seller,
        state,
        sellerRequestId: requestId ?? null,
        error: error ?? null,
        realCost: cost,
        startedAt,
        endedAt: new Date(startedAt.getTime() + seconds * 1000),
      }
    }),
  )
}

describe('presetNumbers', () => {
  it('gives a preset with no done call its first guess', async () => {
    const fn = newFunction()
    expect(await presetNumbers(db, fn, 'new', PRESET)).toEqual({ cost: 5_000_000n, seconds: 50, calls: 0 })
    // Another preset's calls are not this one's.
    await logCalls(fn, 'other', [{ cost: 9_000_000n, seconds: 90 }])
    expect(await presetNumbers(db, fn, 'new', PRESET)).toEqual({ cost: 5_000_000n, seconds: 50, calls: 0 })
  })

  it('gives the highest cost and seconds seen while a preset has fewer than 20 done calls', async () => {
    const fn = newFunction()
    await logCalls(fn, 'few', [
      { cost: 1_000_000n, seconds: 12.2 },
      { cost: 3_000_000n, seconds: 8 },
      { cost: 2_000_000n, seconds: 30.4 },
    ])
    expect(await presetNumbers(db, fn, 'few', PRESET)).toEqual({ cost: 3_000_000n, seconds: 31, calls: 3 })
  })

  it('gives the 95th percentile of the latest 200 from 20 done calls on', async () => {
    const twenty = newFunction()
    // Costs ₹1 to ₹20 and 1 to 20 s: 19 of the 20 stay at or under the 19th.
    await logCalls(
      twenty,
      'many',
      Array.from({ length: 20 }, (_, i) => ({ cost: BigInt(i + 1) * 1_000_000n, seconds: i + 1 })),
    )
    expect(await presetNumbers(db, twenty, 'many', PRESET)).toEqual({ cost: 19_000_000n, seconds: 19, calls: 20 })

    const old = newFunction()
    // 50 old dear calls, then 200 newer ones of ₹1 and 1 s: only the latest 200 count.
    await logCalls(old, 'many', [
      ...Array.from({ length: 50 }, () => ({ cost: 99_000_000n, seconds: 99 })),
      ...Array.from({ length: 200 }, () => ({ cost: 1_000_000n, seconds: 1 })),
    ])
    expect(await presetNumbers(db, old, 'many', PRESET)).toEqual({ cost: 1_000_000n, seconds: 1, calls: 200 })
  })

  it('leaves out calls that failed, were cut off or unknown, replayed calls, and calls no seller of ours made', async () => {
    const fn = newFunction()
    await logCalls(fn, 'mixed', [
      { cost: 8_000_000n, seconds: 80, state: 'failed' },
      { cost: 8_000_000n, seconds: 80, state: 'unknown' },
      { cost: 0n, seconds: 1, requestId: 'replayed:round-plan/call-0' },
    ])
    expect(await presetNumbers(db, fn, 'mixed', PRESET)).toEqual({ cost: 5_000_000n, seconds: 50, calls: 0 })
    // A seller that is none of ours, as a test's own.
    await logCalls(fn, 'mixed', [{ cost: 7_000_000n, seconds: 70 }], 'test-seller')
    expect(await presetNumbers(db, fn, 'mixed', PRESET)).toEqual({ cost: 5_000_000n, seconds: 50, calls: 0 })
    await logCalls(fn, 'mixed', [{ cost: 2_000_000n, seconds: 20, requestId: 'resp_123' }])
    expect(await presetNumbers(db, fn, 'mixed', PRESET)).toEqual({ cost: 2_000_000n, seconds: 20, calls: 1 })
  })
})

describe('presetMeasured', () => {
  it('gives a preset with no call its first guess, and no done call, cut-off or failure', async () => {
    const fn = newFunction()
    expect(await presetMeasured(db, fn, 'new', PRESET)).toEqual({
      cost: 5_000_000n,
      seconds: 50,
      calls: 0,
      done: 0,
      cutOffs: 0,
      failures: 0,
    })
  })

  it('counts the done calls, the cut-offs and the other failures beside the cost and seconds the hold and the wait use', async () => {
    const fn = newFunction()
    await logCalls(fn, 'mixed', [
      { cost: 2_000_000n, seconds: 20 },
      { cost: 4_000_000n, seconds: 9.5 },
      { cost: 1_000_000n, seconds: 3, state: 'failed', error: CUT_OFF },
      { cost: 0n, seconds: 1, state: 'failed', error: 'refused: 400' },
      { cost: 0n, seconds: 1, state: 'failed' },
      { cost: 0n, seconds: 1, state: 'unknown' },
      { cost: 0n, seconds: 1, state: 'running' },
    ])
    // Another preset's calls, a replayed call and a call no seller of ours made are none of its own.
    await logCalls(fn, 'other', [{ cost: 9_000_000n, seconds: 90, state: 'failed', error: CUT_OFF }])
    await logCalls(fn, 'mixed', [
      { cost: 0n, seconds: 1, requestId: 'replayed:round-plan/call-0' },
      { cost: 0n, seconds: 1, state: 'failed', requestId: 'replayed:round-plan/call-1' },
    ])
    await logCalls(fn, 'mixed', [{ cost: 7_000_000n, seconds: 70 }], 'test-seller')
    const measured = await presetMeasured(db, fn, 'mixed', PRESET)
    expect(measured).toEqual({ cost: 4_000_000n, seconds: 20, calls: 2, done: 2, cutOffs: 1, failures: 2 })
    expect(measured).toMatchObject(await presetNumbers(db, fn, 'mixed', PRESET))
  })

  it('counts every done call, past the latest 200 the cost and seconds are taken from', async () => {
    const fn = newFunction()
    await logCalls(
      fn,
      'many',
      Array.from({ length: 205 }, () => ({ cost: 1_000_000n, seconds: 1 })),
    )
    expect(await presetMeasured(db, fn, 'many', PRESET)).toMatchObject({ calls: 200, done: 205 })
  })
})
