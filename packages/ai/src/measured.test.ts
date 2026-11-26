// A preset's cost and seconds, from its first guess to what its own done calls measured.
import { describe, expect, it } from 'vitest'

import { aiCalls, newId } from '@dazbee/db'
import type { AiFunction, CallState } from '@dazbee/schema'

import type { Preset } from './functions/types.ts'
import { presetNumbers } from './measured.ts'
import { addJob, db, newWorkspace } from './test-ai.ts'

/** A preset guessed at ₹5 and 50 s. */
const PRESET: Preset = { model: 'test-model', settings: {}, guess: { cost: 5_000_000n, seconds: 50 } }

/** A function name no other test uses, read as an AI function. */
const newFunction = () => `test-function-${newId()}` as AiFunction

/** Three days, in milliseconds. */
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000

/**
 * Logs calls of `fn`'s preset `name`, each of `cost` millionths and `seconds`, the first given the oldest. They
 * start three days ago, so they never count towards today's spending stop, which every test's jobs share.
 */
async function logCalls(
  fn: AiFunction,
  name: string,
  calls: { cost: bigint; seconds: number; state?: CallState; requestId?: string }[],
): Promise<void> {
  const workspace = newWorkspace()
  const job = await addJob(workspace)
  const first = Date.now() - THREE_DAYS - calls.length * 60_000
  await db.insert(aiCalls).values(
    calls.map(({ cost, seconds, state = 'done', requestId }, index) => {
      const startedAt = new Date(first + index * 60_000)
      return {
        id: newId(),
        jobId: job,
        workspaceId: workspace,
        callIndex: index,
        try: 1,
        attempt: 1,
        step: 'test-step',
        function: fn,
        preset: name,
        model: PRESET.model,
        seller: 'test-seller',
        state,
        sellerRequestId: requestId ?? null,
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

  it('leaves out calls that failed, were cut off or unknown, and calls replayed from an AI recording', async () => {
    const fn = newFunction()
    await logCalls(fn, 'mixed', [
      { cost: 8_000_000n, seconds: 80, state: 'failed' },
      { cost: 8_000_000n, seconds: 80, state: 'unknown' },
      { cost: 0n, seconds: 1, requestId: 'replayed:round-plan/call-0' },
    ])
    expect(await presetNumbers(db, fn, 'mixed', PRESET)).toEqual({ cost: 5_000_000n, seconds: 50, calls: 0 })
    await logCalls(fn, 'mixed', [{ cost: 2_000_000n, seconds: 20, requestId: 'resp_123' }])
    expect(await presetNumbers(db, fn, 'mixed', PRESET)).toEqual({ cost: 2_000_000n, seconds: 20, calls: 1 })
  })
})
