// The finish of frames whose split pieces the matchers rebuild as live layers.
import { afterEach, describe, expect, it } from 'vitest'

import { childrenOf, fittedText } from '@dazbee/doc'
import { type MatchAnswer, pictureLayerOf, UnplacedLayer } from '@dazbee/schema'

import { WORDS } from '../test-actions.ts'
import type { EditorAi } from './arrivals.ts'
import type { FramePieces, PieceMatcher } from './piece-matcher.ts'
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
  planOf,
  settleAll,
  sizesMadeEditable,
} from './test-layering-finish.ts'

/** A headline, a badge and the backdrop: the plan, its reading and its split pieces of a 1024 px picture. */
const PLAN = planOf(
  element('e1', 'text', 'Headline', 1, 'Big sale'),
  element('e2', 'shape', 'Badge', 1),
  element('e3', 'background', 'Backdrop', 2),
)
const READING = {
  blocks: [
    {
      id: 'e1',
      text: 'Big sale!',
      corrections: [],
      lettering: 'font',
      style: 'sans-serif',
      italic: false,
      rounded: false,
      mixed_styles: false,
      mixed_note: '',
    },
  ],
}
const PIECES = cutOf(
  1024,
  1024,
  cut('e1', 'text', 100, 50, 200, 100),
  cut('e2', 'shape', 512, 512, 128, 128),
  cut('e3', 'background', 0, 0, 1024, 1024),
)
const SCORES = { ssim: 0.9, inkMissed: 0, far: 0 }

/** A text as the text matcher answers it, in its piece's pixels, bound to the brand kit as `bindings` say. */
const text = (bindings?: Record<string, string>) =>
  UnplacedLayer.parse({
    type: 'text',
    name: 'Big sale!',
    props: {
      x: 8,
      y: 16,
      width: 180,
      height: 60,
      text: 'Big sale!',
      boxMode: 'autoWidth',
      style: { fontFamily: 'Noto Sans', fontWeight: 700, fontSize: 64, color: '#102030FF' },
    },
    ...(bindings ? { bindings } : {}),
  })

/** A rectangle as the shape matcher answers it, in its piece's pixels. */
const rect = (x: number, y: number, width: number, height: number) =>
  UnplacedLayer.parse({
    type: 'graphic',
    name: 'Rectangle',
    props: { x, y, width, height, shape: { kind: 'rect' }, fills: [{ type: 'solid', color: '#FF0000FF' }] },
  })

const layersOf = (...layers: UnplacedLayer[]): MatchAnswer => ({
  kind: 'layers',
  layers,
  scores: SCORES,
  approximate: false,
})

/** Matchers that answer each piece as `answers` say, by its number, and keep what they were asked. */
function matchers(answers: Record<number, MatchAnswer>) {
  const asked: FramePieces[] = []
  const matcher: PieceMatcher = (frame) => {
    asked.push(frame)
    return Promise.resolve(new Map(Object.entries(answers).map(([n, answer]) => [Number(n), answer])))
  }
  return { asked, matcher }
}

afterEach(endTabs)

describe('editorLayeringFinish', () => {
  it('places a text piece as a live text and a shape piece as its graphics in one group, the rest as pictures, over the hidden picture', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const { asked, matcher } = matchers({
      0: layersOf(text()),
      1: layersOf(rect(0, 0, 128, 128), rect(32, 32, 64, 64)),
    })
    const a = await finishing(ai, 'ann', { matcher })
    await madeEditable(ai, a)
    ai.split('job2', 0, [NO_PICTURE], PLAN, { pieces: PIECES, reading: READING })
    await finished(a)

    expect(ai.finishes).toEqual(['job2'])
    // The matchers are asked once, with the frame's pieces, its plan, its reading and the picture they were cut from.
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({ cut: PIECES, plan: PLAN, reading: READING, pictureAssetId: 'pic1' })
    const design = a.tab.editor.session.design()
    expect(childrenOf(design, 'ann-1').map(([id, layer]) => [id, layer.type, layer.name])).toEqual([
      [pictureLayerOf('ann-1'), 'graphic', 'Picture'],
      ['job2-ann-1-2', 'graphic', 'Backdrop'],
      ['job2-ann-1-1_group', 'group', 'Badge'],
      ['job2-ann-1-0', 'text', 'Headline'],
    ])
    expect(childrenOf(design, 'job2-ann-1-1_group').map(([id, layer]) => [id, layer.type, layer.name])).toEqual([
      ['job2-ann-1-1', 'graphic', 'Badge 1'],
      ['job2-ann-1-1_1', 'graphic', 'Badge 2'],
    ])
    expect(design.nodes[pictureLayerOf('ann-1')]?.props.visible).toBe(false)
    // The 1024 px picture fills the 1080 px frame, so every place and size is 1080 / 1024 times the piece's.
    const k = 1080 / 1024
    expect(design.nodes['job2-ann-1-0']?.props).toMatchObject({
      text: 'Big sale!',
      x: expect.closeTo((100 + 8) * k, 1),
      y: expect.closeTo((50 + 16) * k, 1),
      style: { fontFamily: 'Noto Sans', fontSize: expect.closeTo(64 * k, 1), color: '#102030FF' },
    })
    expect(design.nodes['job2-ann-1-1']?.props).toMatchObject({
      x: 540,
      y: 540,
      width: 135,
      height: 135,
      fills: [{ type: 'solid', color: '#FF0000FF' }],
    })
    expect(design.nodes['job2-ann-1-1_1']?.props).toMatchObject({ x: 573.75, y: 573.75, width: 67.5, height: 67.5 })
    expect(design.nodes['job2-ann-1-2']?.props).toMatchObject({ fills: [{ type: 'image', assetId: 'cut-e3' }] })
    expect(a.tab.editor.core.canUndo()).toBe(false)
    expect(a.tab.arrivals.read()?.frames.find((f) => f.frameId === 'ann-1')?.state).toBe('editable')
  })

  it('fits a live text to its words as the editor measures them', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const a = await finishing(ai, 'ann', { matcher: matchers({ 0: layersOf(text()) }).matcher })
    await madeEditable(ai, a)
    ai.split('job2', 0, [NO_PICTURE], PLAN, { pieces: PIECES })
    await finished(a)

    // The matcher's box was 180 × 60 px of the picture; the editor's own measure of the words replaces it.
    const layer = a.tab.editor.session.design().nodes['job2-ann-1-0']
    const fitted = fittedText(layer, a.tab.editor.modules.scenes.measure())
    expect(fitted?.width).toBeGreaterThan(0)
    expect(layer?.props).toMatchObject({ width: fitted?.width, height: fitted?.height })
    expect(fitted?.height).not.toBeCloseTo(60 * (1080 / 1024), 0)
  })

  it('keeps a piece a picture when the matchers keep it one, or give it no answer', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const a = await finishing(ai, 'ann', { matcher: matchers({ 0: { kind: 'picture', why: 'failed' } }).matcher })
    await madeEditable(ai, a)
    ai.split('job2', 0, [NO_PICTURE], PLAN, { pieces: PIECES })
    await finished(a)

    expect(ai.finishes).toEqual(['job2'])
    expect(placed(a.tab, 'ann-1')).toEqual([
      { name: 'Backdrop', link: undefined, box: { x: 0, y: 0, width: 1080, height: 1080 } },
      { name: 'Badge', link: undefined, box: { x: 540, y: 540, width: 135, height: 135 } },
      { name: 'Headline', link: undefined, box: { x: 105, y: 52, width: 212, height: 107 } },
    ])
    const design = a.tab.editor.session.design()
    expect(design.nodes['job2-ann-1-0']?.props).toMatchObject({ fills: [{ type: 'image', assetId: 'cut-e1' }] })
  })

  it('binds a rebuilt layer to the brand kit where the matcher bound it', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const bound = text({ textColor: 'brand:primary', fontFamily: 'brand:heading' })
    const a = await finishing(ai, 'ann', { matcher: matchers({ 0: layersOf(bound) }).matcher })
    await madeEditable(ai, a)
    ai.split('job2', 0, [NO_PICTURE], PLAN, { pieces: PIECES })
    await finished(a)

    const layer = a.tab.editor.session.design().nodes['job2-ann-1-0']
    expect(layer?.bindings).toEqual({ textColor: 'brand:primary', fontFamily: 'brand:heading' })
    expect(layer?.props).toMatchObject({ style: { fontFamily: 'Noto Sans', color: '#102030FF' } })
    expect(a.tab.editor.core.canUndo()).toBe(false)
  })

  it('tells the frame’s pieces as lifting while the matchers work, the backdrop left out, and none once they are placed', async () => {
    serve(WORDS)
    const ai = fakeAi()
    let answer: (answers: Map<number, MatchAnswer>) => void = () => {}
    const matcher: PieceMatcher = () => new Promise((resolve) => (answer = resolve))
    const a = await finishing(ai, 'ann', { matcher })
    let told = 0
    a.finish.onLifting(() => told++)
    await madeEditable(ai, a)
    ai.split('job2', 0, [NO_PICTURE], PLAN, { pieces: PIECES })
    await pollAll(a.tab)
    await expect.poll(() => a.finish.lifting()).toHaveLength(1)

    const [lifted] = a.finish.lifting()
    expect(lifted?.frameId).toBe('ann-1')
    // Bottom first: the badge, then the headline, each at its box in the frame.
    expect(lifted?.pieces.map((piece) => piece.box)).toEqual([
      { x: 540, y: 540, width: 135, height: 135 },
      { x: 105, y: 52, width: 212, height: 107 },
    ])
    expect(lifted?.pieces.every((piece) => piece.url.startsWith('blob:'))).toBe(true)
    expect(told).toBe(1)
    expect(childrenOf(a.tab.editor.session.design(), 'ann-1')).toHaveLength(1)

    answer(new Map([[0, layersOf(text())]]))
    await finished(a)
    expect(a.finish.lifting()).toEqual([])
    expect(told).toBe(2)
    expect(ai.finishes).toEqual(['job2'])
  })

  it('tries again when the matchers fail, and on the last try places every piece as a picture', async () => {
    serve(WORDS)
    const ai = fakeAi()
    let asks = 0
    const matcher: PieceMatcher = () => {
      asks++
      return Promise.reject(new Error('the matchers’ files did not come'))
    }
    const a = await finishing(ai, 'ann', { matcher })
    await madeEditable(ai, a)
    ai.split('job2', 0, [NO_PICTURE], PLAN, { pieces: PIECES })
    await pollAll(a.tab)
    await settleAll(a)
    expect(asks).toBe(1)
    expect(childrenOf(a.tab.editor.session.design(), 'ann-1')).toHaveLength(1)
    expect(a.finish.lifting()).toEqual([])

    for (const run of a.timers.splice(0)) run()
    await settleAll(a)
    expect(asks).toBe(2)
    expect(ai.finishes).toEqual([])

    for (const run of a.timers.splice(0)) run()
    await settleAll(a)
    expect(asks).toBe(3)
    expect(ai.finishes).toEqual(['job2'])
    expect(placed(a.tab, 'ann-1').map((layer) => layer.name)).toEqual(['Backdrop', 'Badge', 'Headline'])
    const design = a.tab.editor.session.design()
    expect(design.nodes['job2-ann-1-0']?.props).toMatchObject({ fills: [{ type: 'image', assetId: 'cut-e1' }] })
  })

  it('links the first layer of a rebuilt piece with the same part of the job’s other size, and no other', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const { matcher } = matchers({ 0: layersOf(text()), 1: layersOf(rect(0, 0, 10, 10), rect(2, 2, 4, 4)) })
    const a = await finishing(ai, 'ann', { matcher })
    await sizesMadeEditable(ai, a)
    const pieces = (width: number, height: number) =>
      cutOf(width, height, cut('e1', 'text', 0, 0, 100, 40), cut('e2', 'shape', 0, 100, 10, 10))
    ai.split('job3', 0, [NO_PICTURE], PLAN, { pieces: pieces(576, 1024) })
    ai.split('job3', 1, [NO_PICTURE], PLAN, { pieces: pieces(1424, 800) })
    await finished(a)

    expect(ai.finishes).toEqual(['job3'])
    const links = (frameId: string) => placed(a.tab, frameId).map(({ name, link }) => [name, link?.startsWith('job3-')])
    // The badge's two graphics are in a group, which has a link id of its own.
    expect(links('ann-6')).toEqual([
      ['Badge', undefined],
      ['Headline', true],
    ])
    expect(links('ann-7')).toEqual(links('ann-6'))
    const linkOf = (id: string) => a.tab.editor.session.design().nodes[id]?.link
    expect(linkOf('job3-ann-6-0')).toBe(linkOf('job3-ann-7-0'))
    expect(linkOf('job3-ann-6-1')).toBe(linkOf('job3-ann-7-1'))
    expect(linkOf('job3-ann-6-1_1')).not.toBe(linkOf('job3-ann-7-1_1'))
  })

  it('places nothing new on a second finish of a job whose pieces were rebuilt', async () => {
    serve(WORDS)
    const ai = fakeAi()
    // The first finish places its layers, then can't end its lease, so the job is finished again a minute later.
    let ends = 0
    const finishAi: EditorAi = {
      ...ai,
      finished: (jobId, holder) =>
        ++ends === 1 ? Promise.reject(new Error('the network is down')) : ai.finished(jobId, holder),
    }
    const { matcher } = matchers({ 0: layersOf(text()), 1: layersOf(rect(0, 0, 128, 128), rect(32, 32, 64, 64)) })
    const a = await finishing(ai, 'ann', { finishAi, matcher })
    await madeEditable(ai, a)
    ai.split('job2', 0, [NO_PICTURE], PLAN, { pieces: PIECES })
    await pollAll(a.tab)
    await settleAll(a)
    const idsIn = (parentId: string) => childrenOf(a.tab.editor.session.design(), parentId).map(([id]) => id)
    const first = idsIn('ann-1')
    expect(first).toHaveLength(4)
    expect(idsIn('job2-ann-1-1_group')).toEqual(['job2-ann-1-1', 'job2-ann-1-1_1'])
    a.tab.editor.session.run('node.update', { ids: ['job2-ann-1-1_1'], patch: { x: 400 } })

    for (const run of a.timers.splice(0)) run()
    await settleAll(a)
    expect(ai.finishes).toEqual(['job2'])
    const design = a.tab.editor.session.design()
    expect(idsIn('ann-1')).toEqual(first)
    expect(idsIn('job2-ann-1-1_group')).toEqual(['job2-ann-1-1', 'job2-ann-1-1_1'])
    expect(design.nodes['job2-ann-1-1_1']?.props.x).toBe(400)
  })

  it('places every piece as a picture on the last try, when the design refuses a rebuilt layer', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const { matcher } = matchers({ 1: layersOf(rect(0, 0, 128, 128), rect(32, 32, 64, 64)) })
    const a = await finishing(ai, 'ann', { matcher })
    await madeEditable(ai, a)
    // A layer holds the id the badge's second graphic would take, so the design refuses that graphic.
    a.tab.editor.session.run('node.create', {
      id: 'job2-ann-1-1_1',
      parentId: 'ann-1',
      layer: {
        type: 'graphic',
        name: 'In the way',
        props: { x: 0, y: 0, width: 10, height: 10, shape: { kind: 'rect' } },
      },
    })
    ai.split('job2', 0, [NO_PICTURE], PLAN, { pieces: PIECES })
    await pollAll(a.tab)
    await settleAll(a)
    for (const run of a.timers.splice(0)) run()
    await settleAll(a)
    expect(ai.finishes).toEqual([])
    expect(childrenOf(a.tab.editor.session.design(), 'ann-1')).toHaveLength(2)

    for (const run of a.timers.splice(0)) run()
    await settleAll(a)
    expect(ai.finishes).toEqual(['job2'])
    const design = a.tab.editor.session.design()
    expect(placed(a.tab, 'ann-1').map((layer) => layer.name)).toEqual(['In the way', 'Backdrop', 'Badge', 'Headline'])
    expect(design.nodes['job2-ann-1-1']?.props).toMatchObject({ fills: [{ type: 'image', assetId: 'cut-e2' }] })
    expect(design.nodes[pictureLayerOf('ann-1')]?.props.visible).toBe(false)
  })

  it('leaves out a binding the design refuses, and places the layer', async () => {
    serve(WORDS)
    const ai = fakeAi()
    // A text can't bind a fill: the binding is refused, the text is placed.
    const a = await finishing(ai, 'ann', { matcher: matchers({ 0: layersOf(text({ image: 'brand:logo' })) }).matcher })
    await madeEditable(ai, a)
    ai.split('job2', 0, [NO_PICTURE], PLAN, { pieces: PIECES })
    await finished(a)

    expect(ai.finishes).toEqual(['job2'])
    const layer = a.tab.editor.session.design().nodes['job2-ann-1-0']
    expect(layer?.type).toBe('text')
    expect(layer?.bindings ?? {}).toEqual({})
  })

  it('stops matchers that take too long, ends the lifting, and tries the finish again', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const stops: AbortSignal[] = []
    const matcher: PieceMatcher = (_frame, signal) => {
      stops.push(signal)
      return new Promise(() => {})
    }
    const a = await finishing(ai, 'ann', { matcher })
    await madeEditable(ai, a)
    ai.split('job2', 0, [NO_PICTURE], PLAN, { pieces: PIECES })
    await pollAll(a.tab)
    await expect.poll(() => a.finish.lifting()).toHaveLength(1)
    expect(stops[0]?.aborted).toBe(false)

    // The lease's renewal and the matchers' two minutes both run out.
    for (const run of a.timers.splice(0)) run()
    await settleAll(a)
    expect(stops[0]?.aborted).toBe(true)
    expect(a.finish.lifting()).toEqual([])
    expect(ai.finishes).toEqual([])
    expect(childrenOf(a.tab.editor.session.design(), 'ann-1')).toHaveLength(1)
    // It waits a minute, then asks the matchers again.
    for (const run of a.timers.splice(0)) run()
    await expect.poll(() => stops).toHaveLength(2)
  })

  it('stops the matchers and the lifting when the editor ends, with nothing placed', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const stops: AbortSignal[] = []
    const matcher: PieceMatcher = (_frame, signal) => {
      stops.push(signal)
      return new Promise(() => {})
    }
    const a = await finishing(ai, 'ann', { matcher })
    await madeEditable(ai, a)
    ai.split('job2', 0, [NO_PICTURE], PLAN, { pieces: PIECES })
    await pollAll(a.tab)
    await expect.poll(() => a.finish.lifting()).toHaveLength(1)

    a.end()
    await a.finish.settled()
    expect(stops[0]?.aborted).toBe(true)
    expect(a.finish.lifting()).toEqual([])
    expect(ai.finishes).toEqual([])
    expect(childrenOf(a.tab.editor.session.design(), 'ann-1')).toHaveLength(1)
  })
})
