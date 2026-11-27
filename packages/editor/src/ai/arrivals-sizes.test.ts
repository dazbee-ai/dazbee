import { afterEach, describe, expect, it } from 'vitest'

import { childrenOf } from '@dazbee/doc'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { FRAME_GAP, pictureLayerOf, sectionsOf } from '@dazbee/schema'

import { WORDS } from '../test-actions.ts'
import { editorLayeringFinish } from './layering-finish.ts'
import { fakeAi } from './test-ai.ts'
import { BRIEF, endTabs, fillsOf, pictureOf, pollAll, serve, settle, tabOn } from './test-arrivals.ts'

afterEach(endTabs)

const ck = await loadCanvasKit()

/** A 512 px split layer, opaque all over, as PNG bytes. */
function splitLayer(): Uint8Array {
  const surface = ck.MakeSurface(512, 512)
  if (!surface) throw new Error('no surface')
  surface.getCanvas().clear(ck.Color(20, 120, 200, 1))
  const image = surface.makeImageSnapshot()
  const png = image.encodeToBytes()
  image.delete()
  surface.delete()
  if (!png) throw new Error('no PNG')
  return png
}

const SIZES = [
  { width: 1080, height: 1920, name: 'Story' },
  { width: 1200, height: 628, name: 'Link image' },
]

describe('editorArrivals', () => {
  describe('otherSizes', () => {
    it('redraws a draft at each size, in a section of its frames right of the draft’s section, joined to it, as no undo step', async () => {
      serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      ai.make('job1', 0, 'pic1')
      await pollAll(a)

      const started = await a.arrivals.otherSizes({ frameId: 'ann-1', sizes: SIZES, title: 'Draft 1 sizes' })
      await settle(a.arrivals)

      expect(started).toEqual({ ok: true, job: 'job2', sectionId: 'ann-8' })
      expect(ai.started[1]).toMatchObject({
        kind: 'resize',
        frameId: 'ann-1',
        pictureAssetId: 'pic1',
        sectionId: 'ann-8',
        sizes: [
          { frameId: 'ann-6', pictureLayerId: pictureLayerOf('ann-6'), width: 1080, height: 1920 },
          { frameId: 'ann-7', pictureLayerId: pictureLayerOf('ann-7'), width: 1200, height: 628 },
        ],
      })
      const design = a.editor.session.design()
      const story = design.frames['ann-6']
      expect(story).toMatchObject({ name: 'Story', width: 1080, height: 1920, sectionId: 'ann-8' })
      expect(design.frames['ann-7']).toMatchObject({ name: 'Link image', x: (story?.x ?? 0) + 1080 + FRAME_GAP })
      expect(sectionsOf(design, 'p1').map(([, s]) => s.title)).toContain('Draft 1 sizes')
      expect(Object.values(design.connectors)).toMatchObject([{ from: 'ann-1', to: 'ann-8' }])
      expect(a.editor.core.canUndo()).toBe(false)

      ai.makeCall('job2', 1, 'wide')
      await pollAll(a)
      expect(fillsOf(a.editor.session.design(), 'ann-7')).toEqual(pictureOf('wide'))
    })
  })

  describe('makeAllEditable', () => {
    it('makes the sizes editable from one plan, their layers of the same split layer linked across the sizes', async () => {
      serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      const stop = new AbortController()
      const finish = editorLayeringFinish({
        session: a.editor.session,
        ai,
        ck,
        holder: 'ann-holder',
        read: a.arrivals.read,
        onRead: a.arrivals.onRead,
        after: () => () => {},
        readyPictures: a.editor.modules.resources.prepareImages,
        arrive: a.arrivals.land,
        poll: a.arrivals.poll,
        signal: stop.signal,
      })
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      ai.make('job1', 0, 'pic1')
      await pollAll(a)
      await a.arrivals.otherSizes({ frameId: 'ann-1', sizes: SIZES, title: 'Draft 1 sizes' })
      await settle(a.arrivals)
      ai.makeCall('job2', 0, 'tall')
      ai.makeCall('job2', 1, 'wide')
      await pollAll(a)

      expect((await a.arrivals.makeAllEditable(['ann-6', 'ann-7'], 'pic1')).ok).toBe(true)
      expect(ai.started[2]).toEqual({
        kind: 'layering',
        designId: 'd',
        frames: [
          { frameId: 'ann-6', pictureAssetId: 'tall' },
          { frameId: 'ann-7', pictureAssetId: 'wide' },
        ],
        planAssetId: 'pic1',
      })
      ai.split('job3', 0, [splitLayer(), splitLayer()])
      ai.split('job3', 1, [splitLayer(), splitLayer()])
      for (let n = 0; n < 3; n++) {
        await pollAll(a)
        await finish.settled()
      }

      const design = a.editor.session.design()
      const links = (frameId: string) =>
        childrenOf(design, frameId)
          .filter(([id]) => id !== pictureLayerOf(frameId))
          .map(([, layer]) => layer.link)
      expect(links('ann-6')).toHaveLength(2)
      expect(links('ann-6')).toEqual(links('ann-7'))
      stop.abort()
    })

    it('finishes a job’s sizes together, so one that fails leaves every size for the next try', async () => {
      serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      const timers: (() => void)[] = []
      const finish = editorLayeringFinish({
        session: a.editor.session,
        ai,
        ck,
        holder: 'ann-holder',
        read: a.arrivals.read,
        onRead: a.arrivals.onRead,
        after: (_ms, run) => {
          timers.push(run)
          return () => {}
        },
        readyPictures: a.editor.modules.resources.prepareImages,
        arrive: a.arrivals.land,
        poll: a.arrivals.poll,
        signal: new AbortController().signal,
      })
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      ai.make('job1', 0, 'pic1')
      await pollAll(a)
      await a.arrivals.otherSizes({ frameId: 'ann-1', sizes: SIZES, title: 'Draft 1 sizes' })
      await settle(a.arrivals)
      ai.makeCall('job2', 0, 'tall')
      ai.makeCall('job2', 1, 'wide')
      await pollAll(a)
      await a.arrivals.makeAllEditable(['ann-6', 'ann-7'], 'pic1')
      // The second size's split layer won't read the first time.
      ai.split('job3', 0, [splitLayer()])
      ai.split('job3', 1, [new Uint8Array([1, 2, 3])])
      await pollAll(a)
      await finish.settled()
      expect(ai.finishes).toEqual([])
      expect(childrenOf(a.editor.session.design(), 'ann-6')).toHaveLength(1)

      ai.split('job3', 1, [splitLayer()])
      for (const run of timers.splice(0)) run()
      await finish.settled()
      await pollAll(a)
      expect(ai.finishes).toEqual(['job3'])
      expect(childrenOf(a.editor.session.design(), 'ann-6')).toHaveLength(2)
      expect(childrenOf(a.editor.session.design(), 'ann-7')).toHaveLength(2)
    })

    it('places the sizes that read on the last try, when one size’s layers never read', async () => {
      serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      const timers: (() => void)[] = []
      const finish = editorLayeringFinish({
        session: a.editor.session,
        ai,
        ck,
        holder: 'ann-holder',
        read: a.arrivals.read,
        onRead: a.arrivals.onRead,
        after: (_ms, run) => {
          timers.push(run)
          return () => {}
        },
        readyPictures: a.editor.modules.resources.prepareImages,
        arrive: a.arrivals.land,
        poll: a.arrivals.poll,
        signal: new AbortController().signal,
      })
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      ai.make('job1', 0, 'pic1')
      await pollAll(a)
      await a.arrivals.otherSizes({ frameId: 'ann-1', sizes: SIZES, title: 'Draft 1 sizes' })
      await settle(a.arrivals)
      ai.makeCall('job2', 0, 'tall')
      ai.makeCall('job2', 1, 'wide')
      await pollAll(a)
      await a.arrivals.makeAllEditable(['ann-6', 'ann-7'], 'pic1')
      ai.split('job3', 0, [splitLayer()])
      ai.split('job3', 1, [new Uint8Array([1, 2, 3])])
      await pollAll(a)
      await finish.settled()
      for (let n = 0; n < 2; n++) {
        for (const run of timers.splice(0)) run()
        await finish.settled()
      }
      await pollAll(a)
      expect(ai.finishes).toEqual(['job3'])
      expect(childrenOf(a.editor.session.design(), 'ann-6')).toHaveLength(2)
      expect(childrenOf(a.editor.session.design(), 'ann-7')).toHaveLength(1)
    })

    it('starts nothing when a size shows no picture, and other sizes start nothing on a frame that shows none', async () => {
      serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      expect((await a.arrivals.makeAllEditable(['ann-1', 'ann-2'], 'pic1')).ok).toBe(false)
      expect((await a.arrivals.otherSizes({ frameId: 'ann-1', sizes: SIZES, title: 'x' })).ok).toBe(false)
      expect(ai.started).toHaveLength(1)
    })
  })
})
