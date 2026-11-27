import { afterEach, describe, expect, it } from 'vitest'

import { childrenOf } from '@dazbee/doc'
import { pictureLayerOf } from '@dazbee/schema'

import { WORDS } from '../test-actions.ts'
import { fakeAi } from './test-ai.ts'
import { endTabs, pollAll, serve } from './test-arrivals.ts'
import { finishing, madeEditable, PLAN, settleAll, splitLayer } from './test-layering-finish.ts'

afterEach(endTabs)

describe('editorLayeringFinish', () => {
  it('places the split layers over the hidden picture, bottom first, in one tab, as one arrival no undo takes back', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const a = await finishing(ai, 'ann')
    const b = await finishing(ai, 'bob')
    await madeEditable(ai, a, b.tab)
    expect(ai.started[1]).toEqual({
      kind: 'layering',
      designId: 'd',
      frames: [{ frameId: 'ann-1', pictureAssetId: 'pic1' }],
    })
    expect(a.tab.arrivals.waiting()).toContain('ann-1')

    ai.split('job2', 0, [splitLayer(100, 50, 200, 100), splitLayer(0, 0, 512, 512)], PLAN)
    await pollAll(a.tab, b.tab)
    await settleAll(a, b)
    await pollAll(a.tab, b.tab)

    // One tab claimed and finished it.
    expect(ai.claims).toHaveLength(1)
    expect(ai.finishes).toEqual(['job2'])
    expect(ai.parts).toHaveLength(2)
    for (const { tab } of [a, b]) {
      const design = tab.editor.session.design()
      expect(childrenOf(design, 'ann-1').map(([id]) => id)).toEqual([
        pictureLayerOf('ann-1'),
        'job2-ann-1-1',
        'job2-ann-1-0',
      ])
      expect(design.nodes[pictureLayerOf('ann-1')]?.props.visible).toBe(false)
      expect(design.nodes['job2-ann-1-0']).toMatchObject({
        name: 'Headline',
        props: { x: 210, y: 105, width: 423, height: 212, fills: [{ type: 'image', assetId: 'part1', fit: 'fill' }] },
      })
      expect(design.nodes['job2-ann-1-1']).toMatchObject({
        name: 'Backdrop',
        props: { x: 0, y: 0, width: 1080, height: 1080 },
      })
    }
    expect(a.tab.editor.core.canUndo()).toBe(false)
    expect(a.tab.arrivals.read()?.frames.find((f) => f.frameId === 'ann-1')?.state).toBe('editable')
  })

  it('waits while another tab holds the lease, and finishes once it lapses', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const a = await finishing(ai)
    await madeEditable(ai, a)
    // A tab that closed mid-way holds the lease.
    await ai.claim('job2', 'closed-tab')
    ai.split('job2', 0, [splitLayer(0, 0, 512, 512)], PLAN)
    await pollAll(a.tab)
    await settleAll(a)
    expect(ai.finishes).toEqual([])
    expect(a.tab.editor.session.design().nodes['job2-ann-1-0']).toBeUndefined()

    ai.lapse()
    await pollAll(a.tab)
    await settleAll(a)
    expect(ai.finishes).toEqual(['job2'])
    expect(a.tab.editor.session.design().nodes['job2-ann-1-0']).toBeDefined()
  })

  it('places nothing over a picture that changed meanwhile, and ends the finish', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const a = await finishing(ai)
    await madeEditable(ai, a)
    a.tab.editor.session.run('node.update', {
      ids: [pictureLayerOf('ann-1')],
      patch: { fills: [{ type: 'image', assetId: 'other', fit: 'fill' }] },
    })
    ai.split('job2', 0, [splitLayer(0, 0, 512, 512)], PLAN)
    await pollAll(a.tab)
    await settleAll(a)
    expect(ai.finishes).toEqual(['job2'])
    expect(childrenOf(a.tab.editor.session.design(), 'ann-1')).toHaveLength(1)
  })

  it('leaves the finish for a later try when the tab stored nothing, as when the editor ended', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const a = await finishing(ai, 'ann', { arrive: () => Promise.resolve('none') })
    await madeEditable(ai, a)
    ai.split('job2', 0, [splitLayer(0, 0, 512, 512)], PLAN)
    await pollAll(a.tab)
    await settleAll(a)
    expect(ai.finishes).toEqual([])
  })

  it('ends a finish whose split shows nothing with no layer placed and the picture showing', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const a = await finishing(ai)
    await madeEditable(ai, a)
    ai.split('job2', 0, [splitLayer(0, 0, 0, 0)], PLAN)
    await pollAll(a.tab)
    await settleAll(a)
    expect(ai.finishes).toEqual(['job2'])
    const design = a.tab.editor.session.design()
    expect(childrenOf(design, 'ann-1')).toHaveLength(1)
    expect(design.nodes[pictureLayerOf('ann-1')]?.props.visible).not.toBe(false)
  })

  it('tries a failing finish again a minute later, uploading no part twice, and ends it after three tries', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const a = await finishing(ai)
    await madeEditable(ai, a)
    // The first split layer reads; the second is no picture, so every try fails after uploading the first.
    ai.split('job2', 0, [splitLayer(0, 0, 512, 512), new Uint8Array([1, 2, 3])], PLAN)
    for (let tries = 0; tries < 3; tries++) {
      await pollAll(a.tab)
      await settleAll(a)
      // The minute's wait, then the next read.
      for (const run of a.timers.splice(0)) run()
      await settleAll(a)
    }
    expect(ai.parts).toHaveLength(1)
    expect(ai.finishes).toEqual(['job2'])
    expect(childrenOf(a.tab.editor.session.design(), 'ann-1')).toHaveLength(1)
  })
})
