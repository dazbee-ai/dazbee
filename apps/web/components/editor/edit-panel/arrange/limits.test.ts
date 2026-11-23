// A layer's least and most size as Arrange sets them, held against the editor opened in Node:
// where they apply, a limit added at the drawn size, the least kept at most the most, and both of a
// side taken out, each one undo step.
import { afterEach, describe, expect, it } from 'vitest'

import type { Editor } from '@dazbee/editor'
import { type TestEditor, testEditor } from '@dazbee/editor/test-editor'
import { frameDesign, type Seeded } from '@dazbee/editor/test-matrix'

import { set, type Target } from '@/components/editor/edit-panel/target.ts'

import { addedLimit, hasLimits, limitChoices, limitPatch, limitsApply, noLimits, offForCurved } from './limits.ts'
import { sizingChoices } from './sizing-menu.tsx'

const shape = (parentId: string, index: string, props: Record<string, unknown> = {}): Seeded =>
  ({
    type: 'graphic',
    parentId,
    index,
    name: 'Tile',
    props: { x: 0, y: 0, width: 200, height: 50, shape: { kind: 'rect' }, ...props },
  }) as Seeded
/** A row 600 wide holding a tile that fills its width and a fixed one; a free tile; a group. */
const DESIGN = frameDesign({
  name: 'Limits',
  nodes: {
    row: {
      type: 'box',
      parentId: 'sq',
      index: 'a0',
      name: 'Row',
      props: {
        x: 0,
        y: 0,
        width: 600,
        height: 100,
        layout: { direction: 'row', gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
      },
    },
    fill: shape('row', 'a0', { sizing: { width: 'fill', height: 'fixed' } }),
    fixed: shape('row', 'a1'),
    free: shape('sq', 'a1', { y: 300 }),
    group: {
      type: 'group',
      parentId: 'sq',
      index: 'a2',
      name: 'Group',
      props: { x: 0, y: 500, width: 10, height: 10 },
    },
    inGroup: shape('group', 'a0', { y: 500 }),
  },
})
/** A column holding a curved text and a straight one, each filling its width and held at least 100 wide. */
const CURVED = frameDesign({
  name: 'Curved in a column',
  nodes: {
    column: {
      type: 'box',
      parentId: 'sq',
      index: 'a0',
      name: 'Column',
      props: {
        x: 0,
        y: 0,
        width: 600,
        height: 400,
        layout: { direction: 'column', gap: 0, padding: { top: 0, right: 0, bottom: 0, left: 0 } },
      },
    },
    ...Object.fromEntries(
      (['curved', 'straight'] as const).map((id, i) => [
        id,
        {
          type: 'text',
          parentId: 'column',
          index: `a${i}`,
          name: id,
          props: {
            x: 0,
            y: 0,
            width: 300,
            height: 60,
            text: 'Round badge',
            minWidth: 100,
            sizing: { width: 'fill', height: 'hug' },
            style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#000000FF' },
            ...(id === 'curved' ? { curve: { shape: 'arcUp', amount: 50 } } : {}),
          },
        },
      ]),
    ),
  },
})
/** The layers as Arrange acts on them. */
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

describe('limitsApply', () => {
  let ed: TestEditor | undefined
  afterEach(() => ed?.end())

  it('applies to a laid-out box and to layers its flow places, not to a free layer or a group', async () => {
    ed = await testEditor(DESIGN)
    const d = ed.core.design()
    expect(limitsApply(d, ['row'])).toBe(true)
    expect(limitsApply(d, ['fill', 'fixed'])).toBe(true)
    expect(limitsApply(d, ['free'])).toBe(false)
    expect(limitsApply(d, ['fixed', 'free'])).toBe(false)
    expect(limitsApply(d, ['group'])).toBe(false)
  })
})

describe('limitPatch', () => {
  it('sets one end, moving the other to it where it would pass it', () => {
    expect(limitPatch({}, 'width', 'max', 100)).toEqual({ maxWidth: 100 })
    expect(limitPatch({ minWidth: 150 }, 'width', 'max', 100)).toEqual({ maxWidth: 100, minWidth: 100 })
    expect(limitPatch({ maxHeight: 40 }, 'height', 'min', 60)).toEqual({ minHeight: 60, maxHeight: 60 })
    expect(limitPatch({ maxHeight: 80 }, 'height', 'min', 60)).toEqual({ minHeight: 60 })
  })
})

describe('addedLimit', () => {
  it('adds the drawn size tidied as the field shows it', () => {
    expect(addedLimit({ width: 100 / 3 }, 'width', 'max')).toEqual({ maxWidth: 33.33 })
  })

  let ed: TestEditor | undefined
  afterEach(() => ed?.end())

  it('adds a most width at the drawn width, which holds the layer there as its box narrows, and is taken out with noLimits in one step', async () => {
    ed = await testEditor(DESIGN)
    // The filling tile is drawn 400 wide: what the fixed one leaves.
    set(targetOf(ed, ['fill']), (now) => addedLimit(now, 'width', 'max'))
    expect(ed.core.design().nodes.fill?.props).toMatchObject({ maxWidth: 400 })
    set(targetOf(ed, ['fill']), (now) => limitPatch(now, 'width', 'max', 250))
    expect(ed.core.drawnPropsOf('fill')).toMatchObject({ width: 250 })
    expect(ed.core.drawnPropsOf('fixed')).toMatchObject({ x: 250 })
    set(targetOf(ed, ['fill']), () => noLimits('width'))
    expect(ed.core.design().nodes.fill?.props).not.toHaveProperty('maxWidth')
    expect(ed.core.drawnPropsOf('fill')).toMatchObject({ width: 400 })
    ed.core.session.undo()
    expect(ed.core.design().nodes.fill?.props).toMatchObject({ maxWidth: 250 })
  })
})

describe('noLimits', () => {
  it('takes out both ends of one side only', () => {
    expect(noLimits('width')).toEqual({ minWidth: undefined, maxWidth: undefined })
    expect(noLimits('height')).toEqual({ minHeight: undefined, maxHeight: undefined })
  })
})

describe('hasLimits', () => {
  it('finds a least or a most on a side of any of the layers', () => {
    expect(hasLimits([{}, { maxWidth: 10 }], 'width')).toBe(true)
    expect(hasLimits([{ minHeight: 0 }], 'height')).toBe(true)
    expect(hasLimits([{ maxWidth: 10 }], 'height')).toBe(false)
  })
})

describe('limitChoices', () => {
  it('offers adding each end none of the layers has, and taking both out where any has one', () => {
    expect(limitChoices([{}, {}], 'width')).toEqual(['add-min', 'add-max'])
    expect(limitChoices([{ maxWidth: 100 }, {}], 'width')).toEqual(['add-min', 'remove'])
    expect(limitChoices([{ minWidth: 10, maxWidth: 100 }], 'width')).toEqual(['remove'])
    expect(limitChoices([{ minWidth: 10 }], 'height')).toEqual(['add-min', 'add-max'])
  })
})

describe('offForCurved', () => {
  let ed: TestEditor | undefined
  afterEach(() => ed?.end())

  it('turns off Fill and the limits for a curved text in an auto layout box, which offers them, and nothing for a straight one', async () => {
    ed = await testEditor(CURVED)
    const design = ed.core.design()
    for (const ids of [['curved'], ['curved', 'straight']]) {
      const target = targetOf(ed, ids)
      expect(sizingChoices(target, design, 'width')).toContain('fill')
      expect(limitsApply(design, ids)).toBe(true)
      expect([...offForCurved(target.props)].sort()).toEqual(['add-max', 'add-min', 'fill', 'remove'])
    }
    expect(offForCurved(targetOf(ed, ['straight']).props).size).toBe(0)
  })
})
