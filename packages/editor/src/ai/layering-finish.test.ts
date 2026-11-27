import { afterEach, describe, expect, it } from 'vitest'

import { childrenOf } from '@dazbee/doc'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type MadePiece, type MadePieces, pictureLayerOf } from '@dazbee/schema'

import { WORDS } from '../test-actions.ts'
import type { EditorAi } from './arrivals.ts'
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

/** One element of the layer plan, in split layer `layer`, a text saying `content`. */
const element = (id: string, kind: string, name: string, layer: number, content = '') => ({
  id,
  kind,
  name,
  content,
  text_lines: [],
  box: { x_min: 0, y_min: 0, x_max: 999, y_max: 999 },
  shadow: 'none',
  group: null,
  ming_layer: layer,
})

/** A layer plan of `elements`. */
const planOf = (...elements: ReturnType<typeof element>[]) => ({
  ad_type: 'graphical',
  elements,
  prompt: 'p',
  notes: [],
  design_name: 'Sale',
})

const PLAN = planOf(element('e1', 'text', 'Headline', 1), element('e2', 'background', 'Backdrop', 2))

/** A split piece of planned part `part`, at `x`, `y`, `width` × `height` px of the picture, recorded as asset `cut-<part>`. */
const cut = (part: string | null, kind: MadePiece['kind'], x: number, y: number, width: number, height: number) => ({
  picture: { key: `originals/cut-${part ?? 'loose'}`, width, height, assetId: `cut-${part ?? 'loose'}` },
  x,
  y,
  part,
  kind,
  layer: 1,
  turned: null,
})

/** The split pieces `items` of a picture `width` × `height` px, front to back. */
const cutOf = (width: number, height: number, ...items: MadePiece[]): MadePieces => ({
  width,
  height,
  items,
  stuck: [],
  closeness: { mean: 1, off: 2 },
  seconds: 3,
})

/** A split layer's file that is no picture: a finish that reads it fails. */
const NO_PICTURE = new Uint8Array([1, 2, 3])

const SIZES = [
  { width: 1080, height: 1920, name: 'Story' },
  { width: 1200, height: 628, name: 'Link image' },
]

/**
 * A tab of `token`'s with its finish, the timers it waits on, what its arrivals give back as stored, and the AI its
 * finish asks, when not the tab's.
 */
async function finishing(
  ai: FakeAi,
  token = 'ann',
  { arrive, finishAi }: { arrive?: () => Promise<'saved' | 'none'>; finishAi?: EditorAi } = {},
): Promise<{ tab: Tab; finish: EditorLayeringFinish; timers: (() => void)[] }> {
  const tab = await tabOn(ai, token)
  const stop = new AbortController()
  const timers: (() => void)[] = []
  const finish = editorLayeringFinish({
    session: tab.editor.session,
    ai: finishAi ?? ai,
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

/**
 * A brief whose Draft 1, picture `pic1`, is redrawn as a Story (frame ann-6, 1080 × 1920) and a Link image (ann-7,
 * 1200 × 628), both made editable as job3.
 */
async function sizesMadeEditable(ai: FakeAi, first: { tab: Tab; finish: EditorLayeringFinish }) {
  await first.tab.arrivals.startBrief(BRIEF)
  await settleAll(first)
  ai.make('job1', 0, 'pic1')
  await pollAll(first.tab)
  await first.tab.arrivals.otherSizes({ frameId: 'ann-1', sizes: SIZES, title: 'Draft 1 sizes' })
  await settleAll(first)
  ai.makeCall('job2', 0, 'tall')
  ai.makeCall('job2', 1, 'wide')
  await pollAll(first.tab)
  expect((await first.tab.arrivals.makeAllEditable(['ann-6', 'ann-7'], 'pic1')).ok).toBe(true)
}

/** Reads the frames, lets the finish they start run, and reads again. */
async function finished(first: { tab: Tab; finish: EditorLayeringFinish }) {
  await pollAll(first.tab)
  await settleAll(first)
  await pollAll(first.tab)
}

/**
 * The layers placed in frame `frameId` over its picture layer, bottom first: each one's name, box, and the link id
 * the finish gave it; none for a layer left with a link id of its own, as a layer created without one has.
 */
function placed(tab: Tab, frameId: string) {
  return childrenOf(tab.editor.session.design(), frameId)
    .filter(([id]) => id !== pictureLayerOf(frameId))
    .map(([, layer]) => {
      const { x, y, width, height } = layer.props as Record<string, unknown>
      const link = layer.link.startsWith('job') ? layer.link : undefined
      return { name: layer.name, link, box: { x, y, width, height } }
    })
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
