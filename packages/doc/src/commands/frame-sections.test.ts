// The frame commands around sections, connectors and the star (ADR-0024).
import { describe, expect, it } from 'vitest'

import { type DesignInput, framesInSection } from '@dazbee/schema'

import { readDesign } from '../store.ts'
import { openTestSession, sectionedDesign } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'

/** A tab on the sectioned design, with a connector from the tall frame to the "banners" section. */
function sectioned() {
  const design = sectionedDesign()
  const tallBanners = { pageId: 'p1', from: 'tall', to: 'banners', order: 'a2' }
  const store = openTestStore({ ...design, connectors: { ...design.connectors, 'tall-banners': tallBanners } })
  return { store, tab: openTestSession(store) }
}

describe('frame.add', () => {
  it('puts the frame in the section given, and refuses one that is missing or on another page', () => {
    const { store, tab } = sectioned()
    const frame = { pageId: 'p1', name: 'Frame', width: 300, height: 250 }
    const id = tab.run('frame.add', { ...frame, sectionId: 'banners' })
    expect(framesInSection(readDesign(store), 'banners').map(([f]) => f)).toEqual(['wide', id])
    expect(() => tab.run('frame.add', { ...frame, sectionId: 'nope' })).toThrow(/no section "nope"/)
    expect(() => tab.run('frame.add', { ...frame, sectionId: 'far-section' })).toThrow(/on another page/)
  })
})

describe('frame.update', () => {
  it('stars a frame with true and takes the star off with false, each one undo step named for it, in a batch too', () => {
    const { store, tab } = sectioned()
    tab.run('frame.update', { frameId: 'tall', starred: true })
    expect(readDesign(store).frames.tall?.starred).toBe(true)
    expect(tab.undoName()).toBe('star')
    tab.batch(() => tab.run('frame.update', { frameId: 'story', starred: false }))
    expect(readDesign(store).frames.story).not.toHaveProperty('starred')
    expect(tab.undoName()).toBe('unstar')
    tab.undo()
    expect(readDesign(store).frames.story?.starred).toBe(true)
    tab.run('frame.update', { frameId: 'tall', name: 'Tall', starred: false })
    expect(tab.undoName()).toBe('editFrame')
    expect(readDesign(store).frames.tall).not.toHaveProperty('starred')
  })
})

describe('frame.delete', () => {
  it('deletes the frame’s connectors, and a section it empties with that section’s connectors, in one undo step', () => {
    const { store, tab } = sectioned()
    const before = readDesign(store)
    tab.run('frame.delete', { frameId: 'wide' })
    const design = readDesign(store)
    expect(design.sections.banners).toBeUndefined()
    expect(Object.keys(design.connectors)).toEqual(['sq-story'])
    tab.undo()
    expect(readDesign(store)).toEqual(before)
  })

  it('deletes, on its page, a section no frame names and a connector with a missing end', () => {
    const design = sectionedDesign()
    const store = openTestStore({
      ...design,
      sections: { ...design.sections, empty: { pageId: 'p1', title: 'Empty', order: 'a5' } },
      connectors: { ...design.connectors, loose: { pageId: 'p1', from: 'gone', to: 'sq', order: 'a5' } },
    })
    const tab = openTestSession(store)
    tab.run('frame.delete', { frameId: 'other' })
    const after = readDesign(store)
    expect(after.sections.empty).toBeUndefined()
    expect(after.connectors.loose).toBeUndefined()
    expect(after.sections['far-section']).toBeDefined()
  })
})

describe('frame.duplicate', () => {
  it('puts a copy of a frame in a section into that section, right of its frames, below any frame in the way, unstarred', () => {
    const { store, tab } = sectioned()
    const copy = tab.run('frame.duplicate', { frameId: 'story' })
    const design = readDesign(store)
    // "ads" ends at the story's right edge, 2360: 200 past it, at the story's top, is the wide frame (to 628).
    expect(design.frames[copy]).toMatchObject({ sectionId: 'ads', x: 2560, y: 828, width: 1080, height: 1920 })
    expect(design.frames[copy]).not.toHaveProperty('starred')
    expect(Object.keys(design.connectors)).toEqual(['sq-story', 'ads-wide', 'tall-banners'])
  })

  it('places a copy of a frame in no section as before, in no section', () => {
    const { store, tab } = sectioned()
    tab.run('frame.update', { frameId: 'tall', starred: true })
    const copy = tab.run('frame.duplicate', { frameId: 'tall' })
    // The other frame's right edge, 4960, is the furthest right.
    expect(readDesign(store).frames[copy]).toEqual({
      ...readDesign(store).frames.tall,
      x: 5160,
      starred: undefined,
      order: 'a5',
    })
  })
})

describe('frame.duplicate beside another section', () => {
  it('steps below the other section’s box, not into the empty space between its frames', () => {
    const design = sectionedDesign()
    const frame = (id: string) => design.frames[id] as DesignInput['frames'][string]
    const store = openTestStore({
      ...design,
      frames: {
        ...design.frames,
        tall: { ...frame('tall'), sectionId: 'gap' },
        other: { ...frame('other'), y: 1500, sectionId: 'gap' },
      },
      sections: { ...design.sections, gap: { pageId: 'p1', title: 'Gap', order: 'a2' } },
    })
    const tab = openTestSession(store)
    const copy = tab.run('frame.duplicate', { frameId: 'wide' })
    // Right of the wide frame (to 3760) is "gap", 3960…4960 × 0…2000, empty from 600 to 1500.
    expect(readDesign(store).frames[copy]).toMatchObject({ sectionId: 'banners', x: 3960, y: 2200 })
  })
})

describe('frame.addSize', () => {
  it('puts the new size of a frame in a section into that section, right of its frames, below any frame in the way', () => {
    const { store, tab } = sectioned()
    const copy = tab.run('frame.addSize', { frameId: 'wide', width: 300, height: 600 })
    // The wide frame ends at 3760: 200 past it is the tall frame, to 600.
    expect(readDesign(store).frames[copy]).toMatchObject({ sectionId: 'banners', x: 3960, y: 800 })
  })
})
