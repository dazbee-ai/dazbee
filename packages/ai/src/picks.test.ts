// The presets a mode uses, with picks counted in, adding a pick, and an AI function's picks. Each case adds its
// picks in a transaction it rolls back, so no other test file ever reads them.
import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { aiPicks, type Tx } from '@dazbee/db'

import { addPick, NO_MODE, pickModes, PickRefused, picksOf, presetsFor, presetsInUse } from './picks.ts'
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

/** Writes a pick's row, whatever its preset, as a build whose code had that preset added it. */
const pick = (tx: Tx, fn: string, mode: string, preset: string) =>
  tx.insert(aiPicks).values({ function: fn, mode, preset, setBy: 'admin' })

/** Every row of the round plan's picks, oldest first. */
const rows = (tx: Tx) => tx.select().from(aiPicks).where(eq(aiPicks.function, 'round-plan')).orderBy(asc(aiPicks.id))

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

describe('presetsInUse', () => {
  it('gives each mode of a function a mode changes the code’s choice, and any other function its default under no mode', async () => {
    const read = await rolledBack((tx) => presetsInUse(tx))
    const code = { source: 'code', lacking: null, pickedAt: null }
    expect(read['round-plan']).toEqual([
      { mode: 'fast', preset: 'light-luna', ...code },
      { mode: 'precise', preset: 'full-terra', ...code },
    ])
    expect(read.draft).toEqual([{ mode: NO_MODE, preset: 'gpt-image-medium', ...code }])
  })

  it('says a pick chose a mode’s preset, and when, for that mode alone', async () => {
    const read = await rolledBack(async (tx) => {
      await addPick(tx, { function: 'round-plan', mode: 'precise', preset: 'light-luna', by: 'admin' })
      return { inUse: await presetsInUse(tx), kept: await rows(tx) }
    })
    expect(read.inUse['round-plan']).toEqual([
      { mode: 'fast', preset: 'light-luna', source: 'code', lacking: null, pickedAt: null },
      { mode: 'precise', preset: 'light-luna', source: 'pick', lacking: null, pickedAt: read.kept[0]?.setAt },
    ])
  })

  it('names the newest pick’s preset when the code has none by that name, and gives the code’s choice', async () => {
    const read = await rolledBack(async (tx) => {
      await addPick(tx, { function: 'round-plan', mode: 'precise', preset: 'light-luna', by: 'admin' })
      await pick(tx, 'round-plan', 'precise', 'gone-preset')
      return (await presetsInUse(tx))['round-plan']
    })
    expect(read[1]).toMatchObject({ mode: 'precise', preset: 'full-terra', source: 'code', lacking: 'gone-preset' })
    expect(read[1]?.pickedAt).toBeInstanceOf(Date)
  })
})

describe('pickModes', () => {
  it('picks a function a mode changes for each mode, and any other under no mode', () => {
    expect(pickModes('round-plan')).toEqual(['fast', 'precise'])
    expect(pickModes('draft')).toEqual([NO_MODE])
  })
})

describe('addPick', () => {
  it('adds a row and changes none, so picking an earlier preset again is a third row', async () => {
    const read = await rolledBack(async (tx) => {
      const precise = async () => (await presetsFor(tx, 'precise'))['round-plan']
      const used = [await precise()]
      await addPick(tx, { function: 'round-plan', mode: 'precise', preset: 'light-luna', by: 'ada' })
      const first = await rows(tx)
      used.push(await precise())
      await addPick(tx, { function: 'round-plan', mode: 'precise', preset: 'full-terra', by: 'bo' })
      used.push(await precise())
      await addPick(tx, { function: 'round-plan', mode: 'precise', preset: 'light-luna', by: 'ada' })
      used.push(await precise())
      return { used, first, all: await rows(tx) }
    })
    expect(read.used).toEqual(['full-terra', 'light-luna', 'full-terra', 'light-luna'])
    expect(read.all.map((row) => [row.mode, row.preset, row.setBy])).toEqual([
      ['precise', 'light-luna', 'ada'],
      ['precise', 'full-terra', 'bo'],
      ['precise', 'light-luna', 'ada'],
    ])
    // The first row is as it was added, and each pick is later than the one before it.
    expect(read.all[0]).toEqual(read.first[0])
    const times = read.all.map((row) => row.setAt.getTime())
    expect(times).toEqual([...new Set(times)].sort((a, b) => a - b))
  })

  it('keeps a pick for a function no mode changes under no mode', async () => {
    const read = await rolledBack(async (tx) => {
      await addPick(tx, { function: 'draft', mode: NO_MODE, preset: 'gpt-image-medium', by: 'admin' })
      return (await presetsInUse(tx)).draft
    })
    expect(read).toMatchObject([{ mode: NO_MODE, preset: 'gpt-image-medium', source: 'pick' }])
  })

  it('refuses a preset or an AI function the code doesn’t have, and a mode the function isn’t picked for, writing nothing', async () => {
    const read = await rolledBack(async (tx) => {
      const before = await tx.select().from(aiPicks)
      const refused: unknown[] = []
      for (const [fn, mode, preset] of [
        ['round-plan', 'precise', 'gone-preset'],
        ['round-plan', NO_MODE, 'light-luna'],
        ['round-plan', 'careful', 'light-luna'],
        ['draft', 'fast', 'gpt-image-medium'],
        ['no-function', NO_MODE, 'light-luna'],
      ] as const) {
        refused.push(await addPick(tx, { function: fn, mode, preset, by: 'admin' }).catch((error: unknown) => error))
      }
      return { refused, before, kept: await tx.select().from(aiPicks) }
    })
    for (const error of read.refused) expect(error).toBeInstanceOf(PickRefused)
    expect(read.refused.map((error) => (error as Error).message)).toEqual([
      'round-plan has no preset gone-preset',
      'round-plan is picked for one of fast, precise',
      'round-plan is picked for one of fast, precise',
      'No mode changes draft',
      'There is no AI function no-function',
    ])
    expect(read.kept).toEqual(read.before)
  })

  it('tells its check when the newest pick for the function and mode was made, and writes nothing when the check refuses', async () => {
    const read = await rolledBack(async (tx) => {
      const told: (Date | null)[] = []
      const pickPrecise = (preset: string, check?: (pickedAt: Date | null) => void) =>
        addPick(tx, { function: 'round-plan', mode: 'precise', preset, by: 'admin' }, check)
      await pickPrecise('light-luna', (pickedAt) => told.push(pickedAt))
      // A pick for another mode is not this mode's newest.
      await addPick(tx, { function: 'round-plan', mode: 'fast', preset: 'full-terra', by: 'admin' })
      await pickPrecise('full-terra', (pickedAt) => told.push(pickedAt))
      const refused = await pickPrecise('light-luna', () => {
        throw new Error('changed meanwhile')
      }).catch((error: Error) => error.message)
      return { told, refused, kept: await rows(tx) }
    })
    const precise = read.kept.filter((row) => row.mode === 'precise')
    expect(read.told).toEqual([null, precise[0]?.setAt])
    expect(read.refused).toBe('changed meanwhile')
    expect(precise.map((row) => row.preset)).toEqual(['light-luna', 'full-terra'])
  })
})

describe('picksOf', () => {
  it('gives an AI function’s picks in every mode, the newest first, with who made each and when', async () => {
    const read = await rolledBack(async (tx) => {
      await addPick(tx, { function: 'round-plan', mode: 'precise', preset: 'light-luna', by: 'ada' })
      await addPick(tx, { function: 'round-plan', mode: 'fast', preset: 'full-terra', by: 'bo' })
      await addPick(tx, { function: 'draft', mode: NO_MODE, preset: 'gpt-image-medium', by: 'ada' })
      await addPick(tx, { function: 'round-plan', mode: 'precise', preset: 'full-terra', by: 'bo' })
      return { all: await picksOf(tx, 'round-plan', 10), newest: await picksOf(tx, 'round-plan', 2) }
    })
    expect(read.all.map(({ mode, preset, setBy }) => ({ mode, preset, setBy }))).toEqual([
      { mode: 'precise', preset: 'full-terra', setBy: 'bo' },
      { mode: 'fast', preset: 'full-terra', setBy: 'bo' },
      { mode: 'precise', preset: 'light-luna', setBy: 'ada' },
    ])
    for (const kept of read.all) expect(kept.setAt).toBeInstanceOf(Date)
    expect(read.newest).toEqual(read.all.slice(0, 2))
  })
})
