import { afterEach, describe, expect, it } from 'vitest'

import { type Design, FRAME_GAP, pictureLayerOf, sectionsOf, WAITING_FILL } from '@dazbee/schema'

import { outlineRoom } from '../canvas/sections.ts'
import { WORDS } from '../test-actions.ts'
import type { MemorySync } from '../test-link.ts'
import { POLL_MS, POLL_WAITING_MS } from './arrivals.ts'
import { fakeAi } from './test-ai.ts'
import {
  ANN,
  BOB,
  BRIEF,
  endTabs,
  fillsOf,
  MARK,
  pictureOf,
  pollAll,
  serve,
  settle,
  tabOn,
  VIC,
} from './test-arrivals.ts'

let mem: MemorySync

afterEach(endTabs)

describe('editorArrivals', () => {
  describe('startBrief', () => {
    it('starts the round with ids it made, then places its section and four waiting frames below everything, as no undo step', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      // A person's step before the brief.
      a.editor.session.run('node.rename', { id: 'a', name: 'Mine' })

      const started = await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)

      expect(started).toEqual({ ok: true, job: 'job1', sectionId: 'ann-5' })
      const [job] = ai.started
      expect(job).toMatchObject({ kind: 'round', designId: 'd', sectionId: 'ann-5', mode: 'fast', pictures: [] })
      const design = a.editor.session.design()
      const frameIds = job?.kind === 'round' ? job.frames.map((f) => f.frameId) : []
      expect(frameIds).toEqual(['ann-1', 'ann-2', 'ann-3', 'ann-4'])
      // The lowest frame is the square, 1080 high; the leftmost starts at 0.
      expect(frameIds.map((id) => design.frames[id])).toMatchObject(
        [0, 1, 2, 3].map((n) => ({
          name: `Draft ${n + 1}`,
          x: n * (1080 + FRAME_GAP),
          y: 1080 + Math.ceil(FRAME_GAP + outlineRoom(1)),
          width: 1080,
          height: 1080,
          sectionId: 'ann-5',
        })),
      )
      expect(sectionsOf(design, 'p1').map(([, s]) => s.title)).toEqual(['Diwali serum sale'])
      expect(design.nodes[pictureLayerOf('ann-1')]).toMatchObject({
        type: 'graphic',
        name: 'Picture',
        parentId: 'ann-1',
        props: { x: 0, y: 0, width: 1080, height: 1080, fills: [WAITING_FILL] },
      })
      // Undo takes back the rename before the brief, and leaves the brief.
      expect(a.editor.core.undoName()).toBe('rename')
      a.editor.core.perform('undo')
      await settle(a.arrivals)
      expect(a.editor.session.design().nodes.a?.name).not.toBe('Mine')
      expect(Object.keys(a.editor.session.design().frames)).toHaveLength(6)
      expect(a.editor.core.canUndo()).toBe(false)
    })

    it('places a brief far enough below for its outline and title at the zoom the page is seen at', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai, 'ann', ANN, { zoom: 0.1 })
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      // At 10 %, the labels' screen room takes ten times as many design pixels, the outlines' four times, as at 25 %.
      expect(a.editor.session.design().frames['ann-1']?.y).toBe(1080 + Math.ceil(FRAME_GAP + outlineRoom(0.1)))
    })

    it('places nothing when the job is refused, and says why', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      const before = a.editor.session.design()
      ai.refuseNext('used-up')

      await expect(a.arrivals.startBrief(BRIEF)).resolves.toEqual({
        ok: false,
        refusal: 'used-up',
        message: 'refused: used-up',
      })
      await settle(a.arrivals)
      expect(a.editor.session.design()).toEqual(before)
    })

    it('says a saved job whose section the design didn’t take is not placed, and places nothing', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      const before = a.editor.session.design()

      await expect(a.arrivals.startBrief({ ...BRIEF, pageId: 'gone' })).resolves.toMatchObject({
        ok: false,
        refusal: null,
        notPlaced: true,
      })
      await settle(a.arrivals)
      expect(ai.started).toHaveLength(1)
      expect(a.editor.session.design()).toEqual(before)
    })

    it('places a brief started while a drag is open once the drag ends, outside its undo step', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      const drag = a.editor.session.beginGesture()
      a.editor.session.run('node.update', { ids: ['a'], patch: { x: 140 } })
      const started = a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      expect(a.editor.session.design().frames['ann-1']).toBeUndefined()
      drag.end()
      await expect(started).resolves.toMatchObject({ ok: true })
      await settle(a.arrivals)
      expect(a.editor.session.design().frames['ann-1']).toBeDefined()
      a.editor.core.perform('undo')
      await settle(a.arrivals)
      expect(a.editor.session.design().nodes.a?.props).toMatchObject({ x: 100 })
      expect(a.editor.session.design().frames['ann-1']).toBeDefined()
    })
  })

  describe('moreLikeThis', () => {
    it('starts more like a draft with its brief and the picture it shows, then places four frames right of its section, joined to it, as no undo step', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      await a.arrivals.startBrief({ ...BRIEF, pictures: ['bike'], mode: 'precise' })
      await settle(a.arrivals)
      const like = { frameId: 'ann-1', title: 'More like Draft 1', draftName: (n: number) => `Like ${n + 1}` }
      // A draft still waiting shows no picture to take after.
      expect((await a.arrivals.moreLikeThis(like)).ok).toBe(false)
      ai.make('job1', 0, 'pic1')
      await pollAll(a)

      const started = await a.arrivals.moreLikeThis(like)
      await settle(a.arrivals)

      expect(started).toEqual({ ok: true, job: 'job2', sectionId: 'ann-10' })
      expect(ai.started[1]).toMatchObject({ kind: 'more-like-this', likedAssetId: 'pic1', pictures: ['bike'] })
      expect(ai.started[1]).toMatchObject({ words: BRIEF.words, mode: 'precise', size: BRIEF.size })
      const design = a.editor.session.design()
      const liked = design.frames['ann-1']
      expect(design.frames['ann-6']).toMatchObject({ name: 'Like 1', sectionId: 'ann-10', y: liked?.y })
      expect(design.frames['ann-6']?.x).toBeGreaterThan((design.frames['ann-4']?.x ?? 0) + 1080)
      expect(design.sections['ann-10']?.title).toBe('More like Draft 1')
      expect(Object.values(design.connectors)).toMatchObject([{ from: 'ann-1', to: 'ann-10' }])
      expect(a.editor.core.canUndo()).toBe(false)
    })
  })

  describe('poll', () => {
    it('writes each picture made into its frame once, marks it written, and leaves it to no undo', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      a.editor.session.run('node.rename', { id: 'a', name: 'Mine' })
      ai.make('job1', 0, 'pic1')

      await pollAll(a)

      expect(fillsOf(a.editor.session.design(), 'ann-1')).toEqual(pictureOf('pic1'))
      expect(fillsOf(a.editor.session.design(), 'ann-2')).toEqual([WAITING_FILL])
      expect(ai.marks).toEqual([{ frameId: 'ann-1', jobId: 'job1', callIndex: 1 }])
      expect(a.editor.core.undoName()).toBe('rename')
      a.editor.core.perform('undo')
      await settle(a.arrivals)
      expect(a.editor.session.design().nodes.a?.name).not.toBe('Mine')
      expect(fillsOf(a.editor.session.design(), 'ann-1')).toEqual(pictureOf('pic1'))
      // Read again, the call marked written is written no more.
      await pollAll(a)
      expect(ai.marks).toHaveLength(1)
    })

    it('fills a frame from two tabs as one picture, with no refusal told', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const [a, b] = [await tabOn(ai), await tabOn(ai, 'bob', BOB)]
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals, b.arrivals)
      ai.make('job1', 2, 'pic3')

      // Both read before either has marked the call.
      await Promise.all([a.arrivals.poll(), b.arrivals.poll()])
      await settle(a.arrivals, b.arrivals)

      for (const tab of [a, b]) {
        expect(fillsOf(tab.editor.session.design(), 'ann-3')).toEqual(pictureOf('pic3'))
        expect(tab.editor.told.filter(([notice]) => notice === 'rejected')).toEqual([])
      }
      expect(new Set(ai.marks.map((m) => m.frameId))).toEqual(new Set(['ann-3']))
    })

    it('leaves a frame deleted before its picture arrives deleted, and waits on it no more', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      for (const id of ['ann-1', 'ann-2', 'ann-3']) a.editor.session.run('frame.delete', { frameId: id })
      ai.make('job1', 0, 'pic1')

      await pollAll(a)

      expect(a.editor.session.design().frames['ann-1']).toBeUndefined()
      expect(a.editor.session.design().nodes[pictureLayerOf('ann-1')]).toBeUndefined()
      expect(ai.marks).toEqual([])
      expect(a.arrivals.waiting()).toEqual(['ann-4'])
      // An undo that brings the frame back lets its picture arrive.
      a.editor.core.perform('undo')
      await pollAll(a)
      expect(fillsOf(a.editor.session.design(), 'ann-3')).toEqual([WAITING_FILL])
      a.editor.core.perform('undo')
      a.editor.core.perform('undo')
      await pollAll(a)
      expect(fillsOf(a.editor.session.design(), 'ann-1')).toEqual(pictureOf('pic1'))
    })

    it('fills the frames of a round from the API in a tab opened after the tab that started it closed', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      a.end()
      for (const n of [0, 1, 2, 3]) ai.make('job1', n, `pic${n + 1}`)

      const b = await tabOn(ai, 'bob', BOB)
      await settle(b.arrivals)

      for (const n of [1, 2, 3, 4]) expect(fillsOf(b.editor.session.design(), `ann-${n}`)).toEqual(pictureOf(`pic${n}`))
      expect(ai.marks).toHaveLength(4)
    })

    it('fills a brief a colleague started in a tab that was open before it', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const [a, b] = [await tabOn(ai), await tabOn(ai, 'bob', BOB)]
      await a.arrivals.startBrief(BRIEF)
      a.end()
      await settle(b.arrivals)
      ai.make('job1', 1, 'pic2')
      // b reads again when its 10 s are up.
      expect(b.timer()?.ms).toBe(POLL_MS)
      b.timer()?.run()
      await settle(b.arrivals)
      expect(fillsOf(b.editor.session.design(), 'ann-2')).toEqual(pictureOf('pic2'))
    })

    it('marks a stored picture whose mark failed on the next read, without writing it over a version put back', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      const kept = JSON.parse(JSON.stringify(a.editor.session.design())) as Design
      ai.make('job1', 0, 'pic1')
      ai.failNextMark()
      await pollAll(a)
      expect(ai.marks).toEqual([])
      await a.editor.core.restoreVersion(kept, MARK)
      await settle(a.arrivals)

      await pollAll(a)

      expect(ai.marks).toEqual([{ frameId: 'ann-1', jobId: 'job1', callIndex: 1 }])
      expect(fillsOf(a.editor.session.design(), 'ann-1')).toEqual([WAITING_FILL])
    })

    it('keeps the waiting fill until the picture is ready to draw, then writes the picture', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      let bring = () => {}
      const fetched: string[][] = []
      const readyPictures = (ids: readonly string[]) => {
        fetched.push([...ids])
        return new Promise<void>((resolve) => {
          bring = resolve
        })
      }
      const a = await tabOn(ai, 'ann', ANN, { readyPictures })
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      ai.make('job1', 0, 'pic1')
      await a.arrivals.poll()
      await mem.settle()
      expect(fetched).toEqual([['pic1']])
      expect(fillsOf(a.editor.session.design(), 'ann-1')).toEqual([WAITING_FILL])
      bring()
      await settle(a.arrivals)
      expect(fillsOf(a.editor.session.design(), 'ann-1')).toEqual(pictureOf('pic1'))
    })

    it('writes no picture while the tab is offline, so none waits in its queue to land later', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      let online = false
      const a = await tabOn(ai, 'ann', ANN, { connected: () => online })
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      ai.make('job1', 0, 'pic1')
      await pollAll(a)
      expect(fillsOf(a.editor.session.design(), 'ann-1')).toEqual([WAITING_FILL])
      expect(ai.marks).toEqual([])
      online = true
      await pollAll(a)
      expect(fillsOf(a.editor.session.design(), 'ann-1')).toEqual(pictureOf('pic1'))
      expect(ai.marks).toHaveLength(1)
    })

    it('marks a picture its design shows only once its queue is stored', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      ai.make('job1', 0, 'pic1')
      ai.failNextMark()
      await pollAll(a)
      a.end()
      let stored = false
      const b = await tabOn(ai, 'bob', BOB, { synced: () => stored })
      await pollAll(b)
      expect(ai.marks).toEqual([])
      stored = true
      await pollAll(b)
      expect(ai.marks).toEqual([{ frameId: 'ann-1', jobId: 'job1', callIndex: 1 }])
    })

    it('waits on no frame whose picture layer is deleted, and leaves the frame as it is', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      a.editor.session.run('node.delete', { ids: [pictureLayerOf('ann-1')] })
      ai.make('job1', 0, 'pic1')
      await pollAll(a)
      expect(a.arrivals.waiting()).toEqual(['ann-2', 'ann-3', 'ann-4'])
      expect(a.editor.session.design().nodes[pictureLayerOf('ann-1')]).toBeUndefined()
      expect(ai.marks).toEqual([])
    })

    it('keeps a picture the person put in the waiting layer, and marks the call written', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      a.editor.session.run('node.update', {
        ids: [pictureLayerOf('ann-1')],
        patch: { fills: [{ type: 'image', assetId: 'dropped', fit: 'fill' }] },
      })
      ai.make('job1', 0, 'pic1')
      await pollAll(a)
      expect(fillsOf(a.editor.session.design(), 'ann-1')).toEqual(pictureOf('dropped'))
      expect(ai.marks).toEqual([{ frameId: 'ann-1', jobId: 'job1', callIndex: 1 }])
    })

    it('keeps a picture that arrived after a version was put back when the put-back is undone', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      const kept = JSON.parse(JSON.stringify(a.editor.session.design())) as Design
      // A picture arrives, then a version from before it is put back, then the frame's next call fills it again.
      ai.make('job1', 0, 'pic1')
      await pollAll(a)
      await expect(a.editor.core.restoreVersion(kept, MARK)).resolves.toBe('restored')
      await settle(a.arrivals)
      expect(fillsOf(a.editor.session.design(), 'ann-1')).toEqual([WAITING_FILL])
      const again = ai.again('ann-1')
      ai.makeCall(again, 0, 'pic9')
      ai.make('job1', 1, 'pic2')
      await pollAll(a)
      expect(fillsOf(a.editor.session.design(), 'ann-1')).toEqual(pictureOf('pic9'))

      a.editor.core.perform('undo')
      await settle(a.arrivals)

      // The undo of the put-back leaves what arrived after it.
      expect(fillsOf(a.editor.session.design(), 'ann-1')).toEqual(pictureOf('pic9'))
      expect(fillsOf(a.editor.session.design(), 'ann-2')).toEqual(pictureOf('pic2'))
    })

    it('leaves a version put back over a picture as it is when the design is opened again', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      const kept = JSON.parse(JSON.stringify(a.editor.session.design())) as Design
      ai.make('job1', 0, 'pic1')
      await pollAll(a)
      await a.editor.core.restoreVersion(kept, MARK)
      await settle(a.arrivals)
      a.end()

      const b = await tabOn(ai, 'bob', BOB)
      await settle(b.arrivals)

      expect(fillsOf(b.editor.session.design(), 'ann-1')).toEqual([WAITING_FILL])
      expect(ai.marks).toHaveLength(1)
    })

    it('reads every 3 s while a frame waits, every 10 s once none does, and not while the tab is hidden', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      expect(a.timer()?.ms).toBe(POLL_MS)
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      expect(a.timer()?.ms).toBe(POLL_WAITING_MS)

      a.show(false)
      expect(a.timer()).toBeNull()
      const reads = ai.reads()
      a.show(true)
      await settle(a.arrivals)
      expect(ai.reads()).toBe(reads + 1)

      for (const n of [0, 1, 2, 3]) ai.make('job1', n, `pic${n + 1}`)
      a.timer()?.run()
      await settle(a.arrivals)
      expect(a.arrivals.waiting()).toEqual([])
      expect(a.timer()?.ms).toBe(POLL_MS)
    })

    it('neither reads nor writes in a tab that may only view the design', async () => {
      mem = serve(WORDS)
      const ai = fakeAi()
      const a = await tabOn(ai)
      await a.arrivals.startBrief(BRIEF)
      await settle(a.arrivals)
      ai.make('job1', 0, 'pic1')
      const reads = ai.reads()

      const viewer = await tabOn(ai, 'viewer', VIC)
      await pollAll(viewer)

      expect(ai.reads()).toBe(reads)
      expect(fillsOf(viewer.editor.session.design(), 'ann-1')).toEqual([WAITING_FILL])
    })
  })
})
