// node.move taking a layer into another frame of its page: where it lands on the page, its link ids, its refusals.
import { describe, expect, it } from 'vitest'

import type { Design, Rect } from '@dazbee/schema'

import { centreOf, round, turn } from '../geometry.ts'
import { childrenOf, readDesign } from '../index.ts'
import { openTestSession } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'

describe('node.move into another frame of its page', () => {
  /** Where a layer's centre is drawn on the page, and how far it is turned, through every container around it. */
  const onPage = (design: Design, id: string) => {
    const props = design.nodes[id]?.props as Rect & { rotation?: number }
    let at = centreOf({ ...props, rotation: props.rotation ?? 0 })
    let turned = props.rotation ?? 0
    let up = design.nodes[id]?.parentId as string
    while (design.nodes[up]) {
      const outer = design.nodes[up]?.props as Rect & { rotation?: number }
      at = turn(at, centreOf({ ...outer, rotation: outer.rotation ?? 0 }), outer.rotation ?? 0)
      turned += outer.rotation ?? 0
      up = design.nodes[up]?.parentId as string
    }
    const frame = design.frames[up] as { x: number; y: number }
    return { x: round(at.x + frame.x), y: round(at.y + frame.y), turned: ((turned % 360) + 360) % 360 }
  }
  /** A graphic of the square with a link id of its own, at 400, 300. */
  const solo = (tab: ReturnType<typeof openTestSession>, id = 'solo') =>
    tab.run('node.create', {
      id,
      parentId: 'sq',
      layer: {
        type: 'graphic',
        name: 'Solo',
        props: { x: 400, y: 300, width: 50, height: 40, shape: { kind: 'rect' }, fills: [] },
      },
    })

  it('moves a layer onto another frame, on top or before a sibling, where it is drawn on the page', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    solo(tab)
    const was = onPage(readDesign(store), 'solo')

    tab.run('node.move', { id: 'solo', parentId: 'banner' })
    let design = readDesign(store)
    expect(childrenOf(design, 'banner').map(([id]) => id)).toEqual(['banner-box', 'banner-headline', 'solo'])
    expect(design.nodes.solo?.props).toMatchObject({ x: 400 - 1280, y: 300 })
    expect(onPage(design, 'solo')).toEqual(was)

    tab.run('node.move', { id: 'headline', parentId: 'banner', before: 'banner-box' })
    design = readDesign(store)
    expect(childrenOf(design, 'banner').map(([id]) => id)).toEqual([
      'headline',
      'banner-box',
      'banner-headline',
      'solo',
    ])
    expect(childrenOf(design, 'sq').map(([id]) => id)).toEqual(['box'])
  })

  it('moves a group into a box of another frame, it and what it holds where they are drawn on the page', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    solo(tab)
    tab.run('node.group', { ids: ['box', 'solo'], id: 'g', name: 'G' })
    tab.run('node.create', {
      id: 'holder',
      parentId: 'banner',
      layer: { type: 'box', name: 'Holder', props: { x: 10, y: 5, width: 100, height: 40 } },
    })
    const ids = ['g', 'box', 'solo']
    const was = ids.map((id) => onPage(readDesign(store), id))

    tab.run('node.move', { id: 'g', parentId: 'holder' })

    const design = readDesign(store)
    expect(design.nodes.g?.parentId).toBe('holder')
    expect(ids.map((id) => onPage(design, id))).toEqual(was)
  })

  it('keeps a layer moved from a turned box in one frame into a turned box in another where it is drawn on the page', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.box', { ids: ['box'], id: 'from', name: 'From' })
    tab.run('node.update', { ids: ['from'], patch: { rotation: 30 } })
    tab.run('node.create', {
      id: 'to',
      parentId: 'banner',
      layer: { type: 'box', name: 'To', props: { x: 40, y: 10, width: 120, height: 30, rotation: 45 } },
    })
    const was = onPage(readDesign(store), 'box')

    tab.run('node.move', { id: 'box', parentId: 'to' })

    const now = onPage(readDesign(store), 'box')
    expect(now.x).toBeCloseTo(was.x, 2)
    expect(now.y).toBeCloseTo(was.y, 2)
    expect(now.turned).toBeCloseTo(was.turned, 6)
  })

  it('stores a layer leaving a flow for another frame where `drawn` says it is drawn on the page', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.box', { ids: ['box'], id: 'row', name: 'Row' })
    tab.run('node.autoLayout', { id: 'row', layout: 'auto' })
    const was = readDesign(store).nodes.box?.props as Rect

    tab.run('node.move', {
      id: 'box',
      parentId: 'banner',
      drawn: { box: { x: was.x + 40, y: was.y + 5, width: was.width, height: was.height } },
    })

    const { nodes } = readDesign(store)
    expect(nodes.box?.parentId).toBe('banner')
    expect(nodes.box?.props).toMatchObject({ x: was.x + 40 - 1280, y: was.y + 5 })
  })

  it('carries a group entering a flow of another frame into that frame, what it holds moved with it', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    solo(tab)
    tab.run('node.group', { ids: ['solo'], id: 'g', name: 'G' })
    tab.run('node.create', {
      id: 'row',
      parentId: 'banner',
      layer: {
        type: 'box',
        name: 'Row',
        props: { x: 0, y: 0, width: 300, height: 50, layout: { direction: 'row' } },
      },
    })
    const before = readDesign(store).nodes
    const [g, inner] = [before.g?.props as Rect, before.solo?.props as Rect]

    tab.run('node.move', { id: 'g', parentId: 'row' })

    const { nodes } = readDesign(store)
    expect(nodes.g?.parentId).toBe('row')
    expect(nodes.g?.props).toMatchObject({ x: g.x - 1280, y: g.y })
    expect(nodes.solo?.props).toMatchObject({ x: inner.x - 1280, y: inner.y })
  })

  it('gives each layer of it whose link id the frame holds a new one, the rest keeping theirs', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    solo(tab)
    tab.run('node.group', { ids: ['box', 'solo'], id: 'g', name: 'G' })
    const [groupLink, soloLink] = [readDesign(store).nodes.g?.link, readDesign(store).nodes.solo?.link]

    tab.run('node.move', { id: 'g', parentId: 'banner' })

    const { nodes } = readDesign(store)
    expect(nodes.g?.link).toBe(groupLink)
    expect(nodes.solo?.link).toBe(soloLink)
    expect(nodes.box?.link).not.toBe('box')
    expect(nodes['banner-box']?.link).toBe('box')
  })

  it('gives each layer named in `links` the link id it names, in tree order, unless the frame holds it or a layer took it first', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    solo(tab)
    solo(tab, 'other')
    tab.run('node.group', { ids: ['box', 'solo', 'other'], id: 'g', name: 'G' })
    const own = { solo: readDesign(store).nodes.solo?.link, other: readDesign(store).nodes.other?.link }

    tab.run('node.move', {
      id: 'g',
      parentId: 'banner',
      // The box comes first in the group and takes "shared"; the other one, asking for it too, gets
      // a new one; solo asks for the headline's link id, which the banner holds.
      links: { box: 'shared', other: 'shared', solo: 'headline' },
    })

    const { nodes } = readDesign(store)
    expect(nodes.box?.link).toBe('shared')
    expect(nodes.other?.link).not.toBe('shared')
    expect(nodes.solo?.link).not.toBe('headline')
    expect([nodes.other?.link, nodes.solo?.link]).not.toContain(own.other)
    expect([nodes.other?.link, nodes.solo?.link]).not.toContain(own.solo)
  })

  it('leaves the entries of `links` for other layers unread, and all of it for a move inside the frame', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    solo(tab)
    tab.run('node.create', {
      id: 'holder',
      parentId: 'sq',
      layer: { type: 'box', name: 'Holder', props: { x: 0, y: 0, width: 500, height: 500 } },
    })
    const links = { solo: 'renamed', headline: 'elsewhere', 'banner-box': 'nope' }
    const own = readDesign(store).nodes.solo?.link

    tab.run('node.move', { id: 'solo', parentId: 'holder', links })
    expect(readDesign(store).nodes.solo?.link).toBe(own)

    tab.run('node.move', { id: 'solo', parentId: 'banner', links })
    const { nodes } = readDesign(store)
    expect(nodes.solo?.link).toBe('renamed')
    expect([nodes.headline?.link, nodes['banner-box']?.link]).toEqual(['headline', 'box'])
  })

  it('keeps a layer’s bindings, lock, hidden state and name', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    solo(tab)
    tab.run('node.bind', { ids: ['solo'], property: 'fill', ref: 'brand:primary', value: '#112233FF' })
    tab.run('node.lock', { ids: ['solo'], lock: { style: true } })
    tab.run('node.update', { ids: ['solo'], patch: { visible: false } })
    const was = readDesign(store).nodes.solo

    tab.run('node.move', { id: 'solo', parentId: 'banner' })

    const now = readDesign(store).nodes.solo
    expect(now?.bindings).toEqual(was?.bindings)
    expect(now?.lock).toEqual(was?.lock)
    expect(now?.props.visible).toBe(false)
    expect(now?.name).toBe('Solo')
  })

  it('is one undo step called move: undo puts the design back exactly, redo moves it again', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    solo(tab)
    tab.run('node.group', { ids: ['box', 'solo'], id: 'g', name: 'G' })
    const before = JSON.stringify(readDesign(store))

    tab.run('node.move', { id: 'g', parentId: 'banner' })
    const after = JSON.stringify(readDesign(store))
    expect(tab.undoName()).toBe('move')

    tab.undo()
    expect(JSON.stringify(readDesign(store))).toBe(before)
    tab.redo()
    expect(JSON.stringify(readDesign(store))).toBe(after)
  })

  it('refuses a layer locked in place going to another frame, but moves it within its frame, and a group holding it to another', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    solo(tab)
    tab.run('node.lock', { ids: ['solo'], lock: { move: true } })
    const before = JSON.stringify(readDesign(store))

    expect(() => tab.run('node.move', { id: 'solo', parentId: 'banner' })).toThrow(
      /node.move: "solo" is locked in place/,
    )
    expect(JSON.stringify(readDesign(store))).toBe(before)

    tab.run('node.move', { id: 'solo', parentId: 'sq', before: 'box' })
    expect(childrenOf(readDesign(store), 'sq').map(([id]) => id)).toEqual(['solo', 'box', 'headline'])

    tab.run('node.lock', { ids: ['solo'], lock: { move: false } })
    tab.run('node.group', { ids: ['solo'], id: 'g', name: 'G' })
    tab.run('node.lock', { ids: ['solo'], lock: { move: true } })
    tab.run('node.move', { id: 'g', parentId: 'banner' })
    expect(readDesign(store).nodes.solo?.parentId).toBe('g')
    expect(readDesign(store).nodes.g?.parentId).toBe('banner')
  })
})
