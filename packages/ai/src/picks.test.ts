// The presets a mode uses, with picks counted in. Each case adds its picks in a transaction it rolls back, so no
// other test file ever reads them.
import { describe, expect, it } from 'vitest'

import { aiPicks, type Tx } from '@dazbee/db'

import { NO_MODE, presetsFor } from './picks.ts'
import { db } from './test-ai.ts'

/** Thrown to roll a case's transaction back. */
class RolledBack extends Error {}

/** Runs `use` in a transaction that is rolled back; what it gave. */
async function rolledBack<T>(use: (tx: Tx) => Promise<T>): Promise<T> {
  let result: T | undefined
  await db
    .transaction(async (tx) => {
      result = await use(tx)
      throw new RolledBack()
    })
    .catch((error: unknown) => {
      if (!(error instanceof RolledBack)) throw error
    })
  return result as T
}

/** Adds a pick as an admin would. */
const pick = (tx: Tx, fn: string, mode: string, preset: string) =>
  tx.insert(aiPicks).values({ function: fn, mode, preset, setBy: 'admin' })

describe('presetsFor', () => {
  it('gives each mode the modes list’s presets, and every other function its default', async () => {
    const fast = await rolledBack((tx) => presetsFor(tx, 'fast'))
    const precise = await rolledBack((tx) => presetsFor(tx, 'precise'))
    expect(fast['round-plan']).toBe('light-luna')
    expect(precise['round-plan']).toBe('full-terra')
    expect(fast).toMatchObject({ draft: 'gpt-image-medium', resize: 'seedream', 'layer-split': 'ming' })
    expect({ ...precise, 'round-plan': '' }).toEqual({ ...fast, 'round-plan': '' })
    // With no mode, a function a mode changes runs its default.
    expect((await rolledBack((tx) => presetsFor(tx, null)))['round-plan']).toBe('light-luna')
  })

  it('gives a mode its newest pick, for that mode alone', async () => {
    const read = await rolledBack(async (tx) => {
      await pick(tx, 'round-plan', 'precise', 'light-luna')
      const picked = { precise: await presetsFor(tx, 'precise'), fast: await presetsFor(tx, 'fast') }
      await pick(tx, 'round-plan', 'precise', 'full-terra')
      return { ...picked, back: await presetsFor(tx, 'precise') }
    })
    expect(read.precise['round-plan']).toBe('light-luna')
    expect(read.fast['round-plan']).toBe('light-luna')
    expect(read.back['round-plan']).toBe('full-terra')
  })

  it('runs the code’s own choice when the newest pick names a preset the code doesn’t have', async () => {
    const read = await rolledBack(async (tx) => {
      // An earlier pick the code has, then a newer one it lacks: the earlier one doesn't come back.
      await pick(tx, 'round-plan', 'precise', 'light-luna')
      await pick(tx, 'round-plan', 'precise', 'gone-preset')
      return presetsFor(tx, 'precise')
    })
    expect(read['round-plan']).toBe('full-terra')
  })

  it('reads a function no mode changes under no mode, whatever mode is asked for', async () => {
    const read = await rolledBack(async (tx) => {
      // A pick kept under a mode for a function no mode changes is never read.
      await pick(tx, 'draft', 'fast', 'gone-preset')
      await pick(tx, 'draft', NO_MODE, 'gpt-image-medium')
      return presetsFor(tx, 'fast')
    })
    expect(read.draft).toBe('gpt-image-medium')
  })
})
