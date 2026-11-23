// The Font features part's raise for whole texts: the raise the selected texts' characters share,
// and a whole text raised alike, held against the editor so a whole text set to one raise reads it
// on every character in one undo step.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import type { Editor } from '@dazbee/editor'
import { type TestEditor, testEditor } from '@dazbee/editor/test-editor'
import { frameDesign } from '@dazbee/editor/test-matrix'
import { TextProps } from '@dazbee/schema'

import { set, type Target } from '@/components/editor/edit-panel/target.ts'

import { sharedRaise, textWithRaise } from './raise.ts'

const STYLE = { fontFamily: 'Noto Sans', fontSize: 40, color: '#000000FF' }
/** "$99" with its runs, and its base style's raise. */
const price = (runs: object[] = [], raise?: number) =>
  TextProps.parse({
    x: 0,
    y: 0,
    width: 200,
    height: 60,
    text: '$99',
    style: { ...STYLE, ...(raise === undefined ? {} : { raise }) },
    runs,
  })
/** A price whose "$" is raised and whose "99" is underlined. */
const DESIGN = frameDesign({
  name: 'Raise',
  nodes: {
    price: {
      type: 'text',
      parentId: 'sq',
      index: 'a0',
      name: 'Price',
      props: {
        x: 100,
        y: 100,
        width: 200,
        height: 60,
        text: '$99',
        boxMode: 'autoWidth',
        style: STYLE,
        runs: [
          { start: 0, end: 1, style: { raise: 30 } },
          { start: 1, end: 3, style: { underline: true } },
        ],
      },
    },
  },
})

/** The selection as the edit panel reads it, each layer with its own values. */
function targetOf(ed: TestEditor, ids: string[]): Target {
  const design = ed.core.design()
  return {
    editor: ed.core as unknown as Editor,
    ids,
    props: ids.map((id) => ed.core.drawnPropsOf(id)) as Target['props'],
    types: ids.map((id) => design.nodes[id]?.type ?? ''),
    names: ids.map((id) => design.nodes[id]?.name ?? ''),
  }
}

describe('sharedRaise', () => {
  it('reads the raise every character has, 0 where none is raised', () => {
    expect(sharedRaise([price(), price()])).toBe(0)
    expect(sharedRaise([price([], 30), price([{ start: 0, end: 3, style: { raise: 30 } }])])).toBe(30)
    // A run that sets no raise keeps the base style's.
    expect(sharedRaise([price([{ start: 0, end: 1, style: { underline: true } }], -20)])).toBe(-20)
  })

  it('reads mixed where any two characters differ, in one text or across texts', () => {
    expect(sharedRaise([price([{ start: 0, end: 1, style: { raise: 30 } }])])).toBe('mixed')
    expect(sharedRaise([price([], 30), price()])).toBe('mixed')
  })
})

describe('textWithRaise', () => {
  let ed: TestEditor
  beforeAll(async () => {
    ed = await testEditor(DESIGN)
  })
  afterAll(() => ed.end())

  it('sets the base style’s raise and each run’s own to it, keeping the runs’ other styles', () => {
    const text = price([
      { start: 0, end: 1, style: { raise: 30 } },
      { start: 1, end: 3, style: { raise: -10, underline: true } },
    ])
    expect(textWithRaise(text, 20)).toEqual({
      style: { ...text.style, raise: 20 },
      runs: [
        { start: 0, end: 1, style: { raise: 20 } },
        { start: 1, end: 3, style: { raise: 20, underline: true } },
      ],
    })
    expect(sharedRaise([{ ...text, ...textWithRaise(text, 20) }])).toBe(20)
  })

  it('leaves the raise out of the base style at 0', () => {
    expect(textWithRaise(price([], 30), 0).style).not.toHaveProperty('raise')
  })

  it('gives every character of a text with a raised run the one raise, in one undo step', () => {
    for (const raise of [0, 15]) {
      expect(set(targetOf(ed, ['price']), (now) => textWithRaise(now as TextProps, raise))).toBe(true)
      const now = ed.core.drawnPropsOf('price')
      expect(sharedRaise([now])).toBe(raise)
      expect((now as TextProps).runs.some((run) => run.style.underline)).toBe(true)
      ed.core.session.undo()
      expect(sharedRaise([ed.core.drawnPropsOf('price')])).toBe('mixed')
    }
  })
})
