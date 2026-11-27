import { afterEach, describe, expect, it } from 'vitest'

import { childrenOf } from '@dazbee/doc'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { pictureLayerOf } from '@dazbee/schema'

import { WORDS } from '../test-actions.ts'
import { type EditorLayeringFinish, editorLayeringFinish } from './layering-finish.ts'
import { type FakeAi, fakeAi } from './test-ai.ts'
import { BRIEF, endTabs, pollAll, serve, settle, type Tab, tabOn } from './test-arrivals.ts'

afterEach(endTabs)

const ck = await loadCanvasKit()

/** A 512 px split layer, clear but for an opaque box at `x`, `y`, `width` × `height`, as PNG bytes. */
function splitLayer(x: number, y: number, width: number, height: number): Uint8Array {
  const surface = ck.MakeSurface(512, 512)
  if (!surface) throw new Error('no surface')
  const canvas = surface.getCanvas()
  canvas.clear(ck.TRANSPARENT)
  const paint = new ck.Paint()
  paint.setColor(ck.Color(20, 120, 200, 1))
  canvas.drawRect(ck.XYWHRect(x, y, width, height), paint)
  paint.delete()
  const image = surface.makeImageSnapshot()
  const png = image.encodeToBytes()
  image.delete()
  surface.delete()
  if (!png) throw new Error('no PNG')
  return png
}

/** One element of the layer plan, in split layer `layer`. */
const element = (id: string, kind: string, name: string, layer: number) => ({
  id,
  kind,
  name,
  content: '',
  text_lines: [],
  box: { x_min: 0, y_min: 0, x_max: 999, y_max: 999 },
  shadow: 'none',
  group: null,
  ming_layer: layer,
})

const PLAN = {
  ad_type: 'graphical',
  elements: [element('e1', 'text', 'Headline', 1), element('e2', 'background', 'Backdrop', 2)],
  prompt: 'p',
  notes: [],
  design_name: 'Sale',
}

/** A tab of `token`'s with its finish, the timers it waits on, and what its arrivals give back as stored. */
async function finishing(
  ai: FakeAi,
  token = 'ann',
  { arrive }: { arrive?: () => Promise<'saved' | 'none'> } = {},
): Promise<{ tab: Tab; finish: EditorLayeringFinish; timers: (() => void)[] }> {
  const tab = await tabOn(ai, token)
  const stop = new AbortController()
  const timers: (() => void)[] = []
  const finish = editorLayeringFinish({
    session: tab.editor.session,
    ai,
    ck,
    holder: `${token}-holder`,
    read: tab.arrivals.read,
    onRead: tab.arrivals.onRead,
    after: (_ms, run) => {
      timers.push(run)
      return () => {
        const at = timers.indexOf(run)
        if (at >= 0) timers.splice(at, 1)
      }
    },
    readyPictures: tab.editor.modules.resources.prepareImages,
    arrive: arrive ?? tab.arrivals.land,
    poll: tab.arrivals.poll,
    signal: stop.signal,
  })
  return { tab, finish, timers }
}

/** Lets what the tabs and their finishes set going land. */
async function settleAll(...tabs: { tab: Tab; finish: EditorLayeringFinish }[]) {
  for (let n = 0; n < 3; n++) {
    await settle(...tabs.map((t) => t.tab.arrivals))
    await Promise.all(tabs.map((t) => t.finish.settled()))
  }
}

/** A brief whose Draft 1 shows picture `pic1`, made editable as job2. */
async function madeEditable(ai: FakeAi, first: { tab: Tab; finish: EditorLayeringFinish }, ...others: Tab[]) {
  await first.tab.arrivals.startBrief(BRIEF)
  await settleAll(first)
  ai.make('job1', 0, 'pic1')
  await pollAll(first.tab, ...others)
  expect((await first.tab.arrivals.makeEditable('ann-1')).ok).toBe(true)
}

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
