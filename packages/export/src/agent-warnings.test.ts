import { describe, expect, it } from 'vitest'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type Design, parseDesign } from '@dazbee/schema'

import { frameWarnings } from './agent-warnings.ts'

const ck = await loadCanvasKit()
const bytes = {
  fonts: loadFontFiles().map((f) => ({ family: f.family, bytes: f.bytes })),
  fallbackFamilies: [...FALLBACK_FAMILIES],
  images: {},
}

const style = { fontFamily: 'Noto Sans', fontSize: 24, color: '#111111FF' }
/** A text that fits its box, clear of every platform's safe-zone edge. */
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
 * says, and the frame's size as `frame` says.
 */
function storyWith(
  change: { square?: object; title?: object; more?: Record<string, object> } = {},
  frame: { width?: number; height?: number } = {},
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
})
