// The finish of frames whose split pieces the matchers rebuild as several layers: the group they are put in, the
// link ids across a job's sizes, a second finish, and the most layers a frame gets.
import { afterEach, describe, expect, it } from 'vitest'

import { childrenOf } from '@dazbee/doc'
import { frameIdOf, type MatchAnswer, MAX_PICTURE_LAYERS, pictureLayerOf } from '@dazbee/schema'

import { WORDS } from '../test-actions.ts'
import type { EditorAi } from './arrivals.ts'
import type { PieceMatcher } from './piece-matcher.ts'
import { fakeAi } from './test-ai.ts'
import { endTabs, pollAll, serve } from './test-arrivals.ts'
import {
  BADGE_PIECES,
  BADGE_PLAN,
  BADGE_READING,
  cut,
  cutOf,
  element,
  finished,
  finishing,
  layersAnswer,
  liveText,
  madeEditable,
  matchers,
  NO_PICTURE,
  placed,
  planOf,
  redRect,
  settleAll,
  sizesMadeEditable,
} from './test-layering-finish.ts'

afterEach(endTabs)

describe('editorLayeringFinish', () => {
  it('places a text piece as a live text and a shape piece as its graphics in one group, the rest as pictures, over the hidden picture', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const { asked, matcher } = matchers({
      0: layersAnswer(liveText()),
      1: layersAnswer(redRect(0, 0, 128, 128), redRect(32, 32, 64, 64)),
    })
    const a = await finishing(ai, 'ann', { matcher })
    await madeEditable(ai, a)
    ai.split('job2', 0, [NO_PICTURE], BADGE_PLAN, { pieces: BADGE_PIECES, reading: BADGE_READING })
    await finished(a)

    expect(ai.finishes).toEqual(['job2'])
    // The matchers are asked once, with the frame's pieces, its plan, its reading and the picture they were cut from.
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatchObject({
      cut: BADGE_PIECES,
      plan: BADGE_PLAN,
      reading: BADGE_READING,
      pictureAssetId: 'pic1',
    })
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

  it('links the first layer of a rebuilt piece with the same part of the job’s other size, and no other', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const { matcher } = matchers({
      0: layersAnswer(liveText()),
      1: layersAnswer(redRect(0, 0, 10, 10), redRect(2, 2, 4, 4)),
    })
    const a = await finishing(ai, 'ann', { matcher })
    await sizesMadeEditable(ai, a)
    const pieces = (width: number, height: number) =>
      cutOf(width, height, cut('e1', 'text', 0, 0, 100, 40), cut('e2', 'shape', 0, 100, 10, 10))
    ai.split('job3', 0, [NO_PICTURE], BADGE_PLAN, { pieces: pieces(576, 1024) })
    ai.split('job3', 1, [NO_PICTURE], BADGE_PLAN, { pieces: pieces(1424, 800) })
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

  it('links the first graphic of a piece’s group with the same part’s picture layer in a size where it stays a picture', async () => {
    serve(WORDS)
    const ai = fakeAi()
    // The tall size's badge comes back as two graphics; the wide size's is given no answer, and neither headline is.
    const matcher: PieceMatcher = (frame) =>
      Promise.resolve(
        new Map<number, MatchAnswer>(
          frame.cut.width === 576 ? [[1, layersAnswer(redRect(0, 0, 10, 10), redRect(2, 2, 4, 4))]] : [],
        ),
      )
    const a = await finishing(ai, 'ann', { matcher })
    await sizesMadeEditable(ai, a)
    const pieces = (width: number, height: number) =>
      cutOf(width, height, cut('e1', 'text', 0, 0, 100, 40), cut('e2', 'shape', 0, 100, 10, 10))
    ai.split('job3', 0, [NO_PICTURE], BADGE_PLAN, { pieces: pieces(576, 1024) })
    ai.split('job3', 1, [NO_PICTURE], BADGE_PLAN, { pieces: pieces(1424, 800) })
    await finished(a)

    expect(ai.finishes).toEqual(['job3'])
    const design = a.tab.editor.session.design()
    const layersIn = (parentId: string) =>
      childrenOf(design, parentId)
        .filter(([id]) => id !== pictureLayerOf(parentId))
        .map(([id, layer]) => [id, layer.type, layer.name])
    expect(layersIn('ann-6')).toEqual([
      ['job3-ann-6-1_group', 'group', 'Badge'],
      ['job3-ann-6-0', 'graphic', 'Headline'],
    ])
    expect(layersIn('job3-ann-6-1_group')).toEqual([
      ['job3-ann-6-1', 'graphic', 'Badge 1'],
      ['job3-ann-6-1_1', 'graphic', 'Badge 2'],
    ])
    expect(layersIn('ann-7')).toEqual([
      ['job3-ann-7-1', 'graphic', 'Badge'],
      ['job3-ann-7-0', 'graphic', 'Headline'],
    ])
    expect(design.nodes['job3-ann-7-1']?.props).toMatchObject({ fills: [{ type: 'image', assetId: 'cut-e2' }] })
    // The group's first graphic has the part's link id, which the wide size's picture layer of the badge has too.
    const linkOf = (id: string) => design.nodes[id]?.link
    expect(linkOf('job3-ann-6-1')?.startsWith('job3-')).toBe(true)
    expect(linkOf('job3-ann-7-1')).toBe(linkOf('job3-ann-6-1'))
    // The group and its second graphic each have a link id of their own.
    for (const id of ['job3-ann-6-1_group', 'job3-ann-6-1_1']) {
      expect(linkOf(id)?.startsWith('job3-')).toBe(false)
      expect(linkOf(id)).not.toBe(linkOf('job3-ann-6-1'))
    }
    expect(linkOf('job3-ann-6-0')).toBe(linkOf('job3-ann-7-0'))
  })

  it('leaves a piece a picture when its layers would give the frame more than Back to picture takes', async () => {
    serve(WORDS)
    const ai = fakeAi()
    const plan = planOf(
      element('s1', 'shape', 'Burst', 1),
      element('s2', 'shape', 'Ribbon', 1),
      element('s3', 'shape', 'Badge', 1),
      element('e1', 'text', 'Headline', 1, 'Big sale'),
    )
    const pieces = cutOf(
      1024,
      1024,
      cut('s1', 'shape', 0, 0, 512, 512),
      cut('s2', 'shape', 512, 0, 512, 512),
      cut('s3', 'shape', 0, 512, 512, 512),
      cut('e1', 'text', 600, 600, 200, 100),
    )
    const graphics = (count: number) => layersAnswer(...Array.from({ length: count }, (_, i) => redRect(i, 0, 8, 8)))
    // Rebuilt whole, the frame would get 301 + 301 + 101 + 1 = 704 layers.
    const { matcher } = matchers({ 0: graphics(300), 1: graphics(300), 2: graphics(100), 3: layersAnswer(liveText()) })
    const a = await finishing(ai, 'ann', { matcher })
    await madeEditable(ai, a)
    ai.split('job2', 0, [NO_PICTURE], plan, { pieces })
    await finished(a)

    expect(ai.finishes).toEqual(['job2'])
    const { session } = a.tab.editor
    const design = session.design()
    // The burst fits; the ribbon's 301 no longer do, so it stays a picture; the badge and the headline behind it fit.
    expect(childrenOf(design, 'ann-1').map(([id, layer]) => [id, layer.type, layer.name])).toEqual([
      [pictureLayerOf('ann-1'), 'graphic', 'Picture'],
      ['job2-ann-1-3', 'text', 'Headline'],
      ['job2-ann-1-2_group', 'group', 'Badge'],
      ['job2-ann-1-1', 'graphic', 'Ribbon'],
      ['job2-ann-1-0_group', 'group', 'Burst'],
    ])
    expect(design.nodes['job2-ann-1-1']?.props).toMatchObject({ fills: [{ type: 'image', assetId: 'cut-s2' }] })
    expect(childrenOf(design, 'job2-ann-1-0_group')).toHaveLength(300)
    expect(childrenOf(design, 'job2-ann-1-2_group')).toHaveLength(100)
    // Back to picture takes every layer the finish made, as the glass bar gathers them.
    const made = Object.keys(design.nodes).filter((id) => id.startsWith('job2-') && frameIdOf(design, id) === 'ann-1')
    expect(made).toHaveLength(301 + 1 + 101 + 1)
    expect(made.length).toBeLessThanOrEqual(MAX_PICTURE_LAYERS)
    session.run('frame.showPicture', {
      frameId: 'ann-1',
      pictureLayerId: pictureLayerOf('ann-1'),
      layerIds: made,
      show: true,
    })
    expect(session.design().nodes[pictureLayerOf('ann-1')]?.props.visible).toBe(true)
    expect(session.design().nodes['job2-ann-1-0_group']?.props.visible).toBe(false)
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
    const { matcher } = matchers({
      0: layersAnswer(liveText()),
      1: layersAnswer(redRect(0, 0, 128, 128), redRect(32, 32, 64, 64)),
    })
    const a = await finishing(ai, 'ann', { finishAi, matcher })
    await madeEditable(ai, a)
    ai.split('job2', 0, [NO_PICTURE], BADGE_PLAN, { pieces: BADGE_PIECES })
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
})
