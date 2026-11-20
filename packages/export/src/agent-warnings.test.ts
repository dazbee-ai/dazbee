import { describe, expect, it } from 'vitest'

import { openSession, plainStore } from '@dazbee/doc'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type Design, parseDesign } from '@dazbee/schema'

import { frameWarnings, runAgentBatchWithWarnings } from './agent-warnings.ts'

const ck = await loadCanvasKit()
const bytes = {
  fonts: loadFontFiles().map((f) => ({ family: f.family, bytes: f.bytes })),
  fallbackFamilies: [...FALLBACK_FAMILIES],
  images: {},
}

const style = { fontFamily: 'Noto Sans', fontSize: 24, color: '#111111FF' }
/** A text that fits its box, clear of every platform’s safe-zone edge. */
const title = {
  type: 'text',
  index: 'a1',
  name: 'Title',
  props: { x: 60, y: 200, width: 200, height: 60, boxMode: 'fixed', text: 'Sale', style },
}
/** A square well inside its frame. */
const square = {
  type: 'graphic',
  index: 'a0',
  name: 'Square',
  props: { x: 20, y: 20, width: 40, height: 40, shape: { kind: 'rect' }, fills: [] },
}

/**
 * A 9:16 frame, 360 × 640, holding a square and a text, each layer's props changed as `change`
 * says, and the frame's size and place as `frame` says.
 */
function storyWith(
  change: { square?: object; title?: object; more?: Record<string, object> } = {},
  frame: { width?: number; height?: number; x?: number; y?: number } = {},
): Design {
  const layer = (base: { props: object }, id: string, props: object = {}) => ({
    ...base,
    parentId: 'story',
    link: id,
    props: { ...base.props, ...props },
  })
  const parsed = parseDesign({
    meta: { designId: 'd', name: 'Agent' },
    pages: { p: { name: 'Page', order: 'a0' } },
    frames: { story: { pageId: 'p', name: 'Story', width: 360, height: 640, x: 0, y: 0, order: 'a0', ...frame } },
    nodes: {
      square: layer(square, 'square', change.square),
      title: layer(title, 'title', change.title),
      ...change.more,
    },
  })
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
}

const kindsOf = (design: Design, layerIds?: string[]) =>
  frameWarnings(ck, design, 'story', bytes, layerIds ? { layerIds } : {}).map(({ layerId, kind }) => [layerId, kind])

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

  it('tells of text inside a platform’s safe-zone edge on a 9:16 frame, naming the platforms', () => {
    expect(frameWarnings(ck, storyWith({ title: { y: 10 } }), 'story', bytes)).toEqual([
      {
        layerId: 'title',
        kind: 'safeZone',
        message:
          'Text "Title" is inside the safe-zone edge of Meta, YouTube and TikTok, where the platform’s own buttons and captions cover it.',
      },
    ])
    // YouTube's right edge is 64 px deep on a 360 px frame; Meta's 21.6 and TikTok's 40.
    const right = frameWarnings(ck, storyWith({ title: { x: 290, width: 25, text: 'I' } }), 'story', bytes)
    expect(right.map(({ kind, message }) => [kind, message])).toEqual([
      [
        'safeZone',
        'Text "Title" is inside the safe-zone edge of YouTube, where the platform’s own buttons and captions cover it.',
      ],
    ])
    expect(kindsOf(storyWith({ title: { y: 10 } }, { height: 360 }))).toEqual([])
    // Only text is told of.
    expect(kindsOf(storyWith({ square: { y: 0 } }))).toEqual([])
  })

  it('checks only the layers asked for', () => {
    const both = storyWith({ square: { x: 400 }, title: { y: 10 } })
    expect(kindsOf(both)).toEqual([
      ['square', 'outsideFrame'],
      ['title', 'safeZone'],
    ])
    expect(kindsOf(both, ['title'])).toEqual([['title', 'safeZone']])
    expect(kindsOf(both, [])).toEqual([])
  })
})

describe('runAgentBatchWithWarnings', () => {
  /** A session on the story, its title set in a family with no font file, which no batch below touches. */
  const open = () => openSession(plainStore(storyWith({ title: { style: { ...style, fontFamily: 'Nowhere Sans' } } })))
  const headline = {
    type: 'text',
    name: 'Headline',
    props: { x: 60, y: 10, width: 200, height: 60, boxMode: 'fixed', text: 'New', style },
  }

  it('warns of the layers a kept batch added or changed, and of no other', () => {
    const session = open()
    const result = runAgentBatchWithWarnings(
      ck,
      session,
      [
        { command: 'node.create', as: 'headline', input: { parentId: 'story', layer: headline } },
        { command: 'node.update', input: { ids: ['square'], patch: { x: 400 } } },
      ],
      bytes,
    )
    expect(result.kept).toBe(true)
    const created = result.steps[0]?.ok ? (result.steps[0].result as string) : ''
    expect(result.warnings.map(({ layerId, kind }) => [layerId, kind])).toEqual([
      ['square', 'outsideFrame'],
      [created, 'safeZone'],
    ])
    session.undo()
    expect(session.design().nodes['square']?.props.x).toBe(20)
  })

  it('gives no warnings for a batch that was not kept', () => {
    const session = open()
    const result = runAgentBatchWithWarnings(
      ck,
      session,
      [
        { command: 'node.update', input: { ids: ['square'], patch: { x: 400 } } },
        { command: 'node.update', input: { ids: ['nowhere'], patch: { x: 0 } } },
      ],
      bytes,
    )
    expect(result).toMatchObject({ kept: false, warnings: [] })
    expect(session.design().nodes['square']?.props.x).toBe(20)
  })

  it('checks the layers inside a layer the batch changed', () => {
    const turnable = {
      box: {
        type: 'box',
        index: 'a2',
        name: 'Box',
        parentId: 'story',
        link: 'box',
        props: { x: 60, y: 300, width: 200, height: 300 },
      },
      caption: { ...title, name: 'Caption', parentId: 'box', link: 'caption', props: { ...title.props, y: 300 } },
    }
    const session = openSession(plainStore(storyWith({ more: turnable })))
    // Half a turn about (160, 450) takes the caption from y 300 to y 540, in every platform's bottom edge.
    const result = runAgentBatchWithWarnings(
      ck,
      session,
      [{ command: 'node.update', input: { ids: ['box'], patch: { rotation: 180 } } }],
      bytes,
    )
    expect(result.warnings.map(({ layerId, kind }) => [layerId, kind])).toEqual([['caption', 'safeZone']])
  })

  it('checks every layer of a frame the batch changed', () => {
    const session = open()
    const result = runAgentBatchWithWarnings(
      ck,
      session,
      [{ command: 'frame.update', input: { frameId: 'story', width: 60, height: 120 } }],
      bytes,
    )
    // The square, at 20 to 60 each way, still shows; the title, from x 60, does not.
    expect(result.warnings.map(({ layerId, kind }) => [layerId, kind])).toEqual([
      ['title', 'outsideFrame'],
      ['title', 'missingFont'],
    ])
  })
})
