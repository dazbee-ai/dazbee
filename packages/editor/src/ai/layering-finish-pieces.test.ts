// The finish of frames whose split cut split pieces.
import { afterEach, describe, expect, it } from 'vitest'

import { childrenOf } from '@dazbee/doc'
import { pictureLayerOf } from '@dazbee/schema'

import { WORDS } from '../test-actions.ts'
import type { EditorAi } from './arrivals.ts'
import { fakeAi } from './test-ai.ts'
import { endTabs, pollAll, serve } from './test-arrivals.ts'
import {
  cut,
  cutOf,
  element,
  finished,
  finishing,
  madeEditable,
  NO_PICTURE,
  placed,
  PLAN,
  planOf,
  settleAll,
  sizesMadeEditable,
  splitLayer,
} from './test-layering-finish.ts'

afterEach(endTabs)

describe('editorLayeringFinish', () => {
  it('places a layer per split piece over the hidden picture, the backdrop at the bottom, reading and uploading no file', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const a = await finishing(ai)
    await madeEditable(ai, a)
    const pieces = cutOf(
      1024,
      1024,
      cut('e1', 'text', 100, 50, 200, 100),
      cut(null, 'other', 10, 900, 40, 40),
      cut('e2', 'background', 0, 0, 1024, 1024),
    )
    ai.split('job2', 0, [NO_PICTURE, NO_PICTURE], PLAN, { pieces })
    await finished(a)

    expect(ai.finishes).toEqual(['job2'])
    expect(ai.fileReads).toEqual([])
    expect(ai.parts).toEqual([])
    const design = a.tab.editor.session.design()
    expect(childrenOf(design, 'ann-1').map(([id]) => id)).toEqual([
      pictureLayerOf('ann-1'),
      'job2-ann-1-2',
      'job2-ann-1-1',
      'job2-ann-1-0',
    ])
    expect(design.nodes[pictureLayerOf('ann-1')]?.props.visible).toBe(false)
    // The picture is drawn over the whole 1080 px frame, so the backdrop the size of the picture fills the frame.
    expect(placed(a.tab, 'ann-1')).toEqual([
      { name: 'Backdrop', link: undefined, box: { x: 0, y: 0, width: 1080, height: 1080 } },
      { name: 'Layer 2', link: undefined, box: { x: 10, y: 949, width: 43, height: 43 } },
      { name: 'Headline', link: undefined, box: { x: 105, y: 52, width: 212, height: 107 } },
    ])
    expect(design.nodes['job2-ann-1-0']).toMatchObject({
      type: 'graphic',
      props: { shape: { kind: 'rect' }, fills: [{ type: 'image', assetId: 'cut-e1', fit: 'fill' }] },
    })
    expect(design.nodes['job2-ann-1-0']?.props.rotation ?? 0).toBe(0)
    expect(design.nodes['job2-ann-1-2']?.props).toMatchObject({ fills: [{ type: 'image', assetId: 'cut-e2' }] })
    expect(a.tab.editor.core.canUndo()).toBe(false)
    expect(a.tab.arrivals.read()?.frames.find((f) => f.frameId === 'ann-1')?.state).toBe('editable')
  })

  it('gives a backdrop the size of the picture the box the picture is drawn in, in a frame a little off the picture’s ratio', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const a = await finishing(ai)
    await sizesMadeEditable(ai, a)
    ai.split('job3', 0, [NO_PICTURE], PLAN, { pieces: cutOf(768, 1360, cut('e2', 'background', 0, 0, 768, 1360)) })
    ai.split('job3', 1, [NO_PICTURE], PLAN, { pieces: cutOf(1424, 800, cut('e2', 'background', 0, 0, 1424, 800)) })
    await finished(a)

    expect(ai.finishes).toEqual(['job3'])
    // A 768 × 1360 picture covers a 1080 × 1920 frame 1084.2 px wide, and a 1424 × 800 one a 1200 × 628 frame 674.2 px tall.
    expect(placed(a.tab, 'ann-6').map((layer) => layer.box)).toEqual([{ x: -3, y: 0, width: 1086, height: 1920 }])
    expect(placed(a.tab, 'ann-7').map((layer) => layer.box)).toEqual([{ x: 0, y: -24, width: 1200, height: 676 }])
  })

  it('places nothing new on a second finish of the same job', async () => {
    serve(WORDS)
    const ai = fakeAi()
    // The first finish places its layers, then can't end its lease, so the job is finished again a minute later.
    let ends = 0
    const finishAi: EditorAi = {
      ...ai,
      finished: (jobId, holder) =>
        ++ends === 1 ? Promise.reject(new Error('the network is down')) : ai.finished(jobId, holder),
    }
    const a = await finishing(ai, 'ann', { finishAi })
    await madeEditable(ai, a)
    const pieces = cutOf(1024, 1024, cut('e1', 'text', 100, 50, 200, 100), cut('e2', 'background', 0, 0, 1024, 1024))
    ai.split('job2', 0, [NO_PICTURE], PLAN, { pieces })
    await pollAll(a.tab)
    await settleAll(a)
    expect(ai.finishes).toEqual([])
    const first = childrenOf(a.tab.editor.session.design(), 'ann-1').map(([id]) => id)
    expect(first).toEqual([pictureLayerOf('ann-1'), 'job2-ann-1-1', 'job2-ann-1-0'])
    a.tab.editor.session.run('node.update', { ids: ['job2-ann-1-0'], patch: { x: 400 } })

    for (const run of a.timers.splice(0)) run()
    await settleAll(a)
    expect(ends).toBe(2)
    expect(ai.finishes).toEqual(['job2'])
    const design = a.tab.editor.session.design()
    expect(childrenOf(design, 'ann-1').map(([id]) => id)).toEqual(first)
    expect(design.nodes['job2-ann-1-0']?.props.x).toBe(400)
  })

  it('links the pieces of two sizes whose plans have one part of the same kind and words, and names each size’s from its own plan', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const a = await finishing(ai)
    await sizesMadeEditable(ai, a)
    const tall = planOf(
      element('e1', 'text', 'Headline', 1, 'Big sale'),
      element('e2', 'shape', 'Dot', 1),
      element('e3', 'shape', 'dot', 1),
      element('e4', 'text', 'Terms', 1, 'Until Sunday'),
      element('e5', 'background', 'Backdrop', 2),
    )
    const wide = planOf(
      element('t1', 'text', 'Title', 1, ' BIG  sale'),
      element('t2', 'shape', 'Dot', 1),
      element('t3', 'text', 'Terms', 1, 'Until Monday'),
      element('t4', 'background', 'Backdrop', 2),
    )
    ai.split('job3', 0, [NO_PICTURE], tall, {
      ownPlan: true,
      pieces: cutOf(
        576,
        1024,
        cut('e1', 'text', 0, 0, 10, 10),
        cut('e2', 'shape', 0, 0, 10, 10),
        cut('e3', 'shape', 0, 0, 10, 10),
        cut('e4', 'text', 0, 0, 10, 10),
        cut(null, 'other', 0, 0, 10, 10),
        cut('e5', 'background', 0, 0, 576, 1024),
      ),
    })
    ai.split('job3', 1, [NO_PICTURE], wide, {
      ownPlan: true,
      pieces: cutOf(
        1424,
        800,
        cut('t1', 'text', 0, 0, 10, 10),
        cut('t2', 'shape', 0, 0, 10, 10),
        cut('t3', 'text', 0, 0, 10, 10),
        cut(null, 'other', 0, 0, 10, 10),
        cut('t4', 'background', 0, 0, 1424, 800),
      ),
    })
    await finished(a)

    expect(ai.finishes).toEqual(['job3'])
    expect(ai.fileReads).toEqual([])
    const names = (frameId: string) => placed(a.tab, frameId).map(({ name, link }) => [name, link])
    // Linked: the one text saying "Big sale" and the one backdrop. Not linked: the texts whose words differ, the
    // dot, which the tall size has two of, and the loose bits of no part.
    expect(names('ann-6')).toEqual([
      ['Backdrop', 'job3-6ebf2f17'],
      ['Layer 5', undefined],
      ['Terms', undefined],
      ['dot', undefined],
      ['Dot', undefined],
      ['Headline', 'job3-a3e7120d'],
    ])
    expect(names('ann-7')).toEqual([
      ['Backdrop', 'job3-6ebf2f17'],
      ['Layer 4', undefined],
      ['Terms', undefined],
      ['Dot', undefined],
      ['Title', 'job3-a3e7120d'],
    ])
  })

  it('names every size’s pieces from the job’s one plan, and links the pieces of the same part', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const a = await finishing(ai)
    await sizesMadeEditable(ai, a)
    const plan = planOf(element('e1', 'text', 'Headline', 1, 'Big sale'), element('e2', 'background', 'Backdrop', 2))
    const pieces = (width: number, height: number) =>
      cutOf(width, height, cut('e1', 'text', 0, 0, 10, 10), cut('e2', 'background', 0, 0, width, height))
    ai.split('job3', 0, [NO_PICTURE], plan, { pieces: pieces(576, 1024) })
    ai.split('job3', 1, [NO_PICTURE], plan, { pieces: pieces(1424, 800) })
    await finished(a)

    const names = (frameId: string) => placed(a.tab, frameId).map(({ name, link }) => [name, link])
    expect(names('ann-6')).toEqual([
      ['Backdrop', 'job3-6ebf2f17'],
      ['Headline', 'job3-a3e7120d'],
    ])
    expect(names('ann-7')).toEqual(names('ann-6'))
  })

  it('places whole split layers, linked to nothing, in a size whose split cut no pieces, when each size has its own plan', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const a = await finishing(ai)
    await sizesMadeEditable(ai, a)
    const tall = planOf(element('e1', 'text', 'Headline', 1, 'Big sale'), element('e2', 'background', 'Backdrop', 2))
    const wide = planOf(element('t1', 'text', 'Title', 1, 'Big sale'), element('t2', 'background', 'Sky', 2))
    ai.split('job3', 0, [NO_PICTURE], tall, {
      ownPlan: true,
      pieces: cutOf(576, 1024, cut('e1', 'text', 0, 0, 10, 10), cut('e2', 'background', 0, 0, 576, 1024)),
    })
    ai.split('job3', 1, [splitLayer(100, 50, 200, 100), splitLayer(0, 0, 512, 512)], wide, { ownPlan: true })
    await finished(a)

    expect(ai.finishes).toEqual(['job3'])
    // Only the wide size's two split layers were read and uploaded: the job's files after the tall size's one.
    expect(ai.fileReads).toEqual([1, 2])
    expect(ai.parts).toHaveLength(2)
    expect(placed(a.tab, 'ann-6').map(({ name, link }) => [name, link])).toEqual([
      ['Backdrop', undefined],
      ['Headline', undefined],
    ])
    expect(placed(a.tab, 'ann-7').map(({ name, link }) => [name, link])).toEqual([
      ['Sky', undefined],
      ['Title', undefined],
    ])
  })

  it('places whole split layers in a frame whose split has a piece with no recorded asset', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const a = await finishing(ai)
    await madeEditable(ai, a)
    const unrecorded = {
      ...cut('e2', 'background', 0, 0, 1024, 1024),
      picture: { key: 'k', width: 1024, height: 1024 },
    }
    const pieces = cutOf(1024, 1024, cut('e1', 'text', 100, 50, 200, 100), unrecorded)
    ai.split('job2', 0, [splitLayer(100, 50, 200, 100), splitLayer(0, 0, 512, 512)], PLAN, { pieces })
    await finished(a)

    expect(ai.finishes).toEqual(['job2'])
    expect(ai.parts).toHaveLength(2)
    expect(placed(a.tab, 'ann-1')).toEqual([
      { name: 'Backdrop', link: undefined, box: { x: 0, y: 0, width: 1080, height: 1080 } },
      { name: 'Headline', link: undefined, box: { x: 210, y: 105, width: 423, height: 212 } },
    ])
    expect(a.tab.editor.session.design().nodes['job2-ann-1-0']).toMatchObject({
      props: { fills: [{ type: 'image', assetId: 'part1' }] },
    })
  })
})
