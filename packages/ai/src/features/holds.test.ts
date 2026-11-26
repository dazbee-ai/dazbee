// What a job's calls hold: each preset's cost, or its AI function's fixed charge, with the hold's margin.
import { describe, expect, it } from 'vitest'

import { aiCalls, newId } from '@dazbee/db'

import { testSeller } from '../sellers/test-sellers.ts'
import { aiSettingsOf } from '../settings.ts'
import { addFunction, addJob, db, newSeller, newWorkspace, TEST_PRESET, TOKEN_PRICES } from '../test-ai.ts'
import { holdOf } from './holds.ts'

/** Logs one done call of the test preset of `fn` that cost `cost` millionths, three days ago. */
async function logCall(fn: string, cost: bigint): Promise<void> {
  const workspace = newWorkspace()
  const startedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
  await db.insert(aiCalls).values({
    id: newId(),
    jobId: await addJob(workspace),
    workspaceId: workspace,
    callIndex: 0,
    try: 1,
    attempt: 1,
    function: fn,
    preset: TEST_PRESET,
    model: 'test-model',
    seller: 'openai',
    state: 'done',
    realCost: cost,
    startedAt,
    endedAt: new Date(startedAt.getTime() + 2000),
  })
}

describe('holdOf', () => {
  it('holds a quarter more than its calls’ presets cost: the first guess, then what the preset’s calls measured', async () => {
    const sold = () => [testSeller(newSeller('hold'))]
    const plan = await addFunction(sold(), { guess: { cost: 400_000n, seconds: 10 } })
    const draft = await addFunction(sold(), { kind: 'picture', guess: { cost: 1_000_000n, seconds: 20 } })
    const calls = [
      { fn: plan.fn, preset: TEST_PRESET },
      ...Array.from({ length: 4 }, () => ({ fn: draft.fn, preset: TEST_PRESET })),
    ]
    // ₹0.40 and four times ₹1, times 1.25.
    expect(await holdOf(db, calls)).toBe(5_500_000n)
    await logCall(draft.fn, 1_200_000n)
    expect(await holdOf(db, calls)).toBe(6_500_000n)
    // A margin that doesn't come out whole is rounded up.
    expect(await holdOf(db, [{ fn: plan.fn, preset: TEST_PRESET }])).toBe(500_000n)
    await logCall(plan.fn, 3n)
    expect(await holdOf(db, [{ fn: plan.fn, preset: TEST_PRESET }])).toBe(4n)
  })

  it('holds the layer split’s fixed amount for its size, whatever its preset’s calls cost', async () => {
    const settings = await aiSettingsOf(db)
    const split = (size: 512 | 1024) => ({
      fn: 'layer-split',
      preset: 'ming',
      input: { kind: 'layer-split' as const, picture: 'test/draft', size },
    })
    const margin = (amount: bigint) => (amount * 5n + 3n) / 4n
    expect(await holdOf(db, [split(1024)])).toBe(margin(settings.layerSplit1024))
    expect(await holdOf(db, [split(512)])).toBe(margin(settings.layerSplit512))
  })

  it('fails for a preset the code doesn’t have, and for one whose model no seller is priced for', async () => {
    await expect(holdOf(db, [{ fn: 'draft', preset: 'gone-preset' }])).rejects.toThrow(
      'the AI function draft has no preset gone-preset',
    )
    const unsold = await addFunction([])
    await expect(holdOf(db, [{ fn: unsold.fn, preset: TEST_PRESET }])).rejects.toThrow('no seller is priced')
    // A seller priced at the standard tier alone can't take a preset that asks for the fast one.
    const standard = await addFunction(
      [{ seller: 'openai', prices: [...TOKEN_PRICES, { unit: 'cached-input-token', pricePerMillion: 100_000n }] }],
      { settings: { tier: 'fast' } },
    )
    await expect(holdOf(db, [{ fn: standard.fn, preset: TEST_PRESET }])).rejects.toThrow('no seller is priced')
  })
})
