// Layering with the flow seller, against Postgres from Docker Compose.
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { aiCalls, assets, newId } from '@dazbee/db'
import type { LayeringInput } from '@dazbee/schema'

import { readJob } from '../jobs.ts'
import { PLANNER_PROMPT } from '../prompts/ads/layer-planner.ts'
import { READING_PROMPT } from '../prompts/ads/reading.ts'
import { aiSettingsOf } from '../settings.ts'
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
} from './test-features.ts'

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

/** What the job held, in millionths of a rupee. */
const heldBy = async (job: string) => -((await ledgerOf(job))[0]?.amount ?? 0n)

/**
 * The hold of a job of two frames at 1024 px: the layer plan and two readings at their presets' first guesses, and
 * two splits at the fixed amount for the size, times 1.25.
 */
async function twoFramesHold(): Promise<bigint> {
  const { layerSplit1024 } = await aiSettingsOf(db)
  return ((3_980_000n + 2n * 60_000n + 2n * layerSplit1024) * 5n + 3n) / 4n
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
    expect(calls.map((call) => [call.index, call.function])).toEqual([
      [0, 'layer-plan'],
      [1, 'layer-split'],
      [2, 'reading'],
      [3, 'layer-split'],
      [4, 'reading'],
    ])
    expect(await chargedCalls(job)).toEqual([0, 1, 2, 3, 4])
    const layers = calls.flatMap((call) =>
      call.state === 'done' && call.output.kind === 'layers' ? call.output.layers : [],
    )
    expect(layers).toHaveLength(4)
    for (const layer of layers) expect((await assetRow(layer.assetId ?? '')).tags).toEqual(['ai-part'])
  })

  it('holds its plan, and each frame’s split at its fixed amount and its reading', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('layering-hold'))
    const job = await saveFlow(who, { kind: 'layering', input: await layeringOf(who) })
    await runFlow(job, flowDeps(seller))

    expect(await heldBy(job)).toBe(await twoFramesHold())
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
    // No reading was made, and the hold still covered both.
    const made = await db.select({ index: aiCalls.callIndex }).from(aiCalls).where(eq(aiCalls.jobId, job))
    expect(made.map((call) => call.index).sort()).toEqual([0, 1, 3])
    expect(await heldBy(job)).toBe(await twoFramesHold())
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
