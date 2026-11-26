// Refine with AI with the flow seller, against Postgres from Docker Compose.
import { describe, expect, it } from 'vitest'

import { newId } from '@dazbee/db'
import type { CallInput, RefineInput } from '@dazbee/schema'

import { readJob } from '../jobs.ts'
import { REFINE_EDITOR } from '../prompts/ads/refine-editor.ts'
import { holdFor } from '../seller-route.ts'
import { db, memoryFiles, newSeller, pngOf } from '../test-ai.ts'
import {
  assetRow,
  chargedCalls,
  flowDeps,
  flowSeller,
  type FlowWorkspace,
  flowWorkspace,
  ledgerOf,
  roundOf,
  runFlow,
  saveFlow,
} from './test-flow.ts'

/** A refine of a 64 px picture of `who`'s, with a marks layer when `marked`, and its pictures in memory. */
async function refineOf(who: FlowWorkspace, { marked = true }: { marked?: boolean } = {}) {
  const files = memoryFiles()
  const round = await roundOf(who)
  const pictureKey = await files.save(await pngOf(64, 64, [255, 255, 255, 255]), 'image/png')
  const marksKey = marked
    ? await files.save(await pngOf(64, 64, [0, 90, 255, 255], { quarter: true }), 'image/png')
    : undefined
  const input: RefineInput = {
    brandId: who.brand,
    designId: round.designId,
    briefId: round.briefId,
    frame: { frameId: newId(), pictureLayerId: newId() },
    pictureKey,
    message: 'Make 1 bigger',
    ...(marksKey ? { marksKey } : {}),
    size: { width: 1080, height: 1080 },
  }
  return { input, files }
}

describe('a refine', () => {
  it('plans from the ad and its marked copy, then edits the clean ad with the instruction alone', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('refine'))
    const { input, files } = await refineOf(who)
    const job = await saveFlow(who, { kind: 'refine', input })
    const ended = await runFlow(job, flowDeps(seller, files))

    expect(ended.state).toBe('done')
    const [plan, edit] = seller.requests
    expect(plan?.input).toMatchObject({ kind: 'text', instructions: REFINE_EDITOR })
    const planPictures = plan?.input.kind === 'text' ? plan.input.pictures : []
    expect(planPictures[0]).toBe(input.pictureKey)
    // The marked copy is the picture with the marks drawn over it, stored for the plan.
    expect(planPictures).toHaveLength(2)
    expect(files.saved.get(planPictures[1] ?? '')).not.toEqual(files.saved.get(input.pictureKey))
    expect(edit?.input).toEqual({
      kind: 'picture',
      prompt: 'Make the price bigger.',
      pictures: [input.pictureKey],
      width: 1024,
      height: 1024,
    })
    const made = [
      { step: 'flow.refine-plan', input: plan?.input as CallInput },
      { step: 'flow.refine', input: edit?.input as CallInput },
    ]
    expect((await ledgerOf(job))[0]?.amount).toBe(-(await holdFor(db, made)))
    expect(await chargedCalls(job)).toEqual([0, 1])
    const calls = (await readJob(db, who.workspace, job))?.calls ?? []
    const version =
      calls[1]?.state === 'done' && calls[1].output.kind === 'pictures' ? calls[1].output.pictures[0] : null
    expect(await assetRow(version?.assetId ?? '')).toMatchObject({
      tags: ['ai'],
      name: 'Harbour Coffee, fresh every morning',
    })
  })

  it('reads the ad alone when it has no marks', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('no-marks'))
    const { input, files } = await refineOf(who, { marked: false })
    await runFlow(await saveFlow(who, { kind: 'refine', input }), flowDeps(seller, files))

    expect(seller.requests[0]?.input).toMatchObject({ pictures: [input.pictureKey] })
  })

  it('fails with nothing charged and no edit made when its plan fails', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('plan-fails'), (r) => (r.input.kind === 'text' ? 'fail' : undefined))
    const { input, files } = await refineOf(who)
    const job = await saveFlow(who, { kind: 'refine', input })
    const ended = await runFlow(job, flowDeps(seller, files))

    expect(ended.state).toBe('failed')
    expect(seller.requests.filter((r) => r.input.kind === 'picture')).toEqual([])
    expect(await chargedCalls(job)).toEqual([])
  })
})
