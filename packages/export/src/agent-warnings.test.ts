import { describe, expect, it } from 'vitest'

import { openSession, plainStore } from '@dazbee/doc'

import { frameWarnings, runAgentBatchWithWarnings, whenWarned } from './agent-warnings.ts'
import {
  bytes,
  ck,
  fontsHere,
  kindsOf,
  logo,
  over,
  second,
  square,
  storyWith,
  style,
  title,
  white,
} from './test-story.ts'

describe('frameWarnings', () => {
  it('gives none for a clean frame', () => {
    expect(frameWarnings(ck, storyWith(), 'story', bytes)).toEqual([])
  })

  it('names a family that has no font file, drawn in a fallback font', () => {
    const warnings = frameWarnings(
      ck,
      storyWith({ title: { style: { ...style, fontFamily: 'Nowhere Sans' } } }),
      'story',
      bytes,
    )
    expect(warnings).toEqual([
      {
        layerId: 'title',
        kind: 'missingFont',
        message: 'Text "Title" is set in "Nowhere Sans", which has no font file, so it draws in a fallback font.',
      },
    ])
  })

  it('names the characters no font has', () => {
    const warnings = frameWarnings(ck, storyWith({ title: { text: 'Runes ᚠ ᚠ 𝄞' } }), 'story', bytes)
    expect(warnings).toEqual([
      {
        layerId: 'title',
        kind: 'missingCharacters',
        message: 'Text "Title" has characters no font has, which draw as empty boxes: ᚠ 𝄞',
      },
    ])
  })

  it('tells of text that overflows its fixed box', () => {
    const warnings = frameWarnings(ck, storyWith({ title: { height: 10 } }), 'story', bytes)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({ layerId: 'title', kind: 'overflow' })
    expect(warnings[0]?.message).toMatch(
      /^Text "Title" overflows its fixed box: its lines are \d+ px tall in a box 10 px tall\.$/,
    )
    const word = frameWarnings(
      ck,
      storyWith({ title: { text: 'Supercalifragilistic', width: 60, height: 200 } }),
      'story',
      bytes,
    )
    expect(word.map(({ kind, message }) => [kind, message])).toEqual([
      ['overflow', 'Text "Title" overflows its fixed box: a word is wider than the box, 60 px.'],
    ])
    // A text that grows with its words does not overflow.
    expect(kindsOf(storyWith({ title: { height: 10, boxMode: 'autoHeight' } }))).toEqual([])
  })

  it('tells of text past its maxLines, a later paragraph cut or a long one', () => {
    const paragraphs = storyWith({
      title: { text: 'One\nTwo\nThree', boxMode: 'autoHeight', height: 200, maxLines: 2 },
    })
    expect(frameWarnings(ck, paragraphs, 'story', bytes)).toEqual([
      {
        layerId: 'title',
        kind: 'pastMaxLines',
        message: 'Text "Title" has more lines than its limit of 2, so the rest is cut off.',
      },
    ])
    const wrapped = storyWith({ title: { text: 'one two three four five six seven', width: 60, maxLines: 1 } })
    expect(kindsOf(wrapped)).toEqual([['title', 'pastMaxLines']])
    expect(kindsOf(storyWith({ title: { text: 'One\nTwo', boxMode: 'autoHeight', maxLines: 2 } }))).toEqual([])
  })
  it('tells of a layer wholly outside its frame, not of one partly in it or its children', () => {
    expect(frameWarnings(ck, storyWith({ square: { x: 400 } }), 'story', bytes)).toEqual([
      {
        layerId: 'square',
        kind: 'outsideFrame',
        message: 'Layer "Square" is wholly outside its frame "Story", so none of it shows.',
      },
    ])
    expect(kindsOf(storyWith({ square: { x: 340 } }))).toEqual([])
    // A layer's place is in its frame, wherever the frame is on the page.
    expect(kindsOf(storyWith({}, { x: 2000, y: 500 }))).toEqual([])
    expect(kindsOf(storyWith({ square: { x: 400 } }, { x: -2000 }))).toEqual([['square', 'outsideFrame']])
    const group = { type: 'group', index: 'a2', name: 'Group', parentId: 'story', link: 'group' }
    const inGroup = storyWith({
      more: {
        group: { ...group, props: { x: 400, y: 20, width: 40, height: 40 } },
        dot: { ...square, name: 'Dot', parentId: 'group', link: 'dot', props: { ...square.props, x: 400 } },
      },
    })
    expect(kindsOf(inGroup)).toEqual([['group', 'outsideFrame']])
    expect(kindsOf(inGroup, ['dot'])).toEqual([['dot', 'outsideFrame']])
  })

  it('turns a layer by the box it is in before telling whether it is outside', () => {
    const box = { type: 'box', index: 'a2', name: 'Box', parentId: 'story', link: 'box' }
    // The box turns half a turn about (50, 150), which takes the dot from x -50 to x 110.
    const turned = storyWith({
      more: {
        box: { ...box, props: { x: -50, y: 100, width: 200, height: 100, rotation: 180 } },
        dot: { ...square, name: 'Dot', parentId: 'box', link: 'dot', props: { ...square.props, x: -50, y: 120 } },
      },
    })
    expect(kindsOf(turned)).toEqual([])
  })

  it('tells nothing of text inside a platform’s safe-zone edge', () => {
    expect(kindsOf(storyWith({ title: { y: 10 } }))).toEqual([])
    expect(kindsOf(storyWith({ title: { x: 290, width: 25, text: 'I' } }))).toEqual([])
  })

  it('tells of text smaller than the readable size for its frame, by its smallest letters', () => {
    expect(frameWarnings(ck, storyWith({}, { width: 1080, height: 1920 }), 'story', bytes)).toEqual([
      {
        layerId: 'title',
        kind: 'tooSmall',
        message: 'Text "Title" is set at 24 px, under the readable size of 33 px for a 1080 × 1920 frame.',
      },
    ])
    const big = { style: { ...style, fontSize: 40 } }
    expect(kindsOf(storyWith({ title: big }, { width: 1080, height: 1920 }))).toEqual([])
    // A banner shows at its own pixels.
    const banner = { width: 300, height: 250 }
    expect(kindsOf(storyWith({ title: { style: { ...style, fontSize: 10 } } }, banner))).toEqual([
      ['title', 'tooSmall'],
    ])
    expect(kindsOf(storyWith({ title: { style: { ...style, fontSize: 11 } } }, banner))).toEqual([])
    const run = { ...big, text: 'Sale now', runs: [{ start: 5, end: 8, style: { fontSize: 20 } }] }
    expect(
      frameWarnings(ck, storyWith({ title: run }, { width: 1080, height: 1920 }), 'story', bytes).map(
        ({ message }) => message,
      ),
    ).toEqual(['Text "Title" is set at 20 px, under the readable size of 33 px for a 1080 × 1920 frame.'])
  })

  it('tells of text whose contrast with what is drawn behind it is under the ratio its size needs', () => {
    const whiteText = { style: { ...style, color: '#FFFFFFFF' } }
    expect(frameWarnings(ck, storyWith({ title: whiteText }, { fills: [white] }), 'story', bytes)).toEqual([
      {
        layerId: 'title',
        kind: 'lowContrast',
        message:
          'Text "Title" is hard to read against what is drawn behind it: its contrast is 1.0:1 where lowest, and text this size needs 3:1.',
      },
    ])
    expect(kindsOf(storyWith({}, { fills: [white] }))).toEqual([])
    // Grey on white is 4.48:1: enough for large text, not for small.
    const grey = (fontSize: number) => ({ style: { ...style, fontSize, color: '#777777FF' } })
    expect(kindsOf(storyWith({ title: grey(24) }, { fills: [white] }))).toEqual([])
    const small = frameWarnings(ck, storyWith({ title: grey(14) }, { fills: [white] }), 'story', bytes)
    expect(small.map(({ kind }) => kind)).toEqual(['lowContrast'])
    expect(small[0]?.message).toMatch(/and text this size needs 4\.5:1\.$/)
    // A transparent frame shows on white.
    expect(kindsOf(storyWith({ title: whiteText }))).toEqual([['title', 'lowContrast']])
  })

  it('measures contrast against the photo drawn behind the text', () => {
    const photo = over('photo', {
      type: 'graphic',
      name: 'Photo',
      index: 'a0V',
      props: {
        x: 0,
        y: 0,
        width: 360,
        height: 640,
        shape: { kind: 'rect' },
        fills: [{ type: 'image', assetId: 'halves' }],
      },
    })
    const whiteText = { width: 140, style: { ...style, color: '#FFFFFFFF' } }
    expect(kindsOf(storyWith({ title: { ...whiteText, x: 20 }, more: photo }))).toEqual([['title', 'lowContrast']])
    expect(kindsOf(storyWith({ title: { ...whiteText, x: 200 }, more: photo }))).toEqual([])
  })

  it('counts a text’s own outline as drawn behind its letters', () => {
    const outline = { width: 3, color: '#000000FF', under: true }
    const outlined = { style: { ...style, color: '#FFFFFFFF', outline } }
    expect(kindsOf(storyWith({ title: outlined }, { fills: [white] }))).toEqual([])
  })

  it('tells of text whose letters overlap another text’s or the logo, once, on the layer above', () => {
    expect(frameWarnings(ck, storyWith({ more: second({ x: 64 }) }), 'story', bytes)).toEqual([
      { layerId: 'second', kind: 'overlap', message: 'Text "Second" overlaps text "Title".' },
    ])
    // Asked for only the text below, it is told of there.
    expect(frameWarnings(ck, storyWith({ more: second({ x: 64 }) }), 'story', bytes, { layerIds: ['title'] })).toEqual([
      { layerId: 'title', kind: 'overlap', message: 'Text "Title" overlaps text "Second".' },
    ])
    expect(kindsOf(storyWith({ more: second({ y: 300 }) }))).toEqual([])
    // Boxes that overlap where no letters are don't count.
    expect(kindsOf(storyWith({ more: second({ x: 180 }) }))).toEqual([])
    expect(frameWarnings(ck, storyWith({ more: logo({ x: 60, y: 210 }) }), 'story', bytes)).toEqual([
      { layerId: 'logo', kind: 'overlap', message: 'Logo "Logo" overlaps text "Title".' },
    ])
    const bound = { bindings: { image: 'brand:logo' } }
    expect(kindsOf(storyWith({ more: logo({ x: 60, y: 210 }, bound) }))).toEqual([['logo', 'overlap']])
    // Any other layer may sit under or over text.
    expect(kindsOf(storyWith({ more: logo({ x: 60, y: 210 }, {}) }))).toEqual([])
  })

  it('tells of text or a logo partly cut off at the frame’s edge, by what it draws', () => {
    expect(frameWarnings(ck, storyWith({ title: { x: 330 } }), 'story', bytes)).toEqual([
      { layerId: 'title', kind: 'cutOff', message: 'Text "Title" is cut off at the edge of its frame "Story".' },
    ])
    // Its box passes the edge, but its letters don't.
    expect(kindsOf(storyWith({ title: { x: 300, text: 'I' } }))).toEqual([])
    expect(kindsOf(storyWith({ more: logo({ x: 340 }) }))).toEqual([['logo', 'cutOff']])
    expect(kindsOf(storyWith({ more: logo({ x: 340 }, {}) }))).toEqual([])
  })

  it('checks only the layers asked for', () => {
    const both = storyWith({ square: { x: 400 }, title: { x: 330 } })
    expect(kindsOf(both)).toEqual([
      ['square', 'outsideFrame'],
      ['title', 'cutOff'],
    ])
    expect(kindsOf(both, ['title'])).toEqual([['title', 'cutOff']])
    expect(kindsOf(both, [])).toEqual([])
  })
})

describe('runAgentBatchWithWarnings', () => {
  /** A session on the story, its title set in a family with no font file, which no batch below touches. */
  const open = () => openSession(plainStore(storyWith({ title: { style: { ...style, fontFamily: 'Nowhere Sans' } } })))
  const headline = {
    type: 'text',
    name: 'Headline',
    props: { x: 330, y: 10, width: 200, height: 60, boxMode: 'fixed', text: 'New', style },
  }

  it('warns of the layers a kept batch added or changed, and of no other', async () => {
    const session = open()
    const result = await whenWarned(
      runAgentBatchWithWarnings(
        ck,
        session,
        [
          { command: 'node.create', as: 'headline', input: { parentId: 'story', layer: headline } },
          { command: 'node.update', input: { ids: ['square'], patch: { x: 400 } } },
        ],
        fontsHere(),
      ),
    )
    expect(result.kept).toBe(true)
    const created = result.steps[0]?.ok ? (result.steps[0].result as string) : ''
    expect(result.warnings.map(({ layerId, kind }) => [layerId, kind])).toEqual([
      ['square', 'outsideFrame'],
      [created, 'cutOff'],
    ])
    session.undo()
    expect(session.design().nodes['square']?.props.x).toBe(20)
  })

  it('reads its warnings with the fonts there are once the faces the batch uses have loaded', async () => {
    const session = open()
    const arriving = { family: 'Brand Serif', bytes: bytes.fonts[0]?.bytes ?? new Uint8Array() }
    let fonts = bytes
    let load = () => {}
    const loading = {
      fontsLoaded: () => new Promise<void>((resolve) => (load = resolve)),
      bytes: () => fonts,
    }
    const branded = { ...headline, props: { ...headline.props, style: { ...style, fontFamily: 'Brand Serif' } } }
    const { warned, ...result } = runAgentBatchWithWarnings(
      ck,
      session,
      [
        { command: 'node.create', input: { id: 'branded', parentId: 'story', layer: branded } },
        { command: 'node.update', input: { ids: ['title'], patch: { y: 300 } } },
      ],
      loading,
    )
    expect(result.kept).toBe(true)
    fonts = { ...bytes, fonts: [...bytes.fonts, arriving] }
    load()
    expect((await warned).warnings.map(({ layerId, kind }) => [layerId, kind])).toEqual([
      ['title', 'missingFont'],
      ['branded', 'cutOff'],
    ])
  })

  it('reads the layers it touched as the design holds them once the fonts have loaded, and no others', async () => {
    const session = open()
    const stray = { type: 'graphic' as const, name: 'Stray', props: { ...square.props, x: 400 } }
    const middle = { ...headline, props: { ...headline.props, x: 60, y: 300 } }
    const { warned, ...result } = runAgentBatchWithWarnings(
      ck,
      session,
      [{ command: 'node.create', input: { id: 'middle', parentId: 'story', layer: middle } }],
      {
        // While the fonts load, the text is moved past the frame's edge, and another layer is added outside the frame.
        fontsLoaded: async () => {
          session.run('node.update', { ids: ['middle'], patch: { x: 330 } })
          session.run('node.create', { id: 'stray', parentId: 'story', layer: stray })
        },
        bytes: () => bytes,
      },
    )
    expect(result.kept).toBe(true)
    expect((await warned).warnings.map(({ layerId, kind }) => [layerId, kind])).toEqual([['middle', 'cutOff']])
  })

  it('gives no warnings for a batch that was not kept', async () => {
    const session = open()
    const result = await whenWarned(
      runAgentBatchWithWarnings(
        ck,
        session,
        [
          { command: 'node.update', input: { ids: ['square'], patch: { x: 400 } } },
          { command: 'node.update', input: { ids: ['nowhere'], patch: { x: 0 } } },
        ],
        fontsHere(),
      ),
    )
    expect(result).toMatchObject({ kept: false, warnings: [] })
    expect(session.design().nodes['square']?.props.x).toBe(20)
  })

  it('checks the layers inside a layer the batch changed', async () => {
    const turnable = {
      box: {
        type: 'box',
        index: 'a2',
        name: 'Box',
        parentId: 'story',
        link: 'box',
        props: { x: 150, y: 300, width: 300, height: 300 },
      },
      caption: {
        ...title,
        name: 'Caption',
        parentId: 'box',
        link: 'caption',
        props: { ...title.props, x: 200, y: 300 },
      },
    }
    const session = openSession(plainStore(storyWith({ more: turnable })))
    // Half a turn about (300, 450) takes the caption's letters from x 200 to 250 to x 350 to 400, past the edge.
    const result = await whenWarned(
      runAgentBatchWithWarnings(
        ck,
        session,
        [{ command: 'node.update', input: { ids: ['box'], patch: { rotation: 180 } } }],
        fontsHere(),
      ),
    )
    expect(result.warnings.map(({ layerId, kind }) => [layerId, kind])).toEqual([['caption', 'cutOff']])
  })

  it('checks the contrast of a text it didn’t touch over a layer it changed, and nothing else of it', async () => {
    const band = {
      type: 'graphic',
      index: 'a0V',
      name: 'Band',
      parentId: 'story',
      link: 'band',
      props: { x: 0, y: 180, width: 360, height: 100, shape: { kind: 'rect' }, fills: [white] },
    }
    const session = openSession(
      plainStore(storyWith({ title: { style: { ...style, fontFamily: 'Nowhere Sans' } }, more: { band } })),
    )
    const darker = { fills: [{ type: 'solid', color: '#111111FF' }] }
    const result = await whenWarned(
      runAgentBatchWithWarnings(
        ck,
        session,
        [{ command: 'node.update', input: { ids: ['band'], patch: darker } }],
        fontsHere(),
      ),
    )
    expect(result.warnings.map(({ layerId, kind }) => [layerId, kind])).toEqual([['title', 'lowContrast']])
  })

  it('checks the layers left in the box a layer was moved out of', async () => {
    const holder = {
      type: 'box',
      index: 'a2',
      name: 'Holder',
      parentId: 'story',
      link: 'holder',
      props: { x: 0, y: 300, width: 360, height: 100 },
    }
    const note = {
      ...title,
      name: 'Note',
      parentId: 'holder',
      link: 'note',
      props: { ...title.props, y: 300, style: { ...style, fontFamily: 'Nowhere Sans' } },
    }
    const dot = { ...square, name: 'Dot', parentId: 'holder', link: 'dot', props: { ...square.props, y: 320 } }
    const session = openSession(plainStore(storyWith({ more: { holder, note, dot } })))
    const result = await whenWarned(
      runAgentBatchWithWarnings(
        ck,
        session,
        [{ command: 'node.move', input: { id: 'dot', parentId: 'story' } }],
        fontsHere(),
      ),
    )
    expect(result.kept).toBe(true)
    expect(result.warnings.map(({ layerId, kind }) => [layerId, kind])).toEqual([['note', 'missingFont']])
  })

  it('keeps the outcome of a kept batch when its warnings cannot be read', async () => {
    const session = open()
    const broken = { ...bytes, images: { torn: new Uint8Array([1, 2, 3]) } }
    const result = await whenWarned(
      runAgentBatchWithWarnings(
        ck,
        session,
        [{ command: 'node.create', as: 'headline', input: { parentId: 'story', layer: headline } }],
        fontsHere(broken),
      ),
    )
    expect(result).toMatchObject({
      kept: true,
      warnings: [],
      warningsError: 'CanvasKit can\'t decode the image for asset "torn"',
    })
    expect(result.steps[0]).toMatchObject({ ok: true, result: expect.any(String) })
  })

  it('checks every layer of a frame the batch changed', async () => {
    const session = open()
    const result = await whenWarned(
      runAgentBatchWithWarnings(
        ck,
        session,
        [{ command: 'frame.update', input: { frameId: 'story', width: 60, height: 120 } }],
        fontsHere(),
      ),
    )
    // The square, at 20 to 60 each way, still shows; the title, from x 60, does not.
    expect(result.warnings.map(({ layerId, kind }) => [layerId, kind])).toEqual([
      ['title', 'outsideFrame'],
      ['title', 'missingFont'],
    ])
  })
})

describe('whenWarned', () => {
  it('gives what came of the batch with its warnings', async () => {
    const run = runAgentBatchWithWarnings(
      ck,
      openSession(plainStore(storyWith())),
      [{ command: 'node.update', input: { ids: ['square'], patch: { x: 400 } } }],
      fontsHere(),
    )
    const { warned, ...result } = run
    expect(await whenWarned(run)).toEqual({ ...result, ...(await warned) })
    expect((await warned).warnings.map(({ layerId, kind }) => [layerId, kind])).toEqual([['square', 'outsideFrame']])
  })
})
