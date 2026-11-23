// A text's paint in its Colour panel: what its characters show, across its runs and several texts,
// and what a pick of an image fill, a gradient or a colour writes, held against the editor, on whole
// texts with their painted runs and on the run selected while typing, each pick one undo step.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Editor } from '@dazbee/editor'
import { type TestEditor, testEditor } from '@dazbee/editor/test-editor'
import { frameDesign } from '@dazbee/editor/test-matrix'
import type { ImagePaint, Paint } from '@dazbee/schema'

import type { Style, Target } from './target.ts'
import { colourTexts, firstTextPaint, pickTextPaint, shownTextPaint, textPaint } from './text-paint.ts'

/** A photo one pixel square, as a PNG. */
const PIXEL = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)
const STYLE = {
  fontFamily: 'Noto Sans',
  fontWeight: 400,
  fontStyle: 'normal',
  fontSize: 40,
  color: '#112233FF',
  letterSpacing: { unit: 'percent', value: 0 },
} as const
const PHOTO = { type: 'image', assetId: 'photo-1', fit: 'fill', opacity: 1 } as const
const TILED = { type: 'image', assetId: 'pattern-1', fit: 'tile', tileScale: 0.5, opacity: 1 } as const
const LINEAR: Paint = {
  type: 'linear',
  from: { x: 0, y: 0 },
  to: { x: 1, y: 0 },
  stops: [
    { offset: 0, color: '#FF0000FF' },
    { offset: 1, color: '#0000FFFF' },
  ],
}
const RED: Paint = { type: 'solid', color: '#FF0000FF' }
/** Every adjustment at none. */
const ADJUST = { exposure: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0 }
const INK = '#1A1420FF'
/** FRESH bold in its own colour and BREW tiled, their runs covering a base style filled with the photo. */
const WORDS = {
  text: 'FRESH BREW',
  style: { ...STYLE, image: PHOTO },
  runs: [
    { start: 0, end: 6, style: { color: INK, fontWeight: 700 } },
    { start: 6, end: 10, style: { image: TILED } },
  ],
}
/** Two plain texts, one already filled with the photo, and WORDS. */
const DESIGN = frameDesign({
  name: 'Paints',
  nodes: {
    plain: {
      type: 'text',
      parentId: 'sq',
      index: 'a0',
      name: 'Plain',
      props: { x: 100, y: 100, width: 400, height: 60, text: 'Summer', boxMode: 'fixed', style: STYLE },
    },
    other: {
      type: 'text',
      parentId: 'sq',
      index: 'a1',
      name: 'Other',
      props: { x: 100, y: 300, width: 400, height: 60, text: 'Sale', boxMode: 'fixed', style: STYLE },
    },
    filled: {
      type: 'text',
      parentId: 'sq',
      index: 'a2',
      name: 'Filled',
      props: {
        x: 100,
        y: 500,
        width: 400,
        height: 60,
        text: 'Hats',
        boxMode: 'fixed',
        style: { ...STYLE, image: PHOTO },
      },
    },
    words: {
      type: 'text',
      parentId: 'sq',
      index: 'a3',
      name: 'Words',
      props: { x: 100, y: 700, width: 400, height: 60, boxMode: 'fixed', ...WORDS },
    },
  },
})

/** The selection as the edit panel reads it, each layer with its own values, and the selected run's styles while one is edited. */
function targetOf(ed: TestEditor, ids: string[]): Target {
  const design = ed.core.design()
  return {
    editor: ed.core as unknown as Editor,
    ids,
    props: ids.map((id) => ed.core.drawnPropsOf(id)) as Target['props'],
    types: ids.map((id) => design.nodes[id]?.type ?? ''),
    names: ids.map((id) => design.nodes[id]?.name ?? ''),
    range: (ed.core.textSelectionStyles() as Style[] | null) ?? undefined,
  }
}

const styleOf = (ed: TestEditor, id: string) => ed.core.drawnPropsOf(id).style as Style

describe('textPaint', () => {
  it('reads a style’s image fill, else its gradient, else its colour as a solid', () => {
    expect(textPaint({ ...STYLE, image: PHOTO } as Style)).toEqual(PHOTO)
    expect(textPaint({ ...STYLE, gradient: LINEAR } as Style)).toEqual(LINEAR)
    expect(textPaint(STYLE as Style)).toEqual({ type: 'solid', color: '#112233FF' })
  })

  it('reads a hidden image fill as the colour it shows', () => {
    expect(textPaint({ ...STYLE, image: { ...PHOTO, visible: false } } as Style)).toEqual({
      type: 'solid',
      color: '#112233FF',
    })
  })
})

describe('shownTextPaint', () => {
  let ed: TestEditor
  beforeAll(async () => {
    ed = await testEditor(DESIGN, { sources: { assetBytes: () => Promise.resolve(PIXEL) } })
  })
  afterAll(() => ed.end())

  it('reads the image fill every selected text shows, and mixed where one shows a colour', () => {
    expect(shownTextPaint(targetOf(ed, ['filled']))).toEqual(PHOTO)
    expect(shownTextPaint(targetOf(ed, ['filled', 'plain']))).toBe('mixed')
  })

  it('reads every character of a text: its runs’ paints, and not a base paint its runs cover', () => {
    expect(shownTextPaint(targetOf(ed, ['words']))).toBe('mixed')
    const tiled = { ...WORDS.runs[1], start: 0 }
    expect(shownTextPaint({ ...targetOf(ed, ['words']), props: [{ ...WORDS, runs: [tiled] }] })).toEqual(TILED)
  })

  it('reads the selected run’s paint while typing', () => {
    ed.core.select(['words'])
    ed.core.perform('goIn')
    ed.modules.typing.selectText({ start: 7, end: 9 })
    expect(shownTextPaint(targetOf(ed, ['words']))).toEqual(TILED)
  })
})

describe('firstTextPaint', () => {
  it('gives the picker the first paint a text’s characters show', () => {
    const target = { range: undefined, props: [WORDS] } as unknown as Target
    expect(firstTextPaint(target)).toEqual({ type: 'solid', color: INK })
    const later = { ...WORDS, runs: [WORDS.runs[1]] }
    expect(firstTextPaint({ range: undefined, props: [later] } as unknown as Target)).toEqual(PHOTO)
  })
})

describe('colourTexts', () => {
  let ed: TestEditor
  beforeAll(async () => {
    ed = await testEditor(DESIGN, { sources: { assetBytes: () => Promise.resolve(PIXEL) } })
  })
  afterAll(() => ed.end())

  it('takes a text’s image fill off for the colour picked, in one undo step', () => {
    ed.core.select(['filled'])
    expect(colourTexts(targetOf(ed, ['filled']), '#00FF00')).toBe(true)
    expect(styleOf(ed, 'filled')).toEqual({ ...STYLE, color: '#00FF00FF' })
    ed.core.session.undo()
    expect(styleOf(ed, 'filled')).toEqual({ ...STYLE, image: PHOTO })
  })

  it('colours every character of a text, its painted runs too, taking their image fills off', () => {
    ed.core.select(['words'])
    expect(colourTexts(targetOf(ed, ['words']), '#FF0000')).toBe(true)
    expect(shownTextPaint(targetOf(ed, ['words']))).toEqual(RED)
    expect((ed.core.drawnPropsOf('words').runs as { style: Style }[])[0]?.style.fontWeight).toBe(700)
    ed.core.session.undo()
    expect(shownTextPaint(targetOf(ed, ['words']))).toBe('mixed')
  })

  it('takes the image fill off only the run selected while typing', () => {
    ed.core.select(['plain'])
    ed.core.perform('goIn')
    ed.modules.typing.selectText({ start: 1, end: 3 })
    expect(pickTextPaint(targetOf(ed, ['plain']), () => PHOTO)).toBe(true)
    expect(colourTexts(targetOf(ed, ['plain']), '#FF0000')).toBe(true)
    const runs = ed.core.drawnPropsOf('plain').runs as { start: number; end: number; style: Style }[]
    expect(runs.map((r) => [r.start, r.end, textPaint({ ...STYLE, ...r.style } as Style)])).toEqual([[1, 3, RED]])
    ed.core.session.undo()
    ed.core.session.undo()
    expect(ed.core.drawnPropsOf('plain').runs).toEqual([])
  })
})

describe('pickTextPaint', () => {
  let ed: TestEditor
  beforeAll(async () => {
    ed = await testEditor(DESIGN, { sources: { assetBytes: () => Promise.resolve(PIXEL) } })
  })
  afterAll(() => ed.end())

  it('fills each selected text with an image picked, keeping its colour under it, in one undo step', () => {
    ed.core.select(['plain', 'other'])
    expect(pickTextPaint(targetOf(ed, ['plain', 'other']), () => TILED)).toBe(true)
    for (const id of ['plain', 'other']) expect(styleOf(ed, id)).toEqual({ ...STYLE, image: TILED })

    ed.core.session.undo()
    for (const id of ['plain', 'other']) expect(styleOf(ed, id)).toEqual(STYLE)
  })

  it('takes a text’s image fill off for a gradient, and the gradient off for a colour', () => {
    ed.core.select(['filled'])
    expect(pickTextPaint(targetOf(ed, ['filled']), () => LINEAR)).toBe(true)
    expect(styleOf(ed, 'filled')).toEqual({ ...STYLE, gradient: LINEAR })
    expect(pickTextPaint(targetOf(ed, ['filled']), () => RED)).toBe(true)
    expect(styleOf(ed, 'filled')).toEqual({ ...STYLE, color: '#FF0000FF' })
    ed.core.session.undo()
    ed.core.session.undo()
    expect(styleOf(ed, 'filled')).toEqual({ ...STYLE, image: PHOTO })
  })

  it('fills every character of a text with an image picked, its painted runs too', () => {
    ed.core.select(['words'])
    expect(pickTextPaint(targetOf(ed, ['words']), () => LINEAR)).toBe(true)
    expect(shownTextPaint(targetOf(ed, ['words']))).toEqual(LINEAR)
    expect(pickTextPaint(targetOf(ed, ['words']), () => PHOTO)).toBe(true)
    expect(shownTextPaint(targetOf(ed, ['words']))).toEqual(PHOTO)
    ed.core.session.undo()
    ed.core.session.undo()
    expect(ed.core.drawnPropsOf('words').runs).toEqual(WORDS.runs)
  })

  it('brings back the colour kept under an image fill when the picker switches it to Solid', () => {
    ed.core.select(['filled'])
    // The picker's Solid turns an image into its grey; the text takes its own colour instead.
    expect(pickTextPaint(targetOf(ed, ['filled']), () => ({ type: 'solid', color: '#D9D9D9FF' }))).toBe(true)
    expect(styleOf(ed, 'filled')).toEqual(STYLE)
    ed.core.session.undo()
  })

  it('changes a text’s image fill from its own: its fit, tile scale, filter and adjustments', () => {
    ed.core.select(['filled'])
    const tiled = (now: Paint): Paint =>
      now.type === 'image'
        ? { ...now, fit: 'tile', tileScale: 2, filter: 'mono', adjust: { ...ADJUST, contrast: 20 } }
        : now
    expect(pickTextPaint(targetOf(ed, ['filled']), tiled)).toBe(true)
    expect(styleOf(ed, 'filled').image).toEqual({
      ...PHOTO,
      fit: 'tile',
      tileScale: 2,
      filter: 'mono',
      adjust: { ...ADJUST, contrast: 20 },
    })
    ed.core.session.undo()
  })

  it('writes a cropped image as one filling the box, as a text holds no crop', () => {
    ed.core.select(['plain'])
    const cropped: ImagePaint = { ...PHOTO, fit: 'crop', crop: { x: 0, y: 0, width: 1, height: 1 } }
    expect(pickTextPaint(targetOf(ed, ['plain']), () => cropped)).toBe(true)
    expect(styleOf(ed, 'plain').image).toEqual(PHOTO)
    ed.core.session.undo()
  })

  it('fills only the run selected while typing, and a gradient picked over it takes it off', () => {
    ed.core.select(['plain'])
    ed.core.perform('goIn')
    ed.modules.typing.selectText({ start: 1, end: 3 })
    expect(pickTextPaint(targetOf(ed, ['plain']), () => PHOTO)).toBe(true)
    const filled = ed.core.drawnPropsOf('plain')
    expect(filled.style).toEqual(STYLE)
    expect(filled.runs).toEqual([{ start: 1, end: 3, style: { image: PHOTO } }])
    expect(shownTextPaint(targetOf(ed, ['plain']))).toEqual(PHOTO)

    expect(pickTextPaint(targetOf(ed, ['plain']), () => LINEAR)).toBe(true)
    expect(ed.core.drawnPropsOf('plain').runs).toEqual([{ start: 1, end: 3, style: { gradient: LINEAR } }])

    ed.core.session.undo()
    ed.core.session.undo()
    expect(ed.core.drawnPropsOf('plain').runs).toEqual([])
  })
})
