// Layering with the flow seller, against Postgres from Docker Compose.
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { assets, newId } from '@dazbee/db'
import type { CallInput, LayeringInput } from '@dazbee/schema'

import { readJob } from '../jobs.ts'
import { PLANNER_PROMPT } from '../prompts/ads/layer-planner.ts'
import { READING_PROMPT } from '../prompts/ads/reading.ts'
import { holdFor } from '../steps.ts'
import { db, newSeller, pngOf } from '../test-ai.ts'
import {
  assetRow,
  chargedCalls,
  flowDeps,
  flowSeller,
  type FlowWorkspace,
  flowWorkspace,
  LAYER_PLAN,
  ledgerOf,
  roundOf,
  runFlow,
  saveFlow,
} from './test-flow.ts'

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

describe('a layering job', () => {
  it('plans once from the draft, then splits and reads each size with the plan', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('layering'))
    const input = await layeringOf(who)
    const job = await saveFlow(who, { kind: 'layering', input })
    expect((await runFlow(job, flowDeps(seller))).state).toBe('done')

    const [plan, ...rest] = seller.requests.map((r) => r.input)
    expect(plan).toMatchObject({ kind: 'text', instructions: PLANNER_PROMPT, pictures: [input.planKey] })
    const splits = rest.filter((call) => call.kind === 'layer-split')
    expect(splits.map((call) => call.picture).sort()).toEqual(input.frames.map((f) => f.pictureKey).sort())
    for (const split of splits) expect(split).toMatchObject({ size: 1024, plan: LAYER_PLAN.prompt })
    const reads = rest.filter((call) => call.kind === 'text')
    expect(reads).toHaveLength(2)
    for (const read of reads) {
      expect(read).toMatchObject({ instructions: READING_PROMPT })
      expect(read.kind === 'text' && read.prompt).toContain('t1 (x 100–900, y 80–200 of 999): "Fresh coffee"')
    }
    const calls = (await readJob(db, who.workspace, job))?.calls ?? []
    expect(calls.map((call) => [call.index, call.step])).toEqual([
      [0, 'flow.layer-plan'],
      [1, 'flow.layer-split'],
      [2, 'flow.read'],
      [3, 'flow.layer-split'],
      [4, 'flow.read'],
    ])
    expect(await chargedCalls(job)).toEqual([0, 1, 2, 3, 4])
    const layers = calls.flatMap((call) =>
      call.state === 'done' && call.output.kind === 'layers' ? call.output.layers : [],
    )
    expect(layers).toHaveLength(4)
    for (const layer of layers) expect((await assetRow(layer.assetId ?? '')).tags).toEqual(['ai-part'])
  })

  it('holds its calls, the readings with no blocks yet, and covers what it charges', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('layering-hold'))
    const job = await saveFlow(who, { kind: 'layering', input: await layeringOf(who) })
    await runFlow(job, flowDeps(seller))

    const steps = { text: 'flow.read', 'layer-split': 'flow.layer-split', picture: '' } as const
    const made = seller.requests.map((r, i) => ({
      step: i === 0 ? 'flow.layer-plan' : steps[r.input.kind],
      input: r.input as CallInput,
    }))
    const held = -((await ledgerOf(job))[0]?.amount ?? 0n)
    // The readings' blocks come from the plan, so each reading holds its prompt without them: under 1% less.
    expect(Number(held)).toBeGreaterThan(Number(await holdFor(db, made)) * 0.99)
    expect(Number(held)).toBeLessThanOrEqual(Number(await holdFor(db, made)))
  })

  it('splits without readings when the plan has no text', async () => {
    const who = await flowWorkspace()
    const noText = { ...LAYER_PLAN, elements: LAYER_PLAN.elements.filter((element) => element.kind !== 'text') }
    const seller = await flowSeller(newSeller('no-text'), (r) =>
      r.input.kind === 'text' && r.input.instructions.startsWith(PLANNER_PROMPT)
        ? { kind: 'text', text: JSON.stringify(noText), json: noText }
        : undefined,
    )
    const job = await saveFlow(who, { kind: 'layering', input: await layeringOf(who) })
    expect((await runFlow(job, flowDeps(seller))).state).toBe('done')
    expect(await chargedCalls(job)).toEqual([0, 1, 3])
  })

  it('keeps no asset of a split whose layers can’t all be recorded, and charges nothing for it', async () => {
    const who = await flowWorkspace()
    const good = { bytes: await pngOf(16, 16, [0, 0, 0, 255]), type: 'image/png', width: 16, height: 16 }
    const bad = { bytes: new Uint8Array(8), type: 'image/png', width: 16, height: 16 }
    const seller = await flowSeller(newSeller('bad-layer'), (r) =>
      r.input.kind === 'layer-split' ? { kind: 'layers', layers: [good, bad], gpuSeconds: 17.5 } : undefined,
    )
    const job = await saveFlow(who, { kind: 'layering', input: await layeringOf(who) })
    await runFlow(job, flowDeps(seller))

    expect(await chargedCalls(job)).toEqual([0, 2, 4])
    expect(await db.select().from(assets).where(eq(assets.brandId, who.brand))).toEqual([])
  })

  it('fails with nothing charged when its plan fails', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('layer-plan-fails'), (r) =>
      r.input.kind === 'text' ? 'fail' : undefined,
    )
    const job = await saveFlow(who, { kind: 'layering', input: await layeringOf(who) })
    expect((await runFlow(job, flowDeps(seller))).state).toBe('failed')
    expect(seller.requests.filter((r) => r.input.kind === 'layer-split')).toEqual([])
    expect(await chargedCalls(job)).toEqual([])
  })
})
