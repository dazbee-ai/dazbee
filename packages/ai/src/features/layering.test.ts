// Layering with the flow seller, against Postgres from Docker Compose.
import { eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { aiCalls, assets, newId } from '@dazbee/db'
import type { LayeringInput } from '@dazbee/schema'

import { readJob } from '../jobs.ts'
import { PLANNER_PROMPT } from '../prompts/ads/layer-planner.ts'
import { READING_PROMPT } from '../prompts/ads/reading.ts'
import type { SellerRequest } from '../sellers/seller.ts'
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

/** A layering job of two sizes of `who`'s, at 1024 px. */
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
    size: 1024,
  }
}

/** Whether `request` asks for the layer plan of the picture named `name`, or of any picture with none given. */
function plans(request: SellerRequest, name?: string): boolean {
  const { input } = request
  if (input.kind !== 'text' || !input.instructions.startsWith(PLANNER_PROMPT)) return false
  return name === undefined || (input.pictures?.[0]?.endsWith(`/${name}`) ?? false)
}

/** The layer plan of the picture named `name`: the fake's plan, its prompt ending with the name. */
function planOf(name: string) {
  const plan = { ...LAYER_PLAN, prompt: `${LAYER_PLAN.prompt}\n${name}` }
  return { kind: 'text' as const, text: JSON.stringify(plan), json: plan }
}

/** What the job held, in millionths of a rupee. */
const heldBy = async (job: string) => -((await ledgerOf(job))[0]?.amount ?? 0n)

/**
 * The hold of a job of two frames at 1024 px: two layer plans and two readings at their presets' first guesses, and
 * two splits at the fixed amount for the size, times 1.25.
 */
async function twoFramesHold(): Promise<bigint> {
  const { layerSplit1024 } = await aiSettingsOf(db)
  return ((2n * 2_410_000n + 2n * 60_000n + 2n * layerSplit1024) * 5n + 3n) / 4n
}

describe('a layering job', () => {
  it('plans each frame from its own picture, then splits and reads it with that plan', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('layering'), (r) =>
      plans(r, 'square') ? planOf('square') : plans(r, 'story') ? planOf('story') : undefined,
    )
    const input = await layeringOf(who)
    const job = await saveFlow(who, { kind: 'layering', input })
    expect((await runFlow(job, flowDeps(seller))).state).toBe('done')

    const asked = seller.requests.map((r) => r.input)
    const planned = seller.requests.filter((r) => plans(r)).map((r) => r.input)
    expect(planned.map((call) => call.kind === 'text' && call.pictures).sort()).toEqual(
      input.frames.map((f) => [f.pictureKey]).sort(),
    )
    // Both plans are asked for before any split or reading.
    expect(asked.slice(0, 2).every((call) => planned.includes(call))).toBe(true)
    const splits = asked.filter((call) => call.kind === 'layer-split')
    expect(splits.map((call) => [call.picture, call.size, call.plan]).sort()).toEqual(
      ['square', 'story'].map((name) => [
        input.frames.find((f) => f.pictureKey.endsWith(name))?.pictureKey,
        1024,
        `${LAYER_PLAN.prompt}\n${name}`,
      ]),
    )
    const reads = asked.filter((call) => call.kind === 'text' && call.instructions === READING_PROMPT)
    expect(reads.map((call) => call.kind === 'text' && call.pictures).sort()).toEqual(
      input.frames.map((f) => [f.pictureKey]).sort(),
    )
    for (const read of reads)
      expect(read.kind === 'text' && read.prompt).toContain('t1 (x 100–900, y 80–200 of 999): "Fresh coffee"')
    const calls = (await readJob(db, who.workspace, job))?.calls ?? []
    expect(calls.map((call) => [call.index, call.function])).toEqual([
      [0, 'layer-plan'],
      [1, 'layer-split'],
      [2, 'reading'],
      [3, 'layer-split'],
      [4, 'reading'],
      [41, 'layer-plan'],
    ])
    expect(await chargedCalls(job)).toEqual([0, 1, 2, 3, 4, 41])
    const layers = calls.flatMap((call) =>
      call.state === 'done' && call.output.kind === 'layers' ? call.output.layers : [],
    )
    expect(layers).toHaveLength(4)
    for (const layer of layers) expect((await assetRow(layer.assetId ?? '')).tags).toEqual(['ai-part'])
  })

  it('holds each frame’s plan, its split at its fixed amount and its reading', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('layering-hold'))
    const job = await saveFlow(who, { kind: 'layering', input: await layeringOf(who) })
    await runFlow(job, flowDeps(seller))

    expect(await heldBy(job)).toBe(await twoFramesHold())
  })

  it('splits without readings when the plans have no text', async () => {
    const who = await flowWorkspace()
    const noText = { ...LAYER_PLAN, elements: LAYER_PLAN.elements.filter((element) => element.kind !== 'text') }
    const seller = await flowSeller(newSeller('no-text'), (r) =>
      plans(r) ? { kind: 'text', text: JSON.stringify(noText), json: noText } : undefined,
    )
    const job = await saveFlow(who, { kind: 'layering', input: await layeringOf(who) })
    expect((await runFlow(job, flowDeps(seller))).state).toBe('done')
    expect(await chargedCalls(job)).toEqual([0, 1, 3, 41])
    // No reading was made, and the hold still covered both.
    const made = await db.select({ index: aiCalls.callIndex }).from(aiCalls).where(eq(aiCalls.jobId, job))
    expect(made.map((call) => call.index).sort((a, b) => a - b)).toEqual([0, 1, 3, 41])
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

    expect(await chargedCalls(job)).toEqual([0, 2, 4, 41])
    expect(await db.select().from(assets).where(eq(assets.brandId, who.brand))).toEqual([])
  })

  it('fails with nothing charged when every plan fails', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('layer-plan-fails'), (r) =>
      r.input.kind === 'text' ? 'fail' : undefined,
    )
    const job = await saveFlow(who, { kind: 'layering', input: await layeringOf(who) })
    expect((await runFlow(job, flowDeps(seller))).state).toBe('failed')
    expect(seller.requests.filter((r) => r.input.kind === 'layer-split')).toEqual([])
    expect(await chargedCalls(job)).toEqual([])
  })

  it('finishes the frames that have a plan when another frame’s plan fails', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('one-plan-fails'), (r) => (plans(r, 'story') ? 'fail' : undefined))
    const input = await layeringOf(who)
    const job = await saveFlow(who, { kind: 'layering', input })
    expect((await runFlow(job, flowDeps(seller))).state).toBe('done')

    // The square frame's plan, split and reading; the story frame gets no split and no reading.
    const splits = seller.requests.flatMap((r) => (r.input.kind === 'layer-split' ? [r.input.picture] : []))
    expect(splits).toEqual([input.frames[0]?.pictureKey])
    expect(await chargedCalls(job)).toEqual([0, 1, 2])
  })

  it('fails a job of one frame whose plan can’t be read', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('one-frame-no-plan'), (r) =>
      plans(r) ? { kind: 'text', text: '{}', json: {} } : undefined,
    )
    const input = await layeringOf(who)
    const job = await saveFlow(who, { kind: 'layering', input: { ...input, frames: input.frames.slice(0, 1) } })
    expect((await runFlow(job, flowDeps(seller))).state).toBe('failed')
    expect(seller.requests.filter((r) => r.input.kind === 'layer-split')).toEqual([])
  })

  it('runs a job saved with the plan picture a job once named', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('stored-plan-key'))
    const input = await layeringOf(who)
    const stored = { ...input, planKey: `workspaces/${who.workspace}/originals/draft` } as LayeringInput
    const job = await saveFlow(who, { kind: 'layering', input: stored })
    expect((await runFlow(job, flowDeps(seller))).state).toBe('done')
    expect(seller.requests.filter((r) => plans(r, 'draft'))).toEqual([])
  })
})
