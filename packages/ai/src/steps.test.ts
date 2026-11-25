// The step list: every AI step runs through a test seller and holds more than nothing, and a step added
// to the list runs with no other change.
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { modelSellers } from '@dazbee/db'
import { AI_STEPS, type CallInput, type CallKind } from '@dazbee/schema'

import { callAi } from './call.ts'
import { useSeller } from './sellers/seller.ts'
import { testSeller } from './sellers/test-sellers.ts'
import { holdFor, routeStep, stepDef } from './steps.ts'
import { addJob, addPrices, addStep, db, memoryFiles, newSeller, newWorkspace, type TestPrice } from './test-ai.ts'

/** A call of each kind. */
const INPUTS: Record<CallKind, CallInput> = {
  text: { kind: 'text', instructions: 'Read the ad.', prompt: 'A coffee ad.', pictures: [] },
  picture: { kind: 'picture', prompt: 'A cup of coffee on a table.', width: 1024, height: 1024 },
  'picture-edit': {
    kind: 'picture-edit',
    prompt: 'Make it square.',
    pictures: ['test/draft'],
    width: 1080,
    height: 1080,
  },
  'layer-split': { kind: 'layer-split', picture: 'test/draft', size: 1024 },
}

/** A price for every unit a step's usage can name. */
const EVERY_PRICE: TestPrice[] = [
  { unit: 'input-token', pricePerMillion: 1_000_000n },
  { unit: 'output-token', pricePerMillion: 2_000_000n },
  { unit: 'image-output-token', pricePerMillion: 40_000_000n },
  { unit: 'picture', pricePerMillion: 40_000_000_000n },
  { unit: 'reference-picture', pricePerMillion: 10_000_000_000n },
  { unit: 'gpu-second', pricePerMillion: 1_097_000_000n },
]

describe('STEPS', () => {
  it('runs every AI step through a test seller, each holding more than nothing', async () => {
    const seller = testSeller(newSeller('every'))
    useSeller(seller)
    const workspace = newWorkspace()
    const priced = new Set<string>()
    for (const step of AI_STEPS) {
      const { model } = await routeStep(db, step, [])
      if (!priced.has(model)) await addPrices(seller.seller, model, EVERY_PRICE)
      priced.add(model)
      const input = INPUTS[stepDef(step).kind]
      expect(await holdFor(db, [{ step, input }], { sellers: [seller.seller] })).toBeGreaterThan(0n)
      const job = { id: await addJob(workspace), workspaceId: workspace }
      const signal = new AbortController().signal
      const call = {
        job,
        attempt: 1,
        callIndex: 0,
        step,
        input,
        signal,
        sellers: [seller.seller],
        files: memoryFiles(),
      }
      const output = await callAi(db, call)
      expect(output.kind).toBe(input.kind === 'text' ? 'text' : input.kind === 'layer-split' ? 'layers' : 'pictures')
    }
    expect(seller.requests).toHaveLength(AI_STEPS.length)
  })

  it('runs a test-only step added to the list with no other change', async () => {
    const seller = testSeller(newSeller('new'))
    const { step } = await addStep([seller])
    const workspace = newWorkspace()
    expect(await holdFor(db, [{ step, input: INPUTS.text }])).toBeGreaterThan(0n)
    const job = { id: await addJob(workspace), workspaceId: workspace }
    const output = await callAi(db, {
      job,
      attempt: 1,
      callIndex: 0,
      step,
      input: INPUTS.text,
      signal: new AbortController().signal,
    })
    expect(output).toEqual({ kind: 'text', text: 'test answer' })
  })
})

describe('stepDef', () => {
  it('gives a step’s entry, and fails for a step not in the list', () => {
    expect(stepDef('read').kind).toBe('text')
    expect(() => stepDef('no-such-step')).toThrow('no AI step no-such-step')
  })
})

describe('routeStep', () => {
  it('gives the step’s model and the sellers that can take it, in order, skipping one with no adapter or price', async () => {
    const first = testSeller(newSeller('a'))
    const second = testSeller(newSeller('b'))
    const { step, model } = await addStep([first, { seller: newSeller('gone') }, second])
    const route = await routeStep(db, step)
    expect(route.model).toBe(model)
    expect(route.sellers.map((s) => s.seller)).toEqual([first.seller, second.seller])
    expect((await routeStep(db, step, [second.seller])).sellers.map((s) => s.seller)).toEqual([second.seller])
    await db.update(modelSellers).set({ sellerModel: 'its-own-name' }).where(eq(modelSellers.seller, second.seller))
    expect((await routeStep(db, step, [second.seller])).sellers[0]?.sellerModel).toBe('its-own-name')
  })
})

describe('holdFor', () => {
  it('holds a quarter more than the expected cost at the first seller', async () => {
    const first = testSeller(newSeller('a'))
    const second = testSeller(newSeller('b'))
    const { step } = await addStep([first, { seller: second.seller, adapter: second, prices: EVERY_PRICE }])
    // 1,000 input tokens and 500 output tokens at US$1 and US$2 a million, at ₹96.31: ₹0.19262, times 1.25.
    expect(await holdFor(db, [{ step, input: INPUTS.text }])).toBe(240_775n)
  })

  it('prices a hold from the price list alone, with no seller’s adapter in use', async () => {
    const { step } = await addStep([{ seller: newSeller('keyless'), prices: EVERY_PRICE }])
    expect(await holdFor(db, [{ step, input: INPUTS.text }])).toBe(240_775n)
  })

  it('holds the layer split’s fixed amount for its size', async () => {
    const [split1024, split512] = await Promise.all([
      holdFor(db, [{ step: 'layer-split', input: INPUTS['layer-split'] }]),
      holdFor(db, [{ step: 'layer-split', input: { kind: 'layer-split', picture: 'test/draft', size: 512 } }]),
    ])
    expect(split1024).toBeGreaterThan(0n)
    expect(split512).toBeGreaterThan(0n)
  })
})
