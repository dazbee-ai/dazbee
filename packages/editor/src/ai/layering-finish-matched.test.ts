// The finish of frames whose split pieces the matchers rebuild as live layers.
import { afterEach, describe, expect, it } from 'vitest'

import { childrenOf, fittedText } from '@dazbee/doc'
import { type MatchAnswer, pictureLayerOf } from '@dazbee/schema'

import { WORDS } from '../test-actions.ts'
import type { PieceMatcher } from './piece-matcher.ts'
import { fakeAi } from './test-ai.ts'
import { endTabs, pollAll, serve } from './test-arrivals.ts'
import {
  BADGE_PIECES,
  BADGE_PLAN,
  finished,
  finishing,
  layersAnswer,
  liveText,
  madeEditable,
  matchers,
  NO_PICTURE,
  placed,
  redRect,
  settleAll,
} from './test-layering-finish.ts'

afterEach(endTabs)

describe('editorLayeringFinish', () => {
  it('fits a live text to its words as the editor measures them', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const a = await finishing(ai, 'ann', { matcher: matchers({ 0: layersAnswer(liveText()) }).matcher })
    await madeEditable(ai, a)
    ai.split('job2', 0, [NO_PICTURE], BADGE_PLAN, { pieces: BADGE_PIECES })
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
    ai.split('job2', 0, [NO_PICTURE], BADGE_PLAN, { pieces: BADGE_PIECES })
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
    const bound = liveText({ textColor: 'brand:primary', fontFamily: 'brand:heading' })
    const a = await finishing(ai, 'ann', { matcher: matchers({ 0: layersAnswer(bound) }).matcher })
    await madeEditable(ai, a)
    ai.split('job2', 0, [NO_PICTURE], BADGE_PLAN, { pieces: BADGE_PIECES })
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
    ai.split('job2', 0, [NO_PICTURE], BADGE_PLAN, { pieces: BADGE_PIECES })
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

    answer(new Map([[0, layersAnswer(liveText())]]))
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
    ai.split('job2', 0, [NO_PICTURE], BADGE_PLAN, { pieces: BADGE_PIECES })
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

  it('places every piece as a picture on the last try, when the design refuses a rebuilt layer', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const { matcher } = matchers({ 1: layersAnswer(redRect(0, 0, 128, 128), redRect(32, 32, 64, 64)) })
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
    ai.split('job2', 0, [NO_PICTURE], BADGE_PLAN, { pieces: BADGE_PIECES })
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
    const a = await finishing(ai, 'ann', {
      matcher: matchers({ 0: layersAnswer(liveText({ image: 'brand:logo' })) }).matcher,
    })
    await madeEditable(ai, a)
    ai.split('job2', 0, [NO_PICTURE], BADGE_PLAN, { pieces: BADGE_PIECES })
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
    ai.split('job2', 0, [NO_PICTURE], BADGE_PLAN, { pieces: BADGE_PIECES })
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
    ai.split('job2', 0, [NO_PICTURE], BADGE_PLAN, { pieces: BADGE_PIECES })
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
