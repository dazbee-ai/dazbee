import { describe, expect, it } from 'vitest'

import { connectorsOf, framesInSection, sectionsOf } from '@dazbee/schema'

import { readDesign } from '../store.ts'
import { openTestSession, sectionedDesign } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'

/** A tab on the sectioned design: "ads" holds the square and the story, "banners" the wide frame. */
function sectioned() {
  const store = openTestStore(sectionedDesign())
  return { store, tab: openTestSession(store) }
}

const frameIdsIn = (store: Parameters<typeof readDesign>[0], sectionId: string) =>
  framesInSection(readDesign(store), sectionId).map(([id]) => id)

describe('section.add', () => {
  it('makes a section of the frames given, titled as given and trimmed, after the page’s sections, in one undo step', () => {
    const { store, tab } = sectioned()
    const before = readDesign(store)

    const id = tab.run('section.add', { pageId: 'p1', id: 'extra', title: '  Extras ', frameIds: ['tall', 'other'] })

    expect(id).toBe('extra')
    const design = readDesign(store)
    expect(design.sections.extra).toEqual({ pageId: 'p1', title: 'Extras', order: 'a2' })
    expect(frameIdsIn(store, 'extra')).toEqual(['tall', 'other'])
    expect(sectionsOf(design, 'p1').map(([s]) => s)).toEqual(['ads', 'banners', 'extra'])
    tab.undo()
    expect(readDesign(store)).toEqual(before)
  })

  it('takes the first free "Section N" of the page when given no title', () => {
    const { store, tab } = sectioned()
    tab.run('section.update', { sectionId: 'ads', title: 'Section 1' })
    const id = tab.run('section.add', { pageId: 'p1', frameIds: ['tall'] })
    expect(readDesign(store).sections[id]?.title).toBe('Section 2')
    // The far page holds no "Section N": its first is 1.
    const far = tab.run('section.add', { pageId: 'p2', frameIds: ['far'] })
    expect(readDesign(store).sections[far]?.title).toBe('Section 1')
  })

  it('deletes a section it takes the last frame from, with its connectors, and undo brings them back', () => {
    const { store, tab } = sectioned()
    const before = readDesign(store)
    tab.run('section.add', { pageId: 'p1', id: 'moved', frameIds: ['wide', 'tall'] })
    const design = readDesign(store)
    expect(design.sections.banners).toBeUndefined()
    expect(design.connectors['ads-wide']).toEqual(before.connectors['ads-wide'])
    // "ads" keeps both its frames, and its connector to the wide frame stays: the wide frame is still there.
    expect(frameIdsIn(store, 'ads')).toEqual(['sq', 'story'])
    tab.undo()
    expect(readDesign(store)).toEqual(before)
  })

  it('leaves drawn the connectors whose ends stay', () => {
    const { store, tab } = sectioned()
    tab.run('section.add', { pageId: 'p1', frameIds: ['tall'] })
    expect(connectorsOf(readDesign(store), 'p1').map(([c]) => c)).toEqual(['sq-story', 'ads-wide'])
  })

  it('refuses a missing page, a taken id, a missing frame, a frame on another page, and a blank or long title', () => {
    const { tab } = sectioned()
    const add = { pageId: 'p1', frameIds: ['tall'] }
    expect(() => tab.run('section.add', { ...add, pageId: 'nope' })).toThrow(/no page "nope"/)
    for (const id of ['ads', 'sq', 'sq-story']) expect(() => tab.run('section.add', { ...add, id })).toThrow(/taken/)
    expect(() => tab.run('section.add', { ...add, frameIds: ['nope'] })).toThrow(/no frame "nope"/)
    expect(() => tab.run('section.add', { ...add, frameIds: ['tall', 'far'] })).toThrow(/"far" is on another page/)
    expect(() => tab.run('section.add', { ...add, frameIds: [] })).toThrow(/frameIds/)
    expect(() => tab.run('section.add', { ...add, title: '   ' })).toThrow(/title/)
    expect(() => tab.run('section.add', { ...add, title: 'x'.repeat(121) })).toThrow(/title/)
  })
})

describe('section.update', () => {
  it('renames a section, trimmed, in one undo step, and refuses a missing section', () => {
    const { store, tab } = sectioned()
    tab.run('section.update', { sectionId: 'ads', title: ' Feed ads  ' })
    expect(readDesign(store).sections.ads?.title).toBe('Feed ads')
    tab.undo()
    expect(readDesign(store).sections.ads?.title).toBe('Ads')
    expect(() => tab.run('section.update', { sectionId: 'nope', title: 'X' })).toThrow(/no section "nope"/)
    expect(() => tab.run('section.update', { sectionId: 'sq', title: 'X' })).toThrow(/no section "sq"/)
  })
})

describe('section.ungroup', () => {
  it('frees its frames where they are and deletes it with its connectors, in one undo step', () => {
    const { store, tab } = sectioned()
    const before = readDesign(store)
    tab.run('section.ungroup', { sectionId: 'ads' })
    const design = readDesign(store)
    expect(design.sections.ads).toBeUndefined()
    expect(design.connectors['ads-wide']).toBeUndefined()
    expect(design.connectors['sq-story']).toEqual(before.connectors['sq-story'])
    expect(design.frames.sq).toEqual({ ...before.frames.sq, sectionId: undefined })
    expect(design.frames.sq).not.toHaveProperty('sectionId')
    expect(design.frames.story).not.toHaveProperty('sectionId')
    expect(design.nodes).toEqual(before.nodes)
    tab.undo()
    expect(readDesign(store)).toEqual(before)
    expect(() => tab.run('section.ungroup', { sectionId: 'nope' })).toThrow(/no section "nope"/)
  })
})

describe('section.delete', () => {
  it('deletes the section, its frames, their layers and every connector of them, and one undo brings all back', () => {
    const { store, tab } = sectioned()
    const before = readDesign(store)
    tab.run('section.delete', { sectionId: 'ads' })
    const design = readDesign(store)
    expect(design.sections.ads).toBeUndefined()
    expect(design.frames.sq).toBeUndefined()
    expect(design.frames.story).toBeUndefined()
    expect(Object.keys(design.connectors)).toEqual([])
    expect(['bg', 'grp', 'title', 'badge', 'story-bg', 'story-title'].filter((id) => design.nodes[id])).toEqual([])
    expect(design.nodes['wide-title']).toEqual(before.nodes['wide-title'])
    expect(design.sections.banners).toEqual(before.sections.banners)
    tab.undo()
    expect(readDesign(store)).toEqual(before)
    expect(() => tab.run('section.delete', { sectionId: 'nope' })).toThrow(/no section "nope"/)
  })
})

describe('section.move', () => {
  it('moves each of its frames by the offset, to whole pixels, in one undo step', () => {
    const { store, tab } = sectioned()
    const before = readDesign(store)
    tab.run('section.move', { sectionId: 'ads', dx: 10.4, dy: -20.6 })
    const design = readDesign(store)
    expect(design.frames.sq).toMatchObject({ x: 10, y: -21 })
    expect(design.frames.story).toMatchObject({ x: 1290, y: -21 })
    expect(design.frames.wide).toEqual(before.frames.wide)
    expect(design.nodes).toEqual(before.nodes)
    tab.undo()
    expect(readDesign(store)).toEqual(before)
  })

  it('refuses a missing section and a move past where a frame can be', () => {
    const { tab } = sectioned()
    expect(() => tab.run('section.move', { sectionId: 'nope', dx: 1, dy: 1 })).toThrow(/no section "nope"/)
    tab.run('section.move', { sectionId: 'ads', dx: Number.MAX_VALUE, dy: 0 })
    expect(() => tab.run('section.move', { sectionId: 'ads', dx: Number.MAX_VALUE, dy: 0 })).toThrow(/past where/)
  })
})

describe('section.duplicate', () => {
  it('copies its frames as one block right of it, below any frame in the way, into a new section titled "<title> copy"', () => {
    const { store, tab } = sectioned()
    const before = readDesign(store)

    const id = tab.run('section.duplicate', { sectionId: 'ads', newId: 'ads-2' })

    expect(id).toBe('ads-2')
    const design = readDesign(store)
    expect(design.sections['ads-2']).toEqual({ pageId: 'p1', title: 'Ads copy', order: 'a2' })
    const copies = framesInSection(design, 'ads-2')
    // The section's box ends at 2360: the block starts 200 right of it, below the wide frame (to 628) plus 200.
    expect(copies.map(([, f]) => [f.name, f.x, f.y, f.width, f.height])).toEqual([
      ['Square', 2560, 828, 1080, 1080],
      ['Story', 3840, 828, 1080, 1920],
    ])
    expect(copies.every(([, f]) => f.starred === undefined)).toBe(true)
    // Their layers are linked copies; no connector is copied.
    const [[sqCopy = ''] = []] = copies
    const links = (frameId: string) =>
      Object.values(design.nodes)
        .filter((n) => n.parentId === frameId)
        .map((n) => n.link)
    expect(links(sqCopy)).toEqual(links('sq'))
    expect(Object.keys(design.connectors)).toEqual(['sq-story', 'ads-wide'])
    tab.undo()
    expect(readDesign(store)).toEqual(before)
  })

  it('keeps the gap given from the section, and from what is in the way below it', () => {
    const { store, tab } = sectioned()
    const id = tab.run('section.duplicate', { sectionId: 'ads', gap: 600 })
    const copies = framesInSection(readDesign(store), id)
    // The section's box ends at 2360: the block starts 600 right of it, below the wide frame (to 628) plus 600.
    expect(copies.map(([, f]) => [f.x, f.y])).toEqual([
      [2960, 1228],
      [4240, 1228],
    ])
    expect(() => tab.run('section.duplicate', { sectionId: 'ads', gap: -1 })).toThrow()
  })

  it('cuts the copy’s title to 120 characters, with no space left at its end', () => {
    const { store, tab } = sectioned()
    tab.run('section.update', { sectionId: 'ads', title: 'x'.repeat(119) })
    const id = tab.run('section.duplicate', { sectionId: 'ads' })
    expect(readDesign(store).sections[id]?.title).toBe('x'.repeat(119))
    tab.run('section.update', { sectionId: 'ads', title: 'x'.repeat(117) })
    const cut = tab.run('section.duplicate', { sectionId: 'ads' })
    expect(readDesign(store).sections[cut]?.title).toBe(`${'x'.repeat(117)} co`)
  })

  it('refuses a missing section, a section with no frames, and an id already in use', () => {
    const store = openTestStore({
      ...sectionedDesign(),
      sections: { ...sectionedDesign().sections, empty: { pageId: 'p1', title: 'Empty', order: 'a5' } },
    })
    const tab = openTestSession(store)
    expect(() => tab.run('section.duplicate', { sectionId: 'nope' })).toThrow(/no section "nope"/)
    expect(() => tab.run('section.duplicate', { sectionId: 'empty' })).toThrow(/no frames/)
    expect(() => tab.run('section.duplicate', { sectionId: 'ads', newId: 'sq' })).toThrow(/taken/)
  })
})

describe('frame.setSection', () => {
  it('puts frames in a section in one undo step', () => {
    const { store, tab } = sectioned()
    const before = readDesign(store)
    tab.run('frame.setSection', { frameIds: ['tall', 'other'], sectionId: 'banners' })
    expect(frameIdsIn(store, 'banners')).toEqual(['wide', 'tall', 'other'])
    tab.undo()
    expect(readDesign(store)).toEqual(before)
  })

  it('deletes a section it empties, and a connector between a frame and the section it joins', () => {
    const { store, tab } = sectioned()
    const before = readDesign(store)
    tab.run('frame.setSection', { frameIds: ['wide'], sectionId: 'ads' })
    const design = readDesign(store)
    expect(frameIdsIn(store, 'ads')).toEqual(['sq', 'story', 'wide'])
    expect(design.sections.banners).toBeUndefined()
    expect(design.connectors['ads-wide']).toBeUndefined()
    expect(design.connectors['sq-story']).toEqual(before.connectors['sq-story'])
    tab.undo()
    expect(readDesign(store)).toEqual(before)
  })

  it('takes frames out of every section with null', () => {
    const { store, tab } = sectioned()
    tab.run('frame.setSection', { frameIds: ['wide', 'sq'], sectionId: null })
    const design = readDesign(store)
    expect(design.frames.wide).not.toHaveProperty('sectionId')
    expect(design.frames.sq).not.toHaveProperty('sectionId')
    expect(design.sections.banners).toBeUndefined()
    expect(frameIdsIn(store, 'ads')).toEqual(['story'])
  })

  it('refuses a missing frame, frames on two pages, and a section that is missing or on another page', () => {
    const { tab } = sectioned()
    expect(() => tab.run('frame.setSection', { frameIds: ['nope'], sectionId: null })).toThrow(/no frame "nope"/)
    expect(() => tab.run('frame.setSection', { frameIds: ['sq', 'far'], sectionId: null })).toThrow(/another page/)
    expect(() => tab.run('frame.setSection', { frameIds: ['sq'], sectionId: 'nope' })).toThrow(/no section "nope"/)
    expect(() => tab.run('frame.setSection', { frameIds: ['sq'], sectionId: 'far-section' })).toThrow(
      /section "far-section" is on another page/,
    )
    expect(() => tab.run('frame.setSection', { frameIds: [], sectionId: null })).toThrow(/frameIds/)
  })
})
