// The step list: every AI step runs through a test seller and holds more than nothing, and a step added
// to the list runs with no other change.
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { aiKindModels, type Db, modelSellers, newId, type Tx } from '@dazbee/db'
import { AI_STEPS, type CallInput, type CallKind } from '@dazbee/schema'

import { callAi } from './call.ts'
import { useSeller } from './sellers/seller.ts'
import { testSeller } from './sellers/test-sellers.ts'
import { holdFor, modelKinds, PICTURE_INPUT_TOKENS, routeStep, stepDef, STEPS, unpricedSellers } from './steps.ts'
import {
  addJob,
  addPrices,
  addStep,
  db,
  DOLLAR,
  memoryFiles,
  newSeller,
  newWorkspace,
  type TestPrice,
} from './test-ai.ts'

/** Ends a test's transaction, carrying what it read out of it. */
class Rollback extends Error {
  readonly models: Record<string, string>

  constructor(models: Record<string, string>) {
    super('rolled back')
    this.models = models
  }
}

/** A call of each kind. */
const INPUTS: Record<CallKind, CallInput> = {
  text: { kind: 'text', instructions: 'Read the ad.', prompt: 'A coffee ad.', pictures: [] },
  picture: { kind: 'picture', prompt: 'A cup of coffee on a table.', pictures: [], width: 1024, height: 1024 },
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

describe('routeStep', () => {
  it('runs each step’s own model, or else its kind’s default, which a change of the default reaches', async () => {
    const models = async (tx: Db | Tx) =>
      Object.fromEntries(await Promise.all(AI_STEPS.map(async (step) => [step, (await routeStep(tx, step, [])).model])))
    expect(await models(db)).toEqual({
      'flow.round-plan': 'gpt-6-luna',
      'flow.read': 'gpt-6-luna',
      'flow.draft-fast': 'muse-image-1.0',
      'flow.draft-precise': 'gpt-image-2.5-sunburst',
      'flow.refine': 'seedream-5.5',
      'flow.resize': 'seedream-5.5',
      'flow.layer-plan': 'gpt-6.2-sol',
      'flow.layer-split': 'ming-image-0.1-design-layer',
    })
    const added = `flow.test-${newId()}`
    STEPS[added] = { kind: 'picture', expected: () => ({ picture: 1 }) }
    try {
      expect((await routeStep(db, added, [])).model).toBe('muse-image-1.0')
      // Changed in a transaction that is rolled back, as other tests read the same defaults.
      const changed = await db
        .transaction(async (tx) => {
          await tx.update(aiKindModels).set({ model: 'test-picture-model' }).where(eq(aiKindModels.kind, 'picture'))
          throw new Rollback(await models(tx))
        })
        .catch((e: unknown) => (e instanceof Rollback ? e.models : Promise.reject(e)))
      expect(changed).toMatchObject({
        'flow.draft-fast': 'test-picture-model',
        'flow.draft-precise': 'gpt-image-2.5-sunburst',
        'flow.refine': 'seedream-5.5',
        'flow.resize': 'seedream-5.5',
        'flow.read': 'gpt-6-luna',
      })
    } finally {
      Reflect.deleteProperty(STEPS, added)
    }
  })
})

describe('stepDef', () => {
  it('gives a step’s entry, and fails for a step not in the list', () => {
    expect(stepDef('flow.read').kind).toBe('text')
    expect(() => stepDef('no-such-step')).toThrow('no AI step no-such-step')
  })
})

describe('modelKinds', () => {
  it('reads a model’s kind from the units it is priced in', () => {
    expect(modelKinds(['picture'])).toEqual(['picture'])
    expect(modelKinds(['input-token', 'image-input-token', 'image-output-token'])).toEqual(['picture'])
    expect(modelKinds(['gpu-second', 'cpu-core-second', 'memory-gib-second'])).toEqual(['layer-split'])
    expect(modelKinds(['input-token', 'cached-input-token', 'output-token'])).toEqual(['text'])
    expect(modelKinds(['reference-picture'])).toEqual([])
    expect(modelKinds([])).toEqual([])
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
  it('holds a quarter more than the expected cost at the dearest seller', async () => {
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

  it('counts reference pictures in a picture hold, as each seller bills them', async () => {
    const perPicture = newSeller('per-picture')
    const inTokens = newSeller('in-tokens')
    await addPrices(perPicture, 'seedream-5.5', EVERY_PRICE)
    await addPrices(inTokens, 'seedream-5.5', [
      ...EVERY_PRICE,
      { unit: 'image-input-token', pricePerMillion: 8_000_000n },
    ])
    const draft: CallInput = { kind: 'picture', prompt: 'A cup.', pictures: [], width: 1024, height: 1024 }
    const four: CallInput = { ...draft, pictures: ['a', 'b', 'c'], marks: 'm' }
    const hold = (sellers: string[], input: CallInput) => holdFor(db, [{ step: 'flow.refine', input, sellers }])
    const plain = await hold([perPicture], draft)
    const referenced = await hold([perPicture], four)
    // Four references (three pictures and the marked copy) at US$0.01 each, at ₹96.31, times 1.25.
    expect(referenced - plain).toBe((4n * DOLLAR * 5n) / 4n / 100n)
    // GPT Image's way: PICTURE_INPUT_TOKENS image input tokens a reference, at US$8 a million.
    const tokens = (4n * BigInt(PICTURE_INPUT_TOKENS) * 8n * DOLLAR * 5n) / 4n / 1_000_000n
    // Within a millionth of a rupee: each hold is rounded once.
    expect(Number((await hold([inTokens], four)) - referenced - tokens)).toBeLessThanOrEqual(1)
    expect(Number((await hold([inTokens], four)) - referenced - tokens)).toBeGreaterThanOrEqual(-1)
  })

  it('holds a picture call at the dearest seller in its model’s order, each counting the units it reports', async () => {
    const input: CallInput = {
      kind: 'picture',
      prompt: 'Put the logo on the cup.',
      pictures: ['a', 'b', 'c', 'd'],
      width: 1024,
      height: 1024,
    }
    const at = (sellers?: string[]) => holdFor(db, [{ step: 'flow.refine', input, ...(sellers ? { sellers } : {}) }])
    // Seedream with 4 references: ZenMux bills the picture alone, OpenRouter each reference too, with its fee.
    const [all, zenmux, openrouter, pixazo] = await Promise.all([
      at(),
      at(['zenmux']),
      at(['openrouter']),
      at(['pixazo']),
    ])
    // US$0.02 at ₹96.31, times 1.25.
    expect(zenmux).toBe((20_000n * DOLLAR * 5n) / 4n / 1_000_000n)
    expect(openrouter).toBeGreaterThan(pixazo)
    expect(pixazo).toBeGreaterThan(zenmux)
    expect(all).toBe(openrouter)
  })

  it('counts a text call’s input from its own words and pictures', async () => {
    const read = (prompt: string, pictures: string[] = []) =>
      holdFor(db, [{ step: 'flow.read', input: { kind: 'text', instructions: 'Read.', prompt, pictures } }])
    const short = await read('An ad.')
    const long = await read('An ad. '.repeat(4000))
    const withPictures = await read('An ad.', ['a', 'b'])
    expect(long).toBeGreaterThan(short)
    expect(withPictures).toBeGreaterThan(short)
  })

  it('leaves out a seller with no price for a unit it reports, and fails when no seller is left', async () => {
    const priced = testSeller(newSeller('priced'))
    const unpriced = { seller: 'pixazo', prices: [{ unit: 'picture' as const, pricePerMillion: 1_000_000n }] }
    const both = await addStep([unpriced, { seller: priced.seller, adapter: priced, prices: EVERY_PRICE }], {
      kind: 'picture',
    })
    const input: CallInput = { kind: 'picture', prompt: 'A cup.', pictures: [], width: 1024, height: 1024 }
    expect(await holdFor(db, [{ step: both.step, input }])).toBeGreaterThan(0n)
    expect(await unpricedSellers(db, both.model, 'picture')).toEqual([
      { seller: 'pixazo', units: ['reference-picture'] },
    ])
    const alone = await addStep([unpriced], { kind: 'picture' })
    await expect(holdFor(db, [{ step: alone.step, input }])).rejects.toThrow('no seller is priced')
  })

  it('holds the layer split’s fixed amount for its size', async () => {
    const [split1024, split512] = await Promise.all([
      holdFor(db, [{ step: 'flow.layer-split', input: INPUTS['layer-split'] }]),
      holdFor(db, [{ step: 'flow.layer-split', input: { kind: 'layer-split', picture: 'test/draft', size: 512 } }]),
    ])
    expect(split1024).toBeGreaterThan(0n)
    expect(split512).toBeGreaterThan(0n)
  })
})
