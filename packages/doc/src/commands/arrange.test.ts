import { describe, expect, it } from 'vitest'
import type { z } from 'zod'

import { type Layer, LayerTree, type Rect } from '@dazbee/schema'

import { centreOf, round, turn } from '../geometry.ts'
import { childrenOf, isMaskGroup, readDesign } from '../index.ts'
import type { DesignStore } from '../store.ts'
import { badge, kindsDesign, openTestSession } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'
import { placedRoots } from './arrange.ts'

/** The banner's layers, its copies of the square's, as they are now. */
const banner = (store: DesignStore) => {
  const design = readDesign(store)
  return Object.fromEntries(childrenOf(design, 'banner'))
}

describe('node.move', () => {
  it('stores only the moved layer and what it holds at their drawn boxes, whatever else drawn holds', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const other = readDesign(store).nodes['banner-box']?.props
    tab.run('node.move', {
      id: 'box',
      parentId: 'sq',
      drawn: { box: { x: 40, y: 40, width: 200, height: 100 }, 'banner-box': { x: 999, y: 999, width: 1, height: 1 } },
    })
    const after = readDesign(store)
    expect(after.nodes.box?.props).toMatchObject({ x: 40, y: 40 })
    expect(after.nodes['banner-box']?.props).toMatchObject({ x: other?.x, y: other?.y })
  })

  it('keeps a laid-out box that the move leaves with nothing in its flow at the size it is drawn', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.create', {
      id: 'row',
      parentId: 'sq',
      layer: {
        type: 'box',
        name: 'Row',
        props: {
          x: 100,
          y: 100,
          width: 10,
          height: 10,
          sizing: { width: 'hug', height: 'hug' },
          layout: { direction: 'row' },
        },
      },
    })
    tab.run('node.move', { id: 'box', parentId: 'row' })
    const drawn = { box: { x: 100, y: 100, width: 200, height: 100 } }
    const holders = { row: { x: 100, y: 100, width: 200, height: 100 } }
    tab.run('node.move', { id: 'box', parentId: 'sq', drawn, holders })
    expect(readDesign(store).nodes.row?.props).toMatchObject({ x: 100, y: 100, width: 200, height: 100 })
    tab.undo()
    expect(readDesign(store).nodes.row?.props).toMatchObject({ width: 10, height: 10 })
  })

  it('changes parent and order, and refuses to put a layer inside itself', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const before = banner(store)
    const group = tab.run('node.create', {
      parentId: 'sq',
      layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 10, height: 10 } },
    })

    tab.run('node.move', { id: 'box', parentId: group })
    expect(readDesign(store).nodes.box?.parentId).toBe(group)

    tab.run('node.move', { id: group, parentId: 'sq', before: 'headline' })
    const order = childrenOf(readDesign(store), 'sq').map(([id]) => id)
    expect(order).toEqual([group, 'headline'])
    expect(banner(store)).toEqual(before)

    expect(() => tab.run('node.move', { id: group, parentId: 'box' })).toThrow(/parent "box" is a graphic/)
    const inner = tab.run('node.create', {
      parentId: group,
      layer: { type: 'group', name: 'Inner', props: { x: 0, y: 0, width: 5, height: 5 } },
    })
    expect(() => tab.run('node.move', { id: group, parentId: inner })).toThrow(
      /node.move: can't move "\S+" inside itself/,
    )
  })

  it('first stores a layer leaving a flow where `drawn` says it is drawn, what it holds moved along', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.box', { ids: ['box'], id: 'row', name: 'Row' })
    tab.run('node.autoLayout', { id: 'row', layout: 'auto' })
    tab.run('node.group', { ids: ['box'], id: 'g', name: 'G' })
    const was = readDesign(store).nodes.box?.props as { x: number; y: number }

    tab.run('node.move', {
      id: 'g',
      parentId: 'sq',
      drawn: { g: { x: was.x + 40, y: was.y + 5, width: 200, height: 80 } },
    })

    const { nodes } = readDesign(store)
    expect(nodes.g?.parentId).toBe('sq')
    expect(nodes.g?.props).toMatchObject({ x: was.x + 40, y: was.y + 5 })
    expect(nodes.box?.props).toMatchObject({ x: was.x + 40, y: was.y + 5 })
  })

  it('keeps a hidden layer where it is drawn as it goes into a turned flow, which places no hidden layer', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.box', { ids: ['box'], id: 'row', name: 'Row' })
    tab.run('node.autoLayout', { id: 'row', layout: 'auto' })
    tab.run('node.update', { ids: ['row'], patch: { rotation: 90 } })
    tab.run('node.update', { ids: ['headline'], patch: { visible: false } })

    tab.run('node.move', { id: 'headline', parentId: 'row' })

    expect(readDesign(store).nodes.headline?.props.rotation).toBe(-90)
  })

  it('turns a layer about where `holders` says its containers are drawn, storing only the layer', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.group', { ids: ['box'], id: 'g', name: 'G' })
    tab.run('node.update', { ids: ['g'], patch: { rotation: 90 } })
    const areaOf = (id: string) => {
      const { x, y, width, height } = readDesign(store).nodes[id]?.props as Rect
      return { x, y, width, height }
    }
    const box = areaOf('box')
    const group = areaOf('g')
    // A flow moved the group, and the box in it, 200 to the right of where they are stored.
    const drawnBox = { ...box, x: box.x + 200 }
    const drawnGroup = { ...group, x: group.x + 200 }

    tab.run('node.move', { id: 'box', parentId: 'sq', drawn: { box: drawnBox }, holders: { g: drawnGroup } })

    const to = turn(centreOf({ ...drawnBox, rotation: 0 }), centreOf({ ...drawnGroup, rotation: 0 }), 90)
    const { nodes } = readDesign(store)
    expect(nodes.box?.props).toMatchObject({
      x: round(to.x - box.width / 2),
      y: round(to.y - box.height / 2),
      rotation: 90,
    })
    expect(nodes.g?.props).toMatchObject({ x: group.x, y: group.y })
  })

  it('refuses to move a layer onto another page, or to a page', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('page.add', { id: 'p2', name: 'Two', frame: { id: 'far', name: 'Far', width: 100, height: 100 } })
    const group = tab.run('node.create', {
      parentId: 'far',
      layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 10, height: 10 } },
    })
    const before = JSON.stringify(readDesign(store))
    expect(() => tab.run('node.move', { id: 'box', parentId: 'far' })).toThrow(
      /node.move: can't move "box" to another page/,
    )
    expect(() => tab.run('node.move', { id: 'box', parentId: group })).toThrow(/can't move "box" to another page/)
    expect(() => tab.run('node.move', { id: 'box', parentId: 'p1' })).toThrow(/neither a frame nor a layer/)
    expect(JSON.stringify(readDesign(store))).toBe(before)
  })

  it('refuses to place a layer before itself', () => {
    const tab = openTestSession(openTestStore())
    expect(() => tab.run('node.move', { id: 'box', parentId: 'sq', before: 'box' })).toThrow(
      /node.move: can't place "box" before itself/,
    )
  })
})

describe('node.reorder', () => {
  /** Five shapes in the square above box and headline, as ids bottom to top. */
  const stacked = () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    for (const id of ['a', 'b', 'c', 'd', 'e']) tab.run('node.create', { id, parentId: 'sq', layer: badge })
    const order = () => childrenOf(readDesign(store), 'sq').map(([id]) => id)
    return { store, tab, order }
  }

  it('brings layers forward and back one step, keeping a moved block in order', () => {
    const { tab, order } = stacked()
    expect(order()).toEqual(['box', 'headline', 'a', 'b', 'c', 'd', 'e'])
    tab.run('node.reorder', { ids: ['b'], to: 'forward' })
    expect(order()).toEqual(['box', 'headline', 'a', 'c', 'b', 'd', 'e'])
    tab.run('node.reorder', { ids: ['a', 'c'], to: 'forward' })
    expect(order()).toEqual(['box', 'headline', 'b', 'a', 'c', 'd', 'e'])
    tab.run('node.reorder', { ids: ['d', 'e'], to: 'backward' })
    expect(order()).toEqual(['box', 'headline', 'b', 'a', 'd', 'e', 'c'])
    // Already on top: nothing to do, and nothing written.
    const tabUndo = tab.canUndo()
    tab.run('node.reorder', { ids: ['c'], to: 'forward' })
    expect(order()).toEqual(['box', 'headline', 'b', 'a', 'd', 'e', 'c'])
    expect(tab.canUndo()).toBe(tabUndo)
  })

  it('brings layers to the front or back, and undo puts them back; the linked copies keep their order', () => {
    const { store, tab, order } = stacked()
    const before = childrenOf(readDesign(store), 'banner').map(([id]) => id)
    tab.run('node.reorder', { ids: ['box', 'c'], to: 'front' })
    expect(order()).toEqual(['headline', 'a', 'b', 'd', 'e', 'box', 'c'])
    tab.run('node.reorder', { ids: ['e', 'a'], to: 'back' })
    expect(order()).toEqual(['a', 'e', 'headline', 'b', 'd', 'box', 'c'])
    expect(childrenOf(readDesign(store), 'banner').map(([id]) => id)).toEqual(before)
    tab.undo()
    expect(order()).toEqual(['headline', 'a', 'b', 'd', 'e', 'box', 'c'])
    tab.undo()
    expect(order()).toEqual(['box', 'headline', 'a', 'b', 'c', 'd', 'e'])
  })

  it('works within each parent', () => {
    const { store, tab, order } = stacked()
    tab.run('node.create', {
      id: 'g',
      parentId: 'sq',
      layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 10, height: 10 } },
    })
    tab.run('node.create', { id: 'in1', parentId: 'g', layer: badge })
    tab.run('node.create', { id: 'in2', parentId: 'g', layer: badge })
    tab.run('node.reorder', { ids: ['in1', 'a'], to: 'front' })
    expect(order()).toEqual(['box', 'headline', 'b', 'c', 'd', 'e', 'g', 'a'])
    expect(childrenOf(readDesign(store), 'g').map(([id]) => id)).toEqual(['in2', 'in1'])
  })
})

describe('node.duplicate', () => {
  it('copies layers right above themselves, with what is inside them, each copy with a new link id', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.create', {
      id: 'g',
      parentId: 'sq',
      layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 10, height: 10 } },
    })
    tab.run('node.create', { id: 'dot', parentId: 'g', layer: badge })
    const before = banner(store)

    const [box, group, ...rest] = tab.run('node.duplicate', { ids: ['box', 'g', 'dot'] })

    expect(rest).toEqual([])
    const design = readDesign(store)
    expect(childrenOf(design, 'sq').map(([id]) => id)).toEqual(['box', box, 'headline', 'g', group])
    expect(design.nodes[box ?? '']?.props).toEqual(design.nodes.box?.props)
    const [[dot, copied] = []] = childrenOf(design, group ?? '')
    expect(dot).not.toBe('dot')
    expect(copied?.name).toBe('Badge')
    const links = [box, group, dot, 'box', 'g', 'dot'].map((id) => design.nodes[id ?? '']?.link)
    expect(new Set(links).size).toBe(6)
    expect(banner(store)).toEqual(before)
    tab.undo()
    expect(Object.keys(readDesign(store).nodes).sort()).toEqual([
      'banner-box',
      'banner-headline',
      'box',
      'dot',
      'g',
      'headline',
    ])
  })

  it('stores each copy, and each layer copied inside it, where `places` says, its original left as it was', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.create', {
      id: 'g',
      parentId: 'sq',
      layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 10, height: 10 } },
    })
    tab.run('node.create', { id: 'dot', parentId: 'g', layer: badge })
    const before = readDesign(store)

    const [box = '', group = ''] = tab.run('node.duplicate', {
      ids: ['box', 'g'],
      places: { box: { x: 60, y: 70 }, g: { x: 20, y: 20 }, dot: { x: 25, y: 30 } },
    })

    const design = readDesign(store)
    expect(design.nodes[box]?.props).toEqual({ ...before.nodes.box?.props, x: 60, y: 70 })
    expect(design.nodes[group]?.props).toMatchObject({ x: 20, y: 20, width: 10, height: 10 })
    const [[, dot] = []] = childrenOf(design, group)
    expect(dot?.props).toMatchObject({ x: 25, y: 30 })
    for (const id of ['box', 'g', 'dot']) expect(design.nodes[id]).toEqual(before.nodes[id])
    tab.undo()
    expect(readDesign(store)).toEqual(before)
  })

  it("copies a Mask group's mask without its group right above it with its masking turned off, so the Mask group stays one", () => {
    const store = openTestStore(kindsDesign())
    const tab = openTestSession(store)
    const before = readDesign(store)

    const [copy = ''] = tab.run('node.duplicate', { ids: ['mask'], places: { mask: { x: 620, y: 120 } } })

    const design = readDesign(store)
    expect(childrenOf(design, 'masks').map(([id]) => id)).toEqual(['mask', copy, 'masked'])
    expect(design.nodes[copy]?.props).not.toHaveProperty('mask')
    expect(design.nodes[copy]?.props).toEqual({ ...before.nodes.mask?.props, mask: undefined, x: 620, y: 120 })
    expect(design.nodes.mask).toEqual(before.nodes.mask)
    expect(isMaskGroup(design, 'masks')).toBe(true)
    tab.undo()
    expect(readDesign(store)).toEqual(before)
  })

  it('copies a Mask group whole, its mask included', () => {
    const store = openTestStore(kindsDesign())
    const tab = openTestSession(store)

    const [group = ''] = tab.run('node.duplicate', { ids: ['masks'] })

    const design = readDesign(store)
    expect(isMaskGroup(design, group)).toBe(true)
    const [[, mask] = []] = childrenOf(design, group)
    expect(mask?.props.mask).toBe('alpha')
  })

  it('gives a copy what its original holds in its original’s order, all the way down, and the copies in the order of `ids`', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const group = (id: string, parentId: string) =>
      tab.run('node.create', {
        id,
        parentId,
        layer: { type: 'group', name: id, props: { x: 0, y: 0, width: 100, height: 100 } },
      })
    const dot = (id: string, parentId: string) =>
      tab.run('node.create', { id, parentId, layer: { ...badge, name: id } })
    group('outer', 'sq')
    dot('one', 'outer')
    group('inner', 'outer')
    for (const id of ['in-one', 'in-two', 'in-three']) dot(id, 'inner')
    dot('three', 'outer')
    // Reordered, so the order is not the one the layers were made in.
    tab.run('node.reorder', { ids: ['in-three'], to: 'back' })
    tab.run('node.reorder', { ids: ['one'], to: 'front' })

    const [copy = '', box = ''] = tab.run('node.duplicate', { ids: ['outer', 'box'] })

    const design = readDesign(store)
    const names = (id: string): unknown[] => childrenOf(design, id).map(([child, node]) => [node.name, names(child)])
    expect(names('outer')).toEqual([
      [
        'inner',
        [
          ['in-three', []],
          ['in-one', []],
          ['in-two', []],
        ],
      ],
      ['three', []],
      ['one', []],
    ])
    expect(names(copy)).toEqual(names('outer'))
    expect(design.nodes[copy]?.name).toBe('outer')
    expect(design.nodes[box]?.name).toBe(design.nodes.box?.name)
  })

  it('copies a linked copy in its own frame, and the copy is linked to nothing', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const [copy = ''] = tab.run('node.duplicate', { ids: ['banner-box'] })
    const design = readDesign(store)
    expect(design.nodes[copy]).toMatchObject({ parentId: 'banner', name: 'Box' })
    expect(Object.values(design.nodes).filter((n) => n.link === design.nodes[copy]?.link)).toHaveLength(1)
  })
})

describe('design.place', () => {
  // A group holding a box and a text, as a copy puts it on the clipboard.
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
          props: {
            x: 10,
            y: 20,
            width: 300,
            height: 200,
            shape: { kind: 'rect' },
            fills: [{ type: 'solid', color: '#2F6BFFFF' }],
          },
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

  it('places a tree with fresh ids and link ids on top, moved by the offset, in one undo step', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const [g] = placedRoots(tab.run('design.place', { parentId: 'sq', tree: tree(), dx: 100, dy: 5 }))
    const design = readDesign(store)
    expect(g).not.toBe('g')
    expect(childrenOf(design, 'sq').map(([id]) => id)).toEqual(['box', 'headline', g])
    const inside = childrenOf(design, g ?? '')
    expect(inside.map(([, n]) => n.name)).toEqual(['Tile', 'Label'])
    expect(inside.every(([id]) => !['tile', 'label'].includes(id))).toBe(true)
    const links = [design.nodes[g ?? '']?.link, ...inside.map(([, n]) => n.link)]
    expect(links.filter((link) => ['g', 'tile', 'label'].includes(link ?? ''))).toEqual([])
    expect(design.nodes[g ?? '']?.props).toMatchObject({ x: 110, y: 25 })
    expect(inside[1]?.[1].props).toMatchObject({ x: 130, y: 45, text: 'Hi' })
    tab.undo()
    expect(Object.keys(readDesign(store).nodes).sort()).toEqual(['banner-box', 'banner-headline', 'box', 'headline'])
  })

  it('placing the same tree twice, in one frame or two, gives copies linked to nothing', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const [a] = placedRoots(tab.run('design.place', { parentId: 'sq', tree: tree() }))
    const [b] = placedRoots(tab.run('design.place', { parentId: 'sq', tree: tree() }))
    const [c] = placedRoots(tab.run('design.place', { parentId: 'banner', tree: tree() }))
    const design = readDesign(store)
    expect(a).not.toBe(b)
    expect(childrenOf(design, 'sq').map(([id]) => id)).toEqual(['box', 'headline', a, b])
    expect(childrenOf(design, 'banner').map(([id]) => id)).toEqual(['banner-box', 'banner-headline', c])
    expect(Object.keys(design.nodes)).toHaveLength(4 + 9)
    expect(new Set(Object.values(design.nodes).map((n) => n.link)).size).toBe(2 + 9)
  })

  it('keeping links from a page, keeps each link id the frame it goes into holds on no layer', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    // The square's box and headline, as a copy in the square puts them on the clipboard.
    const square = readDesign(store).nodes
    const copied = {
      roots: ['box', 'headline'],
      nodes: { box: square.box as Layer, headline: square.headline as Layer },
    }
    tab.run('node.delete', { ids: ['banner-headline'] })

    const [box, headline] = placedRoots(
      tab.run('design.place', { parentId: 'banner', tree: copied, keepLinksFrom: 'p1' }),
    )

    const design = readDesign(store)
    // The banner still holds a copy of the box, so that one is a new layer; its headline was deleted.
    expect(design.nodes[headline ?? '']?.link).toBe('headline')
    expect(design.nodes[box ?? '']?.link).not.toBe('box')
    expect(design.nodes['banner-box']?.link).toBe('box')
  })

  it('keeping links from a page, keeps a link id once in a frame: a second layer with it, or a second place, makes new ones', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('frame.add', { id: 'f2', pageId: 'p1', name: 'Frame', width: 600, height: 500 })
    tab.run('node.create', {
      id: 'holder',
      parentId: 'f2',
      layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 300, height: 300 } },
    })
    const t = tree()
    const twice = { ...t, nodes: { ...t.nodes, label: { ...t.nodes.label, link: 'tile' } } }

    const [first] = placedRoots(tab.run('design.place', { parentId: 'holder', tree: twice, keepLinksFrom: 'p1' }))
    const [second] = placedRoots(tab.run('design.place', { parentId: 'f2', tree: t, keepLinksFrom: 'p1' }))

    const links = (root: string) => {
      const design = readDesign(store)
      return [root, ...childrenOf(design, root).map(([id]) => id)].map((id) => design.nodes[id]?.link)
    }
    const [g, tile, label] = links(first ?? '')
    expect([g, tile]).toEqual(['g', 'tile'])
    expect(label).not.toBe('tile')
    const again = links(second ?? '')
    expect(again.filter((link) => ['g', 'tile', 'label'].includes(link ?? ''))).toEqual(['label'])
    // Another frame of the page holds none of them.
    const [third] = placedRoots(tab.run('design.place', { parentId: 'sq', tree: t, keepLinksFrom: 'p1' }))
    expect(links(third ?? '')).toEqual(['g', 'tile', 'label'])
  })

  it('keeping links from a page, gives every layer a new link id in a frame of another page', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const square = readDesign(store).nodes
    const copied = { roots: ['box'], nodes: { box: square.box as Layer } }
    tab.run('page.add', { id: 'p2', name: 'Page 2', frame: { id: 'p2-sq', name: 'Square', width: 1080, height: 1080 } })

    const [onOther] = placedRoots(tab.run('design.place', { parentId: 'p2-sq', tree: copied, keepLinksFrom: 'p1' }))
    const [onP1] = placedRoots(tab.run('design.place', { parentId: 'p2-sq', tree: copied, keepLinksFrom: 'p2' }))

    const design = readDesign(store)
    // Copied on p1, so it links to nothing on p2.
    expect(design.nodes[onOther ?? '']?.link).not.toBe('box')
    // Said to come from p2, whose frame holds no "box" link yet, it keeps it.
    expect(design.nodes[onP1 ?? '']?.link).toBe('box')
  })

  it('refuses a tree that is not whole, holds a layer its parent cannot, loops, or does not fit where it goes', () => {
    const tab = openTestSession(openTestStore())
    const t = tree()
    expect(() => tab.run('design.place', { parentId: 'sq', tree: { ...t, roots: ['nope'] } })).toThrow(
      /root "nope" is not in the tree/,
    )
    expect(() =>
      tab.run('design.place', {
        parentId: 'sq',
        tree: { ...t, nodes: { ...t.nodes, label: { ...t.nodes.label, parentId: 'gone' } } },
      }),
    ).toThrow(/"label" is neither a root nor inside one/)
    expect(() =>
      tab.run('design.place', {
        parentId: 'sq',
        tree: { ...t, nodes: { ...t.nodes, label: { ...t.nodes.label, parentId: 'tile' } } },
      }),
    ).toThrow(/a graphic, which can't hold "label"/)
    const loop = {
      roots: ['tile'],
      nodes: { tile: t.nodes.tile, a: { ...t.nodes.g, parentId: 'b' }, b: { ...t.nodes.g, parentId: 'a' } },
    }
    expect(() => tab.run('design.place', { parentId: 'sq', tree: loop })).toThrow(/is inside itself/)
    expect(() =>
      tab.run('design.place', {
        parentId: 'sq',
        tree: { ...t, nodes: { ...t.nodes, tile: { ...t.nodes.tile, props: { ...t.nodes.tile.props, width: -1 } } } },
      }),
    ).toThrow(/width/)
    expect(() => tab.run('design.place', { parentId: 'box', tree: t })).toThrow(/a graphic, which can't hold layers/)
    expect(() => tab.run('design.place', { parentId: 'nowhere', tree: t })).toThrow(/neither a frame nor a layer/)
    expect(() => tab.run('design.place', { parentId: 'p1', tree: t })).toThrow(/neither a frame nor a layer/)
  })
})
