import { describe, expect, it } from 'vitest'

import { connectorsOf, framesInSection, framesOf, inOrder, sectionsOf } from '@dazbee/schema'

import { childrenOf, readDesign } from '../index.ts'
import { badge, openTestSession, sectionedDesign } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'

const story = { id: 'p2-story', name: 'Story and Reel', width: 1080, height: 1920 }

describe('page.add', () => {
  it('adds a page after the last one, holding one empty white frame of the size given, in one undo step', () => {
    const store = openTestStore()
    const tab = openTestSession(store)

    const page = tab.run('page.add', { name: 'Card 2', frame: story })

    const design = readDesign(store)
    expect(design.pages[page]).toEqual({ name: 'Card 2', order: expect.any(String) as string })
    expect(String(design.pages[page]?.order) > String(design.pages.p1?.order)).toBe(true)
    expect(design.frames['p2-story']).toEqual({
      pageId: page,
      name: 'Story and Reel',
      width: 1080,
      height: 1920,
      x: 0,
      y: 0,
      fills: [{ type: 'solid', color: '#FFFFFFFF' }],
      order: 'a0',
    })
    expect(childrenOf(design, 'p2-story')).toEqual([])

    tab.undo()
    expect(readDesign(store).pages[page]).toBeUndefined()
    expect(readDesign(store).frames['p2-story']).toBeUndefined()
  })

  it('gives the frame an id of its own when none is given', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const page = tab.run('page.add', { id: 'p2', name: 'Card 2', frame: { name: 'Frame', width: 600, height: 500 } })
    expect(page).toBe('p2')
    const [[id, frame] = []] = framesOf(readDesign(store), 'p2')
    expect(id).toBeTruthy()
    expect(frame).toMatchObject({ name: 'Frame', width: 600, height: 500 })
  })

  it('refuses ids that are taken and sizes a frame may not have', () => {
    const tab = openTestSession(openTestStore())
    expect(() => tab.run('page.add', { id: 'p1', name: 'P', frame: story })).toThrow(/id "p1" is taken/)
    expect(() => tab.run('page.add', { name: 'P', frame: { ...story, id: 'banner' } })).toThrow(/id "banner" is taken/)
    expect(() => tab.run('page.add', { name: 'P', frame: { ...story, id: 'box' } })).toThrow(/id "box" is taken/)
    expect(() => tab.run('page.add', { id: 'x', name: 'P', frame: { ...story, id: 'x' } })).toThrow(/id "x" is taken/)
    expect(() => tab.run('page.add', { name: 'P', frame: { ...story, width: 40 } })).toThrow(/at least 50 px/)
    expect(() => tab.run('page.add', { name: 'P', frame: { ...story, width: 1300, height: 100 } })).toThrow(
      /at most 12 times/,
    )
    expect(() => tab.run('page.add', { name: 'P', frame: { ...story, width: 100.5 } })).toThrow(/width/)
    expect(() => tab.run('page.add', { name: 'P', frame: { ...story, name: '  ' } })).toThrow(/name/)
  })

  it('refuses `__proto__` as an id, which no map of a design can keep as a key', () => {
    const tab = openTestSession(openTestStore())
    const frame = { name: 'Square', width: 1080, height: 1080 }
    expect(() => tab.run('page.add', { id: '__proto__', name: 'Page', frame })).toThrow(
      'page.add: id: an id is never "__proto__"',
    )
    expect(() => tab.run('page.add', { name: 'Page', frame: { ...frame, id: '__proto__' } })).toThrow(
      'page.add: frame.id: an id is never "__proto__"',
    )
  })
})

describe('page.addMany', () => {
  const cover = { name: 'Cover', width: 400, height: 300, x: -50, y: 20, fills: [] }
  const back = { name: 'Back', width: 1080, height: 1080, x: 500, y: 20 }
  const frames = [cover, back]

  it('adds pages after the last one, in order, each with its frames where given, in one undo step', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const added = tab.run('page.addMany', {
      pages: [
        { name: 'One', frames },
        { name: 'Two', frames: [cover] },
      ],
    })
    const design = readDesign(store)
    expect(inOrder(design.pages).map(([id, page]) => [id, page.name])).toEqual([
      ['p1', 'Page 1'],
      [added[0]?.id, 'One'],
      [added[1]?.id, 'Two'],
    ])
    expect(added.map(({ id }) => framesOf(design, id).map(([frameId]) => frameId))).toEqual(
      added.map((page) => page.frames),
    )
    expect(framesOf(design, added[0]?.id ?? '').map(([, f]) => [f.name, f.x, f.y, f.width, f.height, f.fills])).toEqual(
      [
        ['Cover', -50, 20, 400, 300, []],
        ['Back', 500, 20, 1080, 1080, [{ type: 'solid', color: '#FFFFFFFF' }]],
      ],
    )
    tab.undo()
    expect(Object.keys(readDesign(store).pages)).toEqual(['p1'])
    expect(Object.keys(readDesign(store).frames)).toEqual(
      Object.keys(design.frames).filter((id) => !added.some((p) => p.frames.includes(id))),
    )
  })

  it('refuses a frame size the editor does not take, naming the page and frame', () => {
    const tab = openTestSession(openTestStore())
    expect(() => tab.run('page.addMany', { pages: [{ name: 'P', frames: [cover, { ...back, width: 40 }] }] })).toThrow(
      /page 1, frame 2: .*at least 50 px/,
    )
  })
})

describe('page.duplicate', () => {
  it('copies the page after itself, with its frames and their layers under fresh ids', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('page.add', { id: 'p2', name: 'Card 2', frame: story })
    tab.run('node.create', {
      id: 'g',
      parentId: 'sq',
      layer: { type: 'group', name: 'G', props: { x: 0, y: 0, width: 10, height: 10 } },
    })
    tab.run('node.create', { id: 'dot', parentId: 'g', layer: badge })
    tab.run('guide.add', { frameId: 'sq', axis: 'y', at: 540 })

    const copy = tab.run('page.duplicate', { id: 'p1', name: 'Card 1 copy' })

    const design = readDesign(store)
    expect(inOrder(design.pages).map(([id]) => id)).toEqual(['p1', copy, 'p2'])
    expect(design.pages[copy]).toMatchObject({ name: 'Card 1 copy' })
    const frames = framesOf(design, copy)
    expect(frames.map(([, f]) => f)).toEqual(framesOf(design, 'p1').map(([, f]) => ({ ...f, pageId: copy })))
    expect(frames.every(([id]) => !['sq', 'banner'].includes(id))).toBe(true)
    expect(frames.map(([, f]) => f.guides)).toEqual([[{ axis: 'y', at: 540 }], undefined])
    const [[sq = ''] = [], [banner = ''] = []] = frames
    const layers = (frameId: string) => childrenOf(design, frameId).map(([, n]) => [n.name, n.index])
    expect(layers(sq)).toEqual(layers('sq'))
    expect(layers(banner)).toEqual(layers('banner'))
    const group = childrenOf(design, sq).find(([, n]) => n.name === 'G')?.[0] ?? ''
    expect(childrenOf(design, group).map(([, n]) => n.name)).toEqual(['Badge'])
    const headline = childrenOf(design, banner).find(([, n]) => n.name === 'Headline')?.[1]
    expect(headline?.props).toEqual(design.nodes['banner-headline']?.props)

    tab.undo()
    expect(readDesign(store).pages[copy]).toBeUndefined()
    expect(Object.keys(readDesign(store).frames).sort()).toEqual(['banner', 'p2-story', 'sq'])
    expect(Object.keys(readDesign(store).nodes).sort()).toEqual([
      'banner-box',
      'banner-headline',
      'box',
      'dot',
      'g',
      'headline',
    ])
  })

  it('gives the copies one new link id per old one: the copied frames stay linked to each other, and to nothing on the page they came from', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    const copy = tab.run('page.duplicate', { id: 'p1' })
    const design = readDesign(store)
    const [[sq = ''] = [], [banner = ''] = []] = framesOf(design, copy)
    const linkOf = (frameId: string, name: string) =>
      childrenOf(design, frameId).find(([, n]) => n.name === name)?.[1].link
    expect(linkOf(sq, 'Headline')).toBe(linkOf(banner, 'Headline'))
    expect(linkOf(sq, 'Box')).toBe(linkOf(banner, 'Box'))
    expect(linkOf(sq, 'Box')).not.toBe(linkOf(sq, 'Headline'))
    expect(['box', 'headline']).not.toContain(linkOf(sq, 'Box'))
    expect(['box', 'headline']).not.toContain(linkOf(sq, 'Headline'))
  })
})

describe('page.move', () => {
  it('reorders pages, and page.update renames one', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    tab.run('page.add', { id: 'p2', name: 'Card 2', frame: { ...story, id: 'p2-sq' } })
    tab.run('page.add', { id: 'p3', name: 'Card 3', frame: { ...story, id: 'p3-sq' } })
    const order = () => inOrder(readDesign(store).pages).map(([id]) => id)
    tab.run('page.move', { id: 'p3', before: 'p1' })
    expect(order()).toEqual(['p3', 'p1', 'p2'])
    tab.run('page.move', { id: 'p3', before: null })
    expect(order()).toEqual(['p1', 'p2', 'p3'])
    tab.undo()
    expect(order()).toEqual(['p3', 'p1', 'p2'])
    tab.run('page.update', { id: 'p2', name: 'Offer' })
    expect(readDesign(store).pages.p2?.name).toBe('Offer')
    tab.undo()
    expect(readDesign(store).pages.p2?.name).toBe('Card 2')
    expect(() => tab.run('page.update', { id: 'nope', name: 'X' })).toThrow(/no page "nope"/)
    expect(() => tab.run('page.move', { id: 'p2', before: 'nope' })).toThrow(/no other page/)
  })
})

describe('page.delete', () => {
  it('removes a page with its frames and their layers, keeps the last page, and undo brings them back', () => {
    const store = openTestStore()
    const tab = openTestSession(store)
    expect(() => tab.run('page.delete', { id: 'p1' })).toThrow(/at least one page/)
    const copy = tab.run('page.duplicate', { id: 'p1' })
    const before = readDesign(store)

    tab.run('page.delete', { id: 'p1' })
    const after = readDesign(store)
    expect(after.pages.p1).toBeUndefined()
    expect(after.frames.sq).toBeUndefined()
    expect(after.frames.banner).toBeUndefined()
    expect(after.nodes.box).toBeUndefined()
    expect(after.nodes['banner-headline']).toBeUndefined()
    expect(Object.values(after.frames).every((f) => f.pageId === copy)).toBe(true)
    expect(Object.keys(after.nodes)).toHaveLength(4)

    tab.undo()
    expect(readDesign(store)).toEqual(before)
  })
})

describe('page commands on a page with sections and connectors', () => {
  it('page.duplicate copies them with new ids, its frames in the copied sections joined by the copied connectors, none starred', () => {
    const store = openTestStore(sectionedDesign())
    const tab = openTestSession(store)
    const copy = tab.run('page.duplicate', { id: 'p1' })
    const design = readDesign(store)
    const sections = sectionsOf(design, copy)
    expect(sections.map(([, s]) => s)).toEqual([
      { pageId: copy, title: 'Ads', order: 'a0' },
      { pageId: copy, title: 'Banners', order: 'a1' },
    ])
    const [[ads = ''] = [], [banners = ''] = []] = sections
    expect(['ads', 'banners']).not.toContain(ads)
    const named = (sectionId: string) => framesInSection(design, sectionId).map(([, f]) => f.name)
    expect(named(ads)).toEqual(['Square', 'Story'])
    expect(named(banners)).toEqual(['Wide'])
    const idOf = (name: string) => framesOf(design, copy).find(([, f]) => f.name === name)?.[0]
    expect(connectorsOf(design, copy).map(([, c]) => [c.from, c.to, c.order])).toEqual([
      [idOf('Square'), idOf('Story'), 'a0'],
      [ads, idOf('Wide'), 'a1'],
    ])
    expect(framesOf(design, copy).some(([, f]) => f.starred)).toBe(false)
    expect(design.frames.story?.starred).toBe(true)
    tab.undo()
    expect(readDesign(store)).toEqual(readDesign(openTestStore(sectionedDesign())))
  })

  it('page.delete deletes them itself, and its undo brings them back', () => {
    const store = openTestStore(sectionedDesign())
    const tab = openTestSession(store)
    const before = readDesign(store)
    tab.run('page.delete', { id: 'p1' })
    const after = readDesign(store)
    expect(Object.keys(after.sections)).toEqual(['far-section'])
    expect(after.connectors).toEqual({})
    tab.undo()
    expect(readDesign(store)).toEqual(before)
  })
})
