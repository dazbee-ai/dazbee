import { describe, expect, it } from 'vitest'

import { BINDABLE_PROPERTIES } from '@dazbee/schema'

import { descendants, readDesign } from '../index.ts'
import type { DesignStore } from '../store.ts'
import { badge, openTestSession, testDesign } from '../test-design.ts'
import { openShapes, openTestStore } from '../test-store.ts'
import { nodeBind } from './layers.ts'

/** The box's and headline's linked copies in the banner, as they are now. */
const copies = (store: DesignStore) => {
  const design = readDesign(store)
  return { box: design.nodes['banner-box'], headline: design.nodes['banner-headline'] }
}

/** A Fit row, stored at a stale 10×10 though drawn at 300×80, holding tiles in its flow. */
const fitRow = (tiles: string[]) => {
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
  for (const id of tiles) tab.run('node.create', { id, parentId: 'row', layer: badge })
  return { store, tab }
}
/** Where the editor sees the row drawn. */
const ROW_DRAWN = { row: { x: 100, y: 100, width: 300, height: 80 } }

describe('node.create', () => {
  it('adds a layer on top of its siblings with a link id of its own, and undo removes it', () => {
    const store = openTestStore()
    const tab = openTestSession(store)

    const id = tab.run('node.create', { parentId: 'sq', layer: badge })

    const design = readDesign(store)
    expect(design.nodes[id]).toMatchObject({ type: 'graphic', parentId: 'sq', name: 'Badge' })
    const siblings = Object.values(design.nodes)
      .filter((n) => n.parentId === 'sq')
      .map((n) => n.index)
    expect(design.nodes[id]?.index).toBe(siblings.sort().at(-1))
    const link = design.nodes[id]?.link
    expect(Object.values(design.nodes).filter((n) => n.link === link)).toHaveLength(1)

    tab.undo()
    expect(readDesign(store).nodes[id]).toBeUndefined()
  })

  it('gives each layer it adds a new link id, in any frame', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const a = tab.run('node.create', { parentId: 'sq', layer: badge })
    const b = tab.run('node.create', { parentId: 'banner', layer: badge })
    const design = readDesign(store)
    expect(design.nodes[a]?.link).not.toBe(design.nodes[b]?.link)
    expect(['box', 'headline']).not.toContain(design.nodes[a]?.link)
  })

  it('rejects invalid input before touching the document', () => {
    const store = openTestStore()
    let writes = 0
    store.onChange(() => writes++)
    const tab = openTestSession(store)

    expect(() =>
      tab.run('node.create', { parentId: 'sq', layer: { ...badge, props: { ...badge.props, opacity: 3 } } }),
    ).toThrow(/node.create: layer.props.opacity/)
    expect(() => tab.run('node.create', { parentId: 'nowhere', layer: badge })).toThrow(
      /node.create: parent "nowhere" is neither a frame nor a layer/,
    )
    expect(() => tab.run('node.create', { parentId: 'p1', layer: badge })).toThrow(
      /node.create: parent "p1" is neither a frame nor a layer/,
    )
    expect(() => tab.run('node.create', { id: 'banner', parentId: 'sq', layer: badge })).toThrow(/id "banner" is taken/)
    expect(writes).toBe(0)
  })

  it('takes the id of a deleted layer (C27), and undo takes that layer back before it brings the deleted one back', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.delete', { ids: ['box'] })
    tab.run('node.create', { id: 'box', parentId: 'sq', layer: badge })
    expect(readDesign(store).nodes.box?.name).toBe(badge.name)
    tab.undo()
    expect(readDesign(store).nodes.box).toBeUndefined()
    tab.undo()
    expect(readDesign(store).nodes.box?.name).toBe('Box')
  })
})

describe('node.update', () => {
  it('keeps a laid-out box that a patch leaves with nothing in its flow at the size it is drawn, and only then', () => {
    const { store, tab } = fitRow(['a', 'b'])
    tab.run('node.update', { ids: ['a'], patch: { visible: false }, holders: ROW_DRAWN })
    expect(readDesign(store).nodes.row?.props).toMatchObject({ x: 100, y: 100, width: 10, height: 10 })
    tab.run('node.update', { ids: ['b'], patch: { absolute: true }, holders: ROW_DRAWN })
    expect(readDesign(store).nodes.row?.props).toMatchObject({ x: 100, y: 100, width: 300, height: 80 })
    expect(readDesign(store).nodes.row?.props.sizing).toEqual({ width: 'hug', height: 'hug' })
    tab.undo()
    expect(readDesign(store).nodes.row?.props).toMatchObject({ width: 10, height: 10 })
  })
  it('refuses a value holding a key the layer has no place for, at any depth, writing nothing', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const fills = [{ type: 'solid', color: '#00AA00FF', junk: 1 }]
    expect(() => tab.run('node.update', { ids: ['box'], patch: { fills } })).toThrow(
      'node.update: box: no place for "props.fills.0.junk"',
    )
    expect(readDesign(store).nodes.box?.props).toMatchObject({ fills: [{ color: '#FF5A36FF' }] })
    expect(tab.canUndo()).toBe(false)
  })

  it('sets properties of the layers given; their linked copies stay as they were', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const before = copies(store)

    tab.run('node.update', { ids: ['box'], patch: { x: 140, opacity: 0.5 } })
    tab.run('node.update', { ids: ['banner-headline'], patch: { x: 8, width: 40 } })

    const design = readDesign(store)
    expect(design.nodes.box?.props).toMatchObject({ x: 140, opacity: 0.5, width: 200 })
    expect(design.nodes['banner-headline']?.props).toMatchObject({ x: 8, width: 40 })
    expect(design.nodes.headline?.props).toMatchObject({ x: 60, width: 960 })
    expect(copies(store).box).toEqual(before.box)
  })

  it('first stores layers where `drawn` says they are drawn, what they hold moved along, then sets the patch', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.group', { ids: ['box'], id: 'g', name: 'G' })
    const was = readDesign(store).nodes.box?.props as { x: number; y: number }

    tab.run('node.update', {
      ids: ['g'],
      patch: { absolute: true, height: 90 },
      drawn: { g: { x: was.x + 30, y: was.y - 10, width: 250, height: 70 } },
    })

    const { nodes } = readDesign(store)
    expect(nodes.g?.props).toMatchObject({ x: was.x + 30, y: was.y - 10, width: 250, height: 90, absolute: true })
    expect(nodes.box?.props).toMatchObject({ x: was.x + 30, y: was.y - 10 })
    tab.undo()
    expect(readDesign(store).nodes.box?.props).toMatchObject(was)
  })

  it('in two unlinked frames of one page, changes the layers given and leaves the other frame as it was', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('frame.add', { id: 'f2', pageId: 'p1', name: 'Frame', width: 1080, height: 1080 })
    tab.run('node.create', { id: 'own', parentId: 'f2', layer: badge })
    // Unlinked: the new frame's layer shares no link id with the square's.
    const links = (frame: string) =>
      descendants(readDesign(store), frame).map((id) => readDesign(store).nodes[id]?.link)
    expect(links('f2').filter((link) => links('sq').includes(link))).toEqual([])
    const inFrame = (frame: string) => {
      const design = readDesign(store)
      return Object.fromEntries(descendants(design, frame).map((id) => [id, design.nodes[id]]))
    }
    const square = inFrame('sq')
    const f2 = inFrame('f2')

    tab.run('node.update', { ids: ['own'], patch: { x: 40 } })
    tab.run('node.delete', { ids: ['own'] })
    tab.undo()
    expect(inFrame('sq')).toEqual(square)

    tab.run('node.update', { ids: ['box'], patch: { y: 20 } })
    tab.run('node.create', { parentId: 'sq', layer: badge })
    expect(inFrame('f2')).toEqual({ own: { ...f2.own, props: { ...f2.own?.props, x: 40 } } })
  })

  it('writes nothing and adds no undo step when every value is the one the layer has, as an image replaced by itself', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.update', { ids: ['box'], patch: { x: 140 } })
    const { fills } = readDesign(store).nodes.box?.props as { fills: unknown[] }
    let writes = 0
    store.onChange(() => writes++)
    tab.run('node.update', { ids: ['box'], patch: { x: 140, fills: structuredClone(fills) } })
    expect(writes).toBe(0)
    tab.undo()
    expect(readDesign(store).nodes.box?.props).toMatchObject({ x: 100 })
  })

  it('refuses a patch that would make the layer invalid, and text, which text.edit changes', () => {
    const tab = openTestSession(openTestStore())
    expect(() => tab.run('node.update', { ids: ['box'], patch: { opacity: 2 } })).toThrow(/node.update: box.opacity/)
    expect(() => tab.run('node.update', { ids: ['box'], patch: { text: 'x' } })).toThrow(
      /node.update: a graphic has no property "text"/,
    )
    expect(() => tab.run('node.update', { ids: ['headline'], patch: { text: 'x' } })).toThrow(
      /change text with text.edit/,
    )
  })

  it("keeps preset shapes' parameters, in each copy on its own", () => {
    const { store, tab } = openShapes()
    tab.run('node.update', { ids: ['c'], patch: { shape: { kind: 'polygon', sides: 8, cornerRadius: 12 } } })
    tab.run('node.update', { ids: ['wide-a'], patch: { shape: { kind: 'rect', corners: [40, 0, 40, 0] } } })
    tab.run('node.create', {
      parentId: 'sq',
      layer: {
        type: 'graphic',
        name: 'Arrow',
        props: {
          x: 0,
          y: 500,
          width: 300,
          height: 0,
          rotation: 30,
          shape: { kind: 'line', end: 'arrow' },
          strokes: [{ paint: { type: 'solid', color: '#000000FF' }, width: 4 }],
        },
      },
    })
    const d = readDesign(store)
    expect(d.nodes.c?.props).toHaveProperty('shape', { kind: 'polygon', sides: 8, cornerRadius: 12 })
    expect(d.nodes['wide-c']?.props).toHaveProperty('shape', { kind: 'polygon', sides: 3, cornerRadius: 0 })
    expect(d.nodes['wide-a']?.props).toHaveProperty('shape', { kind: 'rect', cornerRadius: 0, corners: [40, 0, 40, 0] })
    expect(d.nodes.a?.props).toHaveProperty('shape', { kind: 'rect', cornerRadius: 0, corners: [0, 10, 20, 30] })
    expect(Object.values(d.nodes).find((n) => n.name === 'Arrow')?.props).toMatchObject({
      height: 0,
      shape: { kind: 'line', start: 'none', end: 'arrow' },
    })
    expect(() => tab.run('node.update', { ids: ['c'], patch: { shape: { kind: 'polygon', sides: 2 } } })).toThrow(
      /c.shape.sides/,
    )
    expect(() => tab.run('node.update', { ids: ['b'], patch: { shape: { kind: 'star', innerRadius: 1.5 } } })).toThrow(
      /b.shape.innerRadius/,
    )
  })
})

describe('node.delete', () => {
  it('keeps a laid-out box that the delete leaves with nothing in its flow at the size it is drawn', () => {
    const { store, tab } = fitRow(['a', 'b'])
    tab.run('node.delete', { ids: ['a'], holders: ROW_DRAWN })
    expect(readDesign(store).nodes.row?.props).toMatchObject({ width: 10, height: 10 })
    tab.run('node.delete', { ids: ['b'], holders: ROW_DRAWN })
    expect(readDesign(store).nodes.row?.props).toMatchObject({ x: 100, y: 100, width: 300, height: 80 })
    tab.undo()
    expect(readDesign(store).nodes.row?.props).toMatchObject({ width: 10, height: 10 })
  })
  it('removes layers and their children; their linked copies stay', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const group = tab.run('node.create', {
      parentId: 'sq',
      layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 10, height: 10 } },
    })
    tab.run('node.move', { id: 'headline', parentId: group })
    const before = copies(store)

    tab.run('node.delete', { ids: [group] })

    const design = readDesign(store)
    expect(Object.keys(design.nodes).sort()).toEqual(['banner-box', 'banner-headline', 'box'])
    expect(copies(store)).toEqual(before)

    tab.undo()
    expect(readDesign(store).nodes.headline?.parentId).toBe(group)
  })

  it("a group with a delete-locked layer inside can't be deleted", () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.create', {
      id: 'g',
      parentId: 'sq',
      layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 10, height: 10 } },
    })
    tab.run('node.create', { id: 'dot', parentId: 'g', layer: badge })
    tab.run('node.lock', { ids: ['dot'], lock: { delete: true } })
    expect(() => tab.run('node.delete', { ids: ['g'] })).toThrow(/"dot" is locked \(delete\)/)
    expect(readDesign(store).nodes.g).toBeDefined()
  })
})

describe('node.rename', () => {
  it('renames a layer in one undo step, locked or not, and refuses an empty name (#59)', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.lock', { ids: ['box'], lock: { move: true, resize: true, content: true, style: true, delete: true } })
    tab.run('node.rename', { id: 'box', name: '  Hero card ' })
    expect(readDesign(store).nodes.box?.name).toBe('Hero card')
    expect(readDesign(store).nodes['banner-box']?.name).toBe('Box')
    tab.undo()
    expect(readDesign(store).nodes.box?.name).not.toBe('Hero card')
    expect(() => tab.run('node.rename', { id: 'box', name: '   ' })).toThrow()
    expect(() => tab.run('node.rename', { id: 'nope', name: 'X' })).toThrow(/no layer "nope"/)
  })
})

describe('node.lock', () => {
  it('names its undo step by what it did: lock while it locks a flag, unlock while it only unlocks', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.lock', { ids: ['box'], lock: { move: true, delete: true } })
    expect(tab.undoName()).toBe('lock')
    tab.run('node.lock', { ids: ['box'], lock: { move: false, delete: false } })
    expect(tab.undoName()).toBe('unlock')
    tab.undo()
    expect(tab.redoName()).toBe('unlock')
    tab.run('node.lock', { ids: ['box'], lock: { move: false, style: true } })
    expect(tab.undoName()).toBe('lock')
  })

  it('sets flags one by one, and clearing them all drops the field', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.lock', { ids: ['box'], lock: { move: true } })
    expect(readDesign(store).nodes.box?.lock).toEqual({
      move: true,
      resize: false,
      content: false,
      style: false,
      delete: false,
    })
    tab.run('node.lock', { ids: ['box'], lock: { delete: true } })
    expect(readDesign(store).nodes.box?.lock).toMatchObject({ move: true, delete: true })
    tab.run('node.lock', { ids: ['box'], lock: { move: false, delete: false } })
    expect(readDesign(store).nodes.box).not.toHaveProperty('lock')
    tab.undo()
    expect(readDesign(store).nodes.box?.lock).toMatchObject({ move: true, delete: true })
  })

  it("each flag refuses only its own changes, on the layer locked: its linked copy isn't locked", () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const all = { move: true, resize: true, content: true, style: true, delete: true }
    tab.run('node.lock', { ids: ['box', 'headline'], lock: { move: true } })
    expect(() => tab.run('node.update', { ids: ['box'], patch: { x: 1 } })).toThrow(/"box" is locked \(move\)/)
    tab.run('node.update', { ids: ['banner-box'], patch: { y: 1 } })
    tab.run('node.update', { ids: ['box'], patch: { width: 50, opacity: 0.5 } })

    tab.run('node.lock', { ids: ['box', 'headline'], lock: all })
    expect(readDesign(store).nodes['banner-box']).not.toHaveProperty('lock')
    expect(() => tab.run('node.update', { ids: ['box'], patch: { rotation: 15 } })).toThrow(/locked \(resize\)/)
    expect(() => tab.run('node.update', { ids: ['box'], patch: { opacity: 1 } })).toThrow(/locked \(style\)/)
    expect(() => tab.run('text.edit', { id: 'headline', op: { kind: 'insert', at: 0, text: 'Big ' } })).toThrow(
      /locked \(content\)/,
    )
    expect(() =>
      tab.run('text.edit', { id: 'headline', op: { kind: 'style', at: 0, length: 3, style: { fontWeight: 700 } } }),
    ).toThrow(/locked \(style\)/)
    expect(() => tab.run('node.delete', { ids: ['box'] })).toThrow(/locked \(delete\)/)
    tab.run('text.edit', { id: 'banner-headline', op: { kind: 'insert', at: 0, text: 'Big ' } })
    // Hiding is not locked, z-order and copies aren't either.
    tab.run('node.update', { ids: ['box'], patch: { visible: false } })
    tab.run('node.reorder', { ids: ['box'], to: 'front' })
    tab.run('node.duplicate', { ids: ['box'] })
    expect(readDesign(store).nodes.box?.props).toMatchObject({ width: 50, opacity: 0.5, visible: false })
    expect(readDesign(store).nodes['banner-box']?.props).toMatchObject({ y: 1, width: 200, visible: true })
  })
})

describe('node.bind', () => {
  it('unbinds a fill with no solid fill that shows, given the token’s value, adding no fill', () => {
    // Stored so before a hand edit ended a binding, or by two tabs crossing.
    const image = { type: 'image', assetId: 'photo', fit: 'fill', opacity: 1 }
    const design = testDesign()
    const box = design.nodes.box as { props: object }
    Object.assign(box, { props: { ...box.props, fills: [image] }, bindings: { fill: 'brand:primary' } })
    const store = openTestStore(design)
    const tab = openTestSession(store)
    tab.run('node.bind', { ids: ['box'], property: 'fill', ref: null, value: '#E0262BFF' })
    expect(readDesign(store).nodes.box?.bindings).toBeUndefined()
    expect(readDesign(store).nodes.box?.props).toMatchObject({ fills: [image] })
  })

  it('binds a fill, text colour and font to brand tokens and unbinds them, each one undo step (#53)', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const before = copies(store)
    tab.run('node.bind', { ids: ['box'], property: 'fill', ref: 'brand:primary', value: '#E0262BFF' })
    let design = readDesign(store)
    expect(design.nodes.box?.bindings).toEqual({ fill: 'brand:primary' })
    // The token's value is stored too, for drawing without the brand kit.
    expect(design.nodes.box?.type === 'graphic' && design.nodes.box.props.fills.at(-1)).toMatchObject({
      type: 'solid',
      color: '#E0262BFF',
    })
    tab.run('node.bind', { ids: ['headline'], property: 'fontFamily', ref: 'brand:heading', value: 'Playfair Display' })
    tab.run('node.bind', { ids: ['headline'], property: 'textColor', ref: 'brand:primary', value: '#E0262BFF' })
    design = readDesign(store)
    expect(design.nodes.headline?.bindings).toEqual({ fontFamily: 'brand:heading', textColor: 'brand:primary' })
    expect(design.nodes.headline?.type === 'text' && design.nodes.headline.props.style).toMatchObject({
      fontFamily: 'Playfair Display',
      color: '#E0262BFF',
    })
    expect(copies(store)).toEqual(before)
    // Unbinding keeps the value; the last binding gone, the key goes.
    tab.run('node.bind', { ids: ['box'], property: 'fill', ref: null })
    design = readDesign(store)
    expect(design.nodes.box).not.toHaveProperty('bindings')
    expect(design.nodes.box?.type === 'graphic' && design.nodes.box.props.fills.at(-1)).toMatchObject({
      color: '#E0262BFF',
    })
    tab.undo()
    expect(readDesign(store).nodes.box?.bindings).toEqual({ fill: 'brand:primary' })
    tab.undo()
    tab.undo()
    expect(readDesign(store).nodes.headline).not.toHaveProperty('bindings')
    // A text layer has no fill, a binding needs the value, and a locked style can't be bound.
    expect(() =>
      tab.run('node.bind', { ids: ['headline'], property: 'fill', ref: 'brand:primary', value: '#E0262BFF' }),
    ).toThrow(/a text has no fill/)
    expect(() => tab.run('node.bind', { ids: ['box'], property: 'fill', ref: 'brand:primary' })).toThrow(
      /needs the value/,
    )
    expect(() => tab.run('node.bind', { ids: ['box'], property: 'fill', ref: 'brand:primary', value: 'red' })).toThrow(
      /#RRGGBBAA/,
    )
    tab.run('node.lock', { ids: ['box'], lock: { style: true } })
    expect(() => tab.run('node.bind', { ids: ['box'], property: 'fill', ref: null })).toThrow(/locked \(style\)/)
  })

  it('takes exactly the bindable properties as the property to bind', () => {
    expect(nodeBind.input.shape.property.options).toEqual(Object.keys(BINDABLE_PROPERTIES))
    const tab = openTestSession(openTestStore())
    expect(() =>
      tab.run('node.bind', { ids: ['box'], property: 'stroke', ref: 'brand:primary', value: '#E0262BFF' } as never),
    ).toThrow()
    expect(() =>
      tab.run('node.bind', { ids: ['box'], target: 'fill', ref: 'brand:primary', value: '#E0262BFF' } as never),
    ).toThrow()
  })

  it('adds a solid fill on top to bind a fill on a layer without one that shows', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const stops = [
      { offset: 0, color: '#000000FF' },
      { offset: 1, color: '#FFFFFFFF' },
    ]
    const gradient = { type: 'linear', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, stops } as const
    tab.run('node.update', {
      ids: ['box'],
      patch: { fills: [{ type: 'solid', color: '#FF5A36FF', visible: false }, gradient] },
    })
    tab.run('node.bind', { ids: ['box'], property: 'fill', ref: 'brand:primary', value: '#E0262BFF' })
    const box = readDesign(store).nodes.box
    expect(box?.bindings).toEqual({ fill: 'brand:primary' })
    expect(box?.type === 'graphic' && box.props.fills).toMatchObject([
      { type: 'solid', color: '#FF5A36FF', visible: false },
      gradient,
      { type: 'solid', color: '#E0262BFF' },
    ])
  })

  it('binds a picture to the brand logo in the topmost image fill, keeping its settings, in one undo step', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const crop = { x: 0, y: 0, width: 40, height: 20 }
    const photo = { type: 'image', assetId: 'photo', fit: 'crop', crop, opacity: 0.5, filter: 'mono' } as const
    tab.run('node.update', { ids: ['box'], patch: { fills: [photo] } })
    tab.run('node.bind', { ids: ['box'], property: 'image', ref: 'brand:logo', value: 'logo-1' })
    const box = readDesign(store).nodes.box
    expect(box?.bindings).toEqual({ image: 'brand:logo' })
    expect(box?.type === 'graphic' && box.props.fills).toEqual([
      { type: 'image', assetId: 'logo-1', fit: 'fit', opacity: 0.5, filter: 'mono' },
    ])
    tab.undo()
    expect(readDesign(store).nodes.box?.bindings).toBeUndefined()
    expect(readDesign(store).nodes.box?.props).toMatchObject({ fills: [photo] })
    expect(() =>
      tab.run('node.bind', { ids: ['box'], property: 'image', ref: 'brand:logo', value: 'a logo' }),
    ).toThrow(/asset’s id/)
    expect(() =>
      tab.run('node.bind', { ids: ['headline'], property: 'image', ref: 'brand:logo', value: 'logo-1' }),
    ).toThrow(/a text has no image/)
  })

  it('adds an image fill on top, fitting the picture whole, to bind a picture on a layer without one that shows', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.bind', { ids: ['box'], property: 'image', ref: 'brand:logo', value: 'logo-1' })
    const box = readDesign(store).nodes.box
    expect(box?.bindings).toEqual({ image: 'brand:logo' })
    expect(box?.type === 'graphic' && box.props.fills).toEqual([
      { type: 'solid', color: '#FF5A36FF' },
      { type: 'image', assetId: 'logo-1', fit: 'fit', opacity: 1 },
    ])
  })
})

describe('node.mask', () => {
  it('makes layers masks and plain again, each one undo step; their linked copies stay as they were', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const before = copies(store)
    tab.run('node.mask', { ids: ['box'], mask: 'alpha' })
    let design = readDesign(store)
    expect(design.nodes.box?.props.mask).toBe('alpha')
    expect(copies(store)).toEqual(before)
    tab.run('node.mask', { ids: ['box'], mask: null })
    design = readDesign(store)
    expect(design.nodes.box?.props).not.toHaveProperty('mask')
    tab.undo()
    expect(readDesign(store).nodes.box?.props.mask).toBe('alpha')
    tab.run('node.lock', { ids: ['box'], lock: { style: true } })
    expect(() => tab.run('node.mask', { ids: ['box'], mask: null })).toThrow(/locked \(style\)/)
  })
})
