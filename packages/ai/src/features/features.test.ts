// Every AI feature in the features list, run whole with the flow seller against Postgres from Docker Compose: the
// calls it makes, its hold, its charges and its estimate all follow from its one declaration.
import { asc, eq } from 'drizzle-orm'
import { describe, expect, it } from 'vitest'

import { aiCalls, aiJobs, newId } from '@dazbee/db'
import { AI_FEATURES, AiEstimateQuery, type AiFeature, type AiFeatureInput } from '@dazbee/schema'

import { layerSize } from '../ledger.ts'
import { db, memoryFiles, newSeller, pngOf } from '../test-ai.ts'
import { actionHold, estimateAction, featureSeconds } from './estimate.ts'
import { FEATURES } from './features.ts'
import { featureCalls, holdOf } from './holds.ts'
import { ROUND_CALL } from './round.ts'
import {
  chargedCalls,
  flowDeps,
  flowSeller,
  type FlowWorkspace,
  flowWorkspace,
  ledgerOf,
  roundOf,
  runFlow,
  saveFlow,
} from './test-features.ts'

/** A job of one feature to run, with the pictures it reads when its calls read any by their bytes. */
interface Sample {
  flow: AiFeatureInput
  files?: ReturnType<typeof memoryFiles>
}

/** A job of each AI feature. A feature added to the list needs its job here, and nothing else in this file. */
const SAMPLES: Record<AiFeature, (who: FlowWorkspace) => Promise<Sample>> = {
  round: async (who) => ({
    flow: {
      kind: 'round',
      input: await roundOf(who, { referenceKey: `workspaces/${who.workspace}/originals/reference` }),
    },
  }),
  'more-like-this': async (who) => ({
    flow: {
      kind: 'more-like-this',
      input: { ...(await roundOf(who)), likedKey: `workspaces/${who.workspace}/originals/liked` },
    },
  }),
  'try-again': async (who) => {
    const round = await roundOf(who)
    const frame = round.frames[0] ?? { frameId: newId(), pictureLayerId: newId() }
    return {
      flow: {
        kind: 'try-again',
        input: { brandId: who.brand, designId: round.designId, briefId: round.briefId, draft: 0, frame },
      },
    }
  },
  refine: async (who) => {
    const files = memoryFiles()
    const round = await roundOf(who)
    const pictureKey = await files.save(await pngOf(64, 64, [255, 255, 255, 255]), 'image/png')
    const marksKey = await files.save(await pngOf(64, 64, [0, 90, 255, 255], { quarter: true }), 'image/png')
    return {
      files,
      flow: {
        kind: 'refine',
        input: {
          brandId: who.brand,
          designId: round.designId,
          briefId: round.briefId,
          frame: { frameId: newId(), pictureLayerId: newId() },
          pictureKey,
          marksKey,
          message: 'Make 1 bigger',
          size: { width: 1080, height: 1080 },
        },
      },
    }
  },
  resize: async (who) => {
    const round = await roundOf(who)
    const sized = (width: number, height: number) => ({ frameId: newId(), pictureLayerId: newId(), width, height })
    return {
      flow: {
        kind: 'resize',
        input: {
          brandId: who.brand,
          designId: round.designId,
          briefId: round.briefId,
          sectionId: newId(),
          pictureKey: `workspaces/${who.workspace}/originals/draft`,
          sizes: [sized(1080, 1080), sized(1080, 1350), sized(1080, 1920)],
        },
      },
    }
  },
  layering: async (who) => {
    const round = await roundOf(who)
    const key = (name: string) => `workspaces/${who.workspace}/originals/${name}`
    return {
      flow: {
        kind: 'layering',
        input: {
          brandId: who.brand,
          designId: round.designId,
          briefId: round.briefId,
          frames: [
            { frameId: newId(), pictureKey: key('square') },
            { frameId: newId(), pictureKey: key('story') },
          ],
          planKey: key('draft'),
          size: await layerSize(db, who.workspace),
        },
      },
    }
  },
}

describe('FEATURES', () => {
  it('declares every AI feature, each call at a place of its own and on an AI function', () => {
    expect(Object.keys(FEATURES).sort()).toEqual([...AI_FEATURES].sort())
    for (const feature of AI_FEATURES) {
      const calls = FEATURES[feature].stages({ count: 3, reference: true, layerSize: 1024 }).flat()
      expect(calls.length, feature).toBeGreaterThan(0)
      expect(new Set(calls.map((call) => call.index)).size, feature).toBe(calls.length)
    }
  })

  for (const feature of AI_FEATURES) {
    it(`runs ${feature} from its declaration: its calls, its hold, its charges and its estimate`, async () => {
      const who = await flowWorkspace()
      const seller = await flowSeller(newSeller(feature))
      const { flow, files } = await SAMPLES[feature](who)
      const job = await saveFlow(who, flow)
      const [saved] = await db.select().from(aiJobs).where(eq(aiJobs.id, job))
      const presets = saved?.presets ?? {}
      const def = FEATURES[feature]
      const shape = def.shape(flow.input)
      const declared = def.stages(shape).flat()
      // The job keeps the preset of each AI function its calls use, and of no other.
      expect(Object.keys(presets).sort()).toEqual([...new Set(declared.map((call) => call.fn))].sort())

      expect((await runFlow(job, flowDeps(seller, files))).state).toBe('done')

      // Every call it declares is made, at its place, as its AI function with the job's preset.
      const made = await db.select().from(aiCalls).where(eq(aiCalls.jobId, job)).orderBy(asc(aiCalls.callIndex))
      expect(made.map((row) => [row.callIndex, row.feature, row.function, row.preset, row.state])).toEqual(
        declared
          .map((call) => [call.index, feature, call.fn, presets[call.fn], 'done'])
          .sort((a, b) => Number(a[0]) - Number(b[0])),
      )
      // It held its calls' presets' costs with the margin, charged each call it made once, and gave the rest back.
      const hold = await holdOf(db, featureCalls(feature, shape, presets))
      const ledger = await ledgerOf(job)
      expect(ledger[0]).toEqual({ kind: 'hold', amount: -hold, call: null })
      expect(await chargedCalls(job)).toEqual(declared.map((call) => call.index).sort((a, b) => a - b))
      const sum = (kinds: string[]) =>
        ledger.filter((row) => kinds.includes(row.kind)).reduce((total, row) => total + row.amount, 0n)
      expect(sum(['hold', 'give-back'])).toBe(0n)
      expect(sum(['charge'])).toBeLessThan(0n)

      // The estimate before the click is the hold and the wait of a job of this shape.
      const mode = 'mode' in flow.input ? flow.input.mode : 'fast'
      const query = AiEstimateQuery.parse({
        action: feature,
        mode,
        sizes: Array.from({ length: shape.count }, () => ({ width: 1080, height: 1080 })),
        reference: shape.reference,
      })
      expect(await actionHold(db, who.workspace, query)).toBe(hold)
      expect((await estimateAction(db, who.workspace, query)).seconds).toBe(
        await featureSeconds(db, feature, shape, presets),
      )
    })
  }

  it('holds and makes the reference read for a round with a reference ad, and neither without, as the estimate shows', async () => {
    const who = await flowWorkspace()
    const seller = await flowSeller(newSeller('reference'))
    const round = async (reference: boolean) => {
      const key = `workspaces/${who.workspace}/originals/reference`
      const job = await saveFlow(who, {
        kind: 'round',
        input: await roundOf(who, reference ? { referenceKey: key } : {}),
      })
      expect((await runFlow(job, flowDeps(seller))).state).toBe('done')
      const query = AiEstimateQuery.parse({ action: 'round', reference: String(reference) })
      return {
        read: (await chargedCalls(job)).includes(ROUND_CALL.referenceRead),
        hold: -((await ledgerOf(job))[0]?.amount ?? 0n),
        estimate: await actionHold(db, who.workspace, query),
        seconds: (await estimateAction(db, who.workspace, query)).seconds,
      }
    }
    const without = await round(false)
    const withOne = await round(true)
    expect([without.read, withOne.read]).toEqual([false, true])
    expect(withOne.hold).toBeGreaterThan(without.hold)
    expect([without.estimate, withOne.estimate]).toEqual([without.hold, withOne.hold])
    expect(withOne.seconds).toBeGreaterThan(without.seconds)
    // More like this reads no reference, whatever the brief has.
    const liked = (reference: boolean) =>
      actionHold(db, who.workspace, AiEstimateQuery.parse({ action: 'more-like-this', reference }))
    expect(await liked(true)).toBe(await liked(false))
  })
})
