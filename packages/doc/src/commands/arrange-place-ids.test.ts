// What design.place returns: the list of the top layers' new ids, as an agent's step reference reads
// it, or with withIds that list and each placed layer's new id by its key in the tree.
import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import type { LayerTree } from '@dazbee/schema'

import { childrenOf, readDesign } from '../index.ts'
import { openTestSession } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'
import { placedRoots } from './arrange.ts'

/** A group holding a box and a text, as a copy puts it on the clipboard. */
const tree = () =>
  ({
    roots: ['g'],
    nodes: {
      g: {
        type: 'group',
        parentId: 'elsewhere',
        link: 'g',
        index: 'a5',
        name: 'Card',
        props: { x: 10, y: 20, width: 300, height: 200 },
      },
      tile: {
        type: 'graphic',
        parentId: 'g',
        link: 'tile',
        index: 'a0',
        name: 'Tile',
        props: { x: 10, y: 20, width: 300, height: 200, shape: { kind: 'rect' } },
      },
      label: {
        type: 'text',
        parentId: 'g',
        link: 'label',
        index: 'a1',
        name: 'Label',
        props: {
          x: 30,
          y: 40,
          width: 200,
          height: 60,
          text: 'Hi',
          style: { fontFamily: 'Noto Sans', fontSize: 40, color: '#FFFFFFFF' },
        },
      },
    },
  }) satisfies z.input<typeof LayerTree>

describe('design.place', () => {
  it('with withIds, returns the top layers’ ids and each placed layer’s new id by its key in the tree', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const placed = tab.run('design.place', { parentId: 'sq', tree: tree(), withIds: true })
    const design = readDesign(store)
    expect(placed).toEqual({
      roots: [expect.any(String)],
      ids: { g: expect.any(String), tile: expect.any(String), label: expect.any(String) },
    })
    if (Array.isArray(placed)) throw new Error('a list')
    expect(placed.roots).toEqual([placed.ids.g])
    expect(Object.entries(placed.ids).map(([key, id]) => [key, design.nodes[id]?.name])).toEqual([
      ['g', 'Card'],
      ['tile', 'Tile'],
      ['label', 'Label'],
    ])
    expect(childrenOf(design, placed.ids.g ?? '').map(([id]) => id)).toEqual([placed.ids.tile, placed.ids.label])
  })

  it('without withIds, returns the list of the top layers’ ids alone, as an agent’s step reference reads it', () => {
    const tab = openTestSession(openTestStore())
    const placed = tab.run('design.place', { parentId: 'sq', tree: tree() })
    expect([Array.isArray(placed), placedRoots(placed)]).toEqual([true, [expect.any(String)]])
  })
})
