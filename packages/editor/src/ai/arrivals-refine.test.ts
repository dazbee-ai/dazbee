import { afterEach, describe, expect, it } from 'vitest'

import { WORDS } from '../test-actions.ts'
import { fakeAi } from './test-ai.ts'
import { BRIEF, endTabs, fillsOf, pictureOf, pollAll, serve, settle, tabOn } from './test-arrivals.ts'

afterEach(endTabs)

describe('editorArrivals', () => {
  describe('refine', () => {
    it('refines the picture a draft shows, and writes its new version into the layer once, as no undo step', async () => {
      serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      ai.make('job1', 0, 'pic1')
      await pollAll(a)
      // A person's step before the refine.
      a.editor.session.run('node.rename', { id: 'a', name: 'Mine' })

      const started = await a.arrivals.refine({
        frameId: 'ann-1',
        pictureLayerId: 'ann-1-picture',
        message: 'Make the price bigger',
        marksAssetId: 'marks1',
      })
      await settle(a.arrivals)

      expect(started).toEqual({ ok: true, job: 'job2' })
      expect(ai.started[1]).toMatchObject({
        kind: 'refine',
        frameId: 'ann-1',
        pictureLayerId: 'ann-1-picture',
        pictureAssetId: 'pic1',
        message: 'Make the price bigger',
        marksAssetId: 'marks1',
        size: { width: 1080, height: 1080 },
      })
      // While its new version is on its way, the frame waits.
      expect(a.arrivals.waiting()).toContain('ann-1')
      ai.makeCall('job2', 1, 'pic2')
      await pollAll(a)
      expect(fillsOf(a.editor.session.design(), 'ann-1')).toEqual(pictureOf('pic2'))
      expect(ai.marks.at(-1)).toEqual({ frameId: 'ann-1', jobId: 'job2', callIndex: 1 })
      expect(a.arrivals.read()?.refines[0]?.resultAssetId).toBe('pic2')
      expect(a.arrivals.waiting()).not.toContain('ann-1')

      // Undo takes back the rename, and leaves the new version.
      a.editor.core.perform('undo')
      await settle(a.arrivals)
      expect(fillsOf(a.editor.session.design(), 'ann-1')).toEqual(pictureOf('pic2'))
      // A version put back once the new one is marked stays: the refine is written no more.
      a.editor.session.run('node.update', {
        ids: ['ann-1-picture'],
        patch: { fills: [{ type: 'image', assetId: 'pic1', fit: 'fill' }] },
      })
      await pollAll(a)
      expect(fillsOf(a.editor.session.design(), 'ann-1')).toEqual(pictureOf('pic1'))
    })

    it('starts nothing on a layer that shows no picture', async () => {
      serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      const started = await a.arrivals.refine({ frameId: 'ann-1', pictureLayerId: 'ann-1-picture', message: 'x' })
      expect(started.ok).toBe(false)
      expect(ai.started).toHaveLength(1)
    })
  })
})
