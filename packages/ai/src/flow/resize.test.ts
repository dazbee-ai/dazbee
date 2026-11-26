// Other sizes with the flow seller, against Postgres from Docker Compose.
import { describe, expect, it } from 'vitest'

import { newId } from '@dazbee/db'
import type { CallInput, ResizeInput } from '@dazbee/schema'

import { readJob } from '../jobs.ts'
import { holdFor } from '../seller-route.ts'
import { db, newSeller } from '../test-ai.ts'
import {
  assetRow,
  chargedCalls,
  flowDeps,
  flowSeller,
  flowWorkspace,
  ledgerOf,
  roundOf,
  runFlow,
  saveFlow,
} from './test-flow.ts'

/** The prompt of a picture request. */
const promptOf = (input: CallInput) => (input.kind === 'picture' ? input.prompt : '')

describe('a resize', () => {
  it('redraws the picture once per size with the stand-in instruction, holding and charging each', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('resize'))
    const round = await roundOf(who)
    const sized = (width: number, height: number) => ({ frameId: newId(), pictureLayerId: newId(), width, height })
    const input: ResizeInput = {
      brandId: who.brand,
      designId: round.designId,
      briefId: round.briefId,
      sectionId: newId(),
      pictureKey: `workspaces/${who.workspace}/originals/draft`,
      sizes: [sized(1080, 1080), sized(1080, 1350)],
    }
    const job = await saveFlow(who, { kind: 'resize', input })
    expect((await runFlow(job, flowDeps(seller))).state).toBe('done')

    const made = seller.requests.map((r) => r.input)
    expect(made.map(promptOf).sort()).toEqual([
      'The same ad, re-laid out as a portrait 4:5 image.',
      'The same ad, re-laid out as a square image.',
    ])
    for (const call of made) expect(call).toMatchObject({ pictures: [input.pictureKey] })
    const steps = made.map((call) => ({ step: 'flow.resize', input: call }))
    expect((await ledgerOf(job))[0]?.amount).toBe(-(await holdFor(db, steps)))
    expect(await chargedCalls(job)).toEqual([0, 1])
    const calls = (await readJob(db, who.workspace, job))?.calls ?? []
    for (const call of calls) {
      const picture = call.state === 'done' && call.output.kind === 'pictures' ? call.output.pictures[0] : null
      expect((await assetRow(picture?.assetId ?? '')).tags).toEqual(['ai'])
    }
  })

  it('ends done with the other sizes when one size fails, charging only those made', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('one-size-fails'), (r) =>
      promptOf(r.input).includes('portrait') ? 'fail' : undefined,
    )
    const round = await roundOf(who)
    const input: ResizeInput = {
      brandId: who.brand,
      designId: round.designId,
      sectionId: newId(),
      pictureKey: `workspaces/${who.workspace}/originals/draft`,
      sizes: [
        { frameId: newId(), pictureLayerId: newId(), width: 1080, height: 1080 },
        { frameId: newId(), pictureLayerId: newId(), width: 1080, height: 1920 },
      ],
    }
    const job = await saveFlow(who, { kind: 'resize', input })
    expect((await runFlow(job, flowDeps(seller))).state).toBe('done')
    expect(await chargedCalls(job)).toEqual([0])
  })
})
