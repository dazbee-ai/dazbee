import { describe, expect, it } from 'vitest'

import { type DesignInput, framesOf } from '@dazbee/schema'

import { childrenOf, readDesign } from '../index.ts'
import { badge, openTestSession, testDesign } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'

const white = [{ type: 'solid' as const, color: '#FFFFFFFF' }]
const group = { type: 'group', name: 'G', props: { x: 10, y: 0, width: 100, height: 40 } } as const

/** The test design's page with its frames moved to the given places and sizes. */
const placed = (frames: Record<string, { x: number; y: number; width: number; height?: number }>): DesignInput => {
  const design = testDesign()
  for (const [id, at] of Object.entries(frames)) {
    const frame = design.frames[id]
    if (frame) design.frames[id] = { ...frame, height: 100, ...at }
  }
  return design
}

describe('frame.add', () => {
  it('adds an empty white frame right of the page’s rightmost one, after its last, in one undo step', () => {
    const store = openTestStore()
    const tab = openTestSession(store)

    const id = tab.run('frame.add', { id: 'mpu', pageId: 'p1', name: ' Medium rectangle ', width: 300, height: 250 })

    expect(id).toBe('mpu')
    const design = readDesign(store)
    // The banner's right edge, 1280 + 320, is the furthest right; the new frame goes 200 past it, at its top.
    expect(design.frames.mpu).toEqual({
      pageId: 'p1',
      name: 'Medium rectangle',
      width: 300,
      height: 250,
      x: 1800,
      y: 0,
      fills: white,
      order: 'a2',
    })
    expect(framesOf(design, 'p1').map(([f]) => f)).toEqual(['sq', 'banner', 'mpu'])
    expect(childrenOf(design, 'mpu')).toEqual([])

    tab.undo()
    expect(readDesign(store).frames.mpu).toBeUndefined()
    tab.redo()
    expect(readDesign(store).frames.mpu).toMatchObject({ x: 1800 })
  })

  it('puts the first frame of a page at 0, 0, and a frame given a place there', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('frame.delete', { frameId: 'sq' })
    tab.run('frame.delete', { frameId: 'banner' })
    const first = tab.run('frame.add', { pageId: 'p1', name: 'Frame', width: 600, height: 500 })
    expect(readDesign(store).frames[first]).toMatchObject({ x: 0, y: 0, order: 'a0' })
    const drawn = tab.run('frame.add', { pageId: 'p1', name: 'Frame', width: 600, height: 500, x: -40.5, y: 900 })
    expect(readDesign(store).frames[drawn]).toMatchObject({ x: -40.5, y: 900, order: 'a1' })
  })

  it('goes past the frame whose right edge is furthest right, not the one furthest right at its start', () => {
    const store = openTestStore(placed({ sq: { x: 0, y: 40, width: 3000 }, banner: { x: 1000, y: 400, width: 500 } }))
    const tab = openTestSession(store)
    const id = tab.run('frame.add', { pageId: 'p1', name: 'Frame', width: 600, height: 500 })
    expect(readDesign(store).frames[id]).toMatchObject({ x: 3200, y: 40 })
  })

  it('goes past the first by order of frames whose right edges tie', () => {
    const store = openTestStore(placed({ sq: { x: 0, y: 40, width: 1000 }, banner: { x: 500, y: 400, width: 500 } }))
    const tab = openTestSession(store)
    const id = tab.run('frame.add', { pageId: 'p1', name: 'Frame', width: 600, height: 500 })
    expect(readDesign(store).frames[id]).toMatchObject({ x: 1200, y: 40 })
  })

  it('places a frame among its own page’s frames only', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('page.add', { id: 'p2', name: 'Card 2', frame: { id: 'p2-sq', name: 'Square', width: 1080, height: 1080 } })
    const id = tab.run('frame.add', { pageId: 'p2', name: 'Frame', width: 600, height: 500 })
    expect(readDesign(store).frames[id]).toMatchObject({ pageId: 'p2', x: 1280, y: 0, order: 'a1' })
  })

  it('refuses a page that is missing, an id that is taken, a size a frame may not have, and an empty name', () => {
    const tab = openTestSession(openTestStore())
    const frame = { pageId: 'p1', name: 'Frame', width: 600, height: 500 }
    expect(() => tab.run('frame.add', { ...frame, pageId: 'nope' })).toThrow(/no page "nope"/)
    for (const id of ['sq', 'box', 'p1']) expect(() => tab.run('frame.add', { ...frame, id })).toThrow(/is taken/)
    expect(() => tab.run('frame.add', { ...frame, width: 49 })).toThrow(/at least 50 px/)
    expect(() => tab.run('frame.add', { ...frame, width: 8001 })).toThrow(/at most 8000 px/)
    expect(() => tab.run('frame.add', { ...frame, width: 6001 })).toThrow(/at most 12 times/)
    expect(() => tab.run('frame.add', { ...frame, width: 600.5 })).toThrow(/width/)
    expect(() => tab.run('frame.add', { ...frame, name: '   ' })).toThrow(/name/)
    expect(() => tab.run('frame.add', { ...frame, name: 'x'.repeat(121) })).toThrow(/name/)
  })
})

describe('frame.update', () => {
  it('sets the name, size, place and fills given, leaving the rest and the layers as they are, in one undo step', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const before = readDesign(store)
    const red = [{ type: 'solid' as const, color: '#FF0000FF' }]

    tab.run('frame.update', { frameId: 'banner', name: ' Sale ', width: 600, x: 1300.5, fills: red })

    const after = readDesign(store)
    expect(after.frames.banner).toEqual({ ...before.frames.banner, name: 'Sale', width: 600, x: 1300.5, fills: red })
    expect(after.nodes).toEqual(before.nodes)
    tab.run('frame.update', { frameId: 'banner', height: 90, y: -20 })
    expect(readDesign(store).frames.banner).toMatchObject({ width: 600, height: 90, x: 1300.5, y: -20 })
    tab.undo()
    tab.undo()
    expect(readDesign(store)).toEqual(before)
  })

  it('checks a new side against the frame’s other side, and refuses a frame that is missing or an empty name', () => {
    const tab = openTestSession(openTestStore())
    expect(() => tab.run('frame.update', { frameId: 'nope', name: 'X' })).toThrow(/no frame "nope"/)
    expect(() => tab.run('frame.update', { frameId: 'box', name: 'X' })).toThrow(/no frame "box"/)
    // The banner is 320 × 50: 650 wide would be 13 times its height.
    expect(() => tab.run('frame.update', { frameId: 'banner', width: 650 })).toThrow(/at most 12 times/)
    expect(() => tab.run('frame.update', { frameId: 'banner', height: 49 })).toThrow(/at least 50 px/)
    expect(() => tab.run('frame.update', { frameId: 'banner', height: 10.5 })).toThrow(/height/)
    expect(() => tab.run('frame.update', { frameId: 'banner', name: '' })).toThrow(/name/)
  })

  it('sets the guides given, also past the frame’s sides, as frame.resize leaves them, in one undo step', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const before = readDesign(store)
    const guides = [
      { axis: 'x' as const, at: -40 },
      { axis: 'y' as const, at: 20 },
    ]
    tab.run('frame.update', { frameId: 'banner', guides })
    expect(readDesign(store).frames.banner).toEqual({ ...before.frames.banner, guides })
    expect(() => tab.run('frame.update', { frameId: 'banner', guides: [{ axis: 'x', at: 1.5 }] })).toThrow(/at/)
    tab.undo()
    expect(readDesign(store)).toEqual(before)
  })
})

describe('frame.delete', () => {
  it('deletes a frame and its layers, leaving their linked copies in other frames, and undo brings them back', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const before = readDesign(store)

    tab.run('frame.delete', { frameId: 'sq' })

    const after = readDesign(store)
    expect(Object.keys(after.frames)).toEqual(['banner'])
    expect(Object.keys(after.nodes).sort()).toEqual(['banner-box', 'banner-headline'])
    expect(after.nodes['banner-box']).toEqual(before.nodes['banner-box'])
    expect(after.nodes['banner-headline']).toEqual(before.nodes['banner-headline'])
    tab.undo()
    expect(readDesign(store)).toEqual(before)
    tab.redo()
    expect(readDesign(store)).toEqual(after)
  })

  it('may leave a page with no frame', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('frame.delete', { frameId: 'sq' })
    tab.run('frame.delete', { frameId: 'banner' })
    expect(readDesign(store)).toMatchObject({ pages: { p1: {} }, frames: {}, nodes: {} })
    expect(() => tab.run('frame.delete', { frameId: 'sq' })).toThrow(/no frame "sq"/)
  })
})

describe('frame.duplicate', () => {
  it('copies a frame by the frame rule, with its name, size and fills, and a linked copy of every layer at its index', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('frame.update', { frameId: 'banner', fills: [{ type: 'solid', color: '#00FF00FF' }] })
    tab.run('node.create', { id: 'g', parentId: 'banner', layer: group })
    tab.run('node.create', { id: 'dot', parentId: 'g', layer: badge })
    tab.run('node.lock', { ids: ['dot'], lock: { move: true } })
    tab.run('node.update', { ids: ['banner-box'], patch: { visible: false } })
    tab.run('guide.add', { frameId: 'banner', axis: 'x', at: 160 })
    const before = readDesign(store)

    const copy = tab.run('frame.duplicate', { frameId: 'banner', newId: 'banner-2' })

    expect(copy).toBe('banner-2')
    const design = readDesign(store)
    expect(design.frames['banner-2']).toEqual({ ...before.frames.banner, x: 1800, y: 0, order: 'a2' })
    expect(design.frames['banner-2']?.guides).toEqual([{ axis: 'x', at: 160 }])
    const copies = childrenOf(design, 'banner-2')
    const originals = childrenOf(design, 'banner')
    expect(copies.map(([, n]) => [n.name, n.index, n.link])).toEqual(
      originals.map(([, n]) => [n.name, n.index, n.link]),
    )
    expect(copies.map(([, n]) => n.props)).toEqual(originals.map(([, n]) => n.props))
    expect(copies.every(([id]) => !originals.some(([original]) => original === id))).toBe(true)
    const [inside] = childrenOf(design, copies.find(([, n]) => n.name === 'G')?.[0] ?? '')
    expect(inside?.[1]).toEqual({ ...before.nodes.dot, parentId: copies.find(([, n]) => n.name === 'G')?.[0] })
    expect(design.nodes.headline).toEqual(before.nodes.headline)

    tab.undo()
    expect(readDesign(store)).toEqual(before)
    tab.redo()
    expect(readDesign(store)).toEqual(design)
  })

  it('gives the copy an id of its own when none is given, and refuses a frame that is missing or an id that is taken', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const copy = tab.run('frame.duplicate', { frameId: 'sq' })
    expect(readDesign(store).frames[copy]).toMatchObject({ name: 'Square', width: 1080, height: 1080 })
    expect(() => tab.run('frame.duplicate', { frameId: 'nope' })).toThrow(/no frame "nope"/)
    for (const newId of ['sq', 'box', 'p1'])
      expect(() => tab.run('frame.duplicate', { frameId: 'sq', newId })).toThrow(/is taken/)
  })
})

describe('frame.addSize', () => {
  const card = { type: 'group', name: 'Card', props: { x: 100, y: 700, width: 400, height: 200 } } as const
  const dot = {
    type: 'graphic',
    name: 'Dot',
    props: { x: 150, y: 750, width: 100, height: 100, rotation: 15, shape: { kind: 'ellipse' } },
  } as const

  it('copies a frame at a new size by the frame rule, named by it, every layer linked, scaled and placed by its constraints', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('node.create', { id: 'card', parentId: 'sq', layer: card })
    tab.run('node.create', { id: 'dot', parentId: 'card', layer: dot })
    tab.run('node.lock', { ids: ['dot'], lock: { move: true } })
    const before = readDesign(store)

    const mpu = tab.run('frame.addSize', { frameId: 'sq', newId: 'mpu', width: 300, height: 250 })

    const design = readDesign(store)
    expect(design.frames[mpu]).toEqual({
      ...before.frames.sq,
      name: '300×250',
      width: 300,
      height: 250,
      x: 1800,
      y: 0,
      order: 'a2',
    })
    const copies = Object.fromEntries(childrenOf(design, mpu).map(([, n]) => [n.link, n]))
    const link = (id: string) => before.nodes[id]?.link ?? ''
    expect(Object.keys(copies)).toEqual(['box', 'headline', link('card')])
    // 250 / 1080 scales every layer about the frame's top left into a 250 square; the frame's 50 more
    // across then go by each copy's guess. The box keeps to the left and top.
    expect(copies.box?.props).toMatchObject({
      x: 23.15,
      y: 23.15,
      width: 46.3,
      height: 23.15,
      constraints: { horizontal: 'left', vertical: 'top' },
    })
    // The headline's sides are within a tenth of the frame's: it stretches across, taking the 50.
    expect(copies.headline?.props).toMatchObject({
      x: 13.89,
      y: 138.89,
      width: 272.22,
      height: 23.15,
      text: 'Summer sale',
      style: { fontSize: 19.44 },
      runs: [{ start: 7, end: 11, style: { fontWeight: 800 } }],
      constraints: { horizontal: 'leftRight', vertical: 'center' },
    })
    expect(copies[link('card')]?.props).toMatchObject({
      x: 23.15,
      y: 162.04,
      width: 92.59,
      height: 46.3,
      constraints: { horizontal: 'left', vertical: 'bottom' },
    })
    const [[, inside] = []] = childrenOf(
      design,
      Object.keys(design.nodes).find((id) => design.nodes[id] === copies[link('card')]) ?? '',
    )
    // The dot in the group scales with it and gets no constraints of its own.
    expect(inside).toMatchObject({ link: link('dot'), name: 'Dot', lock: { move: true } })
    expect(inside?.props).toMatchObject({ x: 34.72, y: 173.61, width: 23.15, height: 23.15, rotation: 15 })
    expect(inside?.props).not.toHaveProperty('constraints')
    expect(design.nodes.box).toEqual(before.nodes.box)

    tab.undo()
    expect(readDesign(store)).toEqual(before)
  })

  it('leaves the frame’s guides out of the new frame, whose layout is its own size’s', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('guide.add', { frameId: 'sq', axis: 'x', at: 540 })

    const mpu = tab.run('frame.addSize', { frameId: 'sq', width: 300, height: 250 })

    const design = readDesign(store)
    expect(design.frames[mpu]).not.toHaveProperty('guides')
    expect(design.frames.sq?.guides).toEqual([{ axis: 'x', at: 540 }])
  })

  it('scales an auto layout box as other layers: its gap and paddings scale with it', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const layout = { direction: 'row', gap: 40, padding: { top: 50, right: 50, bottom: 50, left: 50 } } as const
    tab.run('node.create', {
      id: 'row',
      parentId: 'sq',
      layer: { type: 'box', name: 'Row', props: { x: 240, y: 440, width: 600, height: 200, layout } },
    })

    const mpu = tab.run('frame.addSize', { frameId: 'sq', newId: 'mpu', width: 300, height: 250 })

    const design = readDesign(store)
    const row = childrenOf(design, mpu).find(([, n]) => n.link === design.nodes.row?.link)?.[1]
    // 250 / 1080 is the smaller ratio: the box and its gap and paddings all scale by it.
    expect(row?.props).toMatchObject({
      width: 138.89,
      height: 46.3,
      layout: { gap: 9.26, padding: { top: 11.57, right: 11.57, bottom: 11.57, left: 11.57 } },
    })
  })

  it('scales a card’s stroke, corners, shadow and letter spacing by the smaller ratio, as its box', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const stroke = { paint: { type: 'solid', color: '#1F2329FF' }, width: 6 } as const
    const shadow = { type: 'dropShadow', color: '#00000040', x: 0, y: 20, blur: 40 } as const
    tab.run('node.create', {
      id: 'card',
      parentId: 'sq',
      layer: {
        type: 'box',
        name: 'Card',
        props: { x: 140, y: 340, width: 800, height: 400, cornerRadius: 40, strokes: [stroke], effects: [shadow] },
      },
    })
    tab.run('node.create', {
      id: 'label',
      parentId: 'card',
      layer: {
        type: 'text',
        name: 'Label',
        props: {
          ...{ x: 200, y: 400, width: 680, height: 120, text: 'Shop now' },
          style: {
            fontFamily: 'Noto Sans',
            fontSize: 64,
            color: '#111111FF',
            letterSpacing: { unit: 'px', value: 2 },
          },
        },
      },
    })

    const mpu = tab.run('frame.addSize', { frameId: 'sq', newId: 'mpu', width: 300, height: 250 })

    const design = readDesign(store)
    const copyOf = (id: string) =>
      Object.values(design.nodes).find((n) => n.link === design.nodes[id]?.link && n !== design.nodes[id])
    expect(copyOf('card')?.parentId).toBe(mpu)
    // s = 250 / 1080: the stroke 6 → 1.39, the corners 40 → 9.26, the shadow 0, 20, 40 → 0, 4.63, 9.26.
    expect(copyOf('card')?.props).toMatchObject({
      x: 57.41,
      y: 78.7,
      width: 185.19,
      height: 92.59,
      cornerRadius: 9.26,
      strokes: [{ ...stroke, width: 1.39 }],
      effects: [{ ...shadow, x: 0, y: 4.63, blur: 9.26, spread: 0 }],
    })
    // The letter spacing 2 → 0.46, with the font size 64 → 14.81.
    expect(copyOf('label')?.props).toMatchObject({
      style: { fontSize: 14.81, letterSpacing: { unit: 'px', value: 0.46 } },
    })
  })

  it('refuses a frame that is missing, an id that is taken and a size a frame may not have', () => {
    const tab = openTestSession(openTestStore())
    expect(() => tab.run('frame.addSize', { frameId: 'nope', width: 300, height: 250 })).toThrow(/no frame "nope"/)
    expect(() => tab.run('frame.addSize', { frameId: 'sq', newId: 'banner', width: 300, height: 250 })).toThrow(
      /id "banner" is taken/,
    )
    expect(() => tab.run('frame.addSize', { frameId: 'sq', width: 40, height: 250 })).toThrow(/at least 50 px/)
    expect(() => tab.run('frame.addSize', { frameId: 'sq', width: 1300, height: 100 })).toThrow(/at most 12 times/)
  })
})
