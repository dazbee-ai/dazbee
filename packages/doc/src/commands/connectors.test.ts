import { describe, expect, it } from 'vitest'

import { connectorsOf } from '@dazbee/schema'

import { readDesign } from '../store.ts'
import { openTestSession, sectionedDesign } from '../test-design.ts'
import { openTestStore } from '../test-store.ts'

/** A tab on the sectioned design: "ads" holds the square and the story, "banners" the wide frame. */
function sectioned() {
  const store = openTestStore(sectionedDesign())
  return { store, tab: openTestSession(store) }
}

describe('connector.add', () => {
  it('joins two frames, or a frame and a section, after the page’s connectors, in one undo step', () => {
    const { store, tab } = sectioned()
    const before = readDesign(store)

    const id = tab.run('connector.add', { pageId: 'p1', from: 'wide', to: 'tall', id: 'wide-tall' })
    const toSection = tab.run('connector.add', { pageId: 'p1', from: 'other', to: 'banners' })

    expect(id).toBe('wide-tall')
    const design = readDesign(store)
    expect(design.connectors['wide-tall']).toEqual({ pageId: 'p1', from: 'wide', to: 'tall', order: 'a2' })
    expect(design.connectors[toSection]).toEqual({ pageId: 'p1', from: 'other', to: 'banners', order: 'a3' })
    expect(connectorsOf(design, 'p1').map(([c]) => c)).toEqual(['sq-story', 'ads-wide', 'wide-tall', toSection])
    tab.undo()
    tab.undo()
    expect(readDesign(store)).toEqual(before)
  })

  it('refuses a self-join, a frame joined to its own section, a pair already joined either way, and an end on another page', () => {
    const { tab } = sectioned()
    const add = (from: string, to: string) => () => tab.run('connector.add', { pageId: 'p1', from, to })
    expect(add('tall', 'tall')).toThrow(/two different/)
    expect(add('sq', 'ads')).toThrow(/its own section/)
    expect(add('ads', 'story')).toThrow(/its own section/)
    expect(add('sq', 'story')).toThrow(/already joined/)
    expect(add('story', 'sq')).toThrow(/already joined/)
    expect(add('wide', 'ads')).toThrow(/already joined/)
    expect(add('sq', 'far')).toThrow(/"far" is on another page/)
    expect(add('far-section', 'sq')).toThrow(/"far-section" is on another page/)
  })

  it('refuses a missing page, a taken id, a missing end, and a section no frame names', () => {
    const design = sectionedDesign()
    const store = openTestStore({
      ...design,
      sections: { ...design.sections, empty: { pageId: 'p1', title: 'Empty', order: 'a5' } },
    })
    const tab = openTestSession(store)
    const add = { pageId: 'p1', from: 'tall', to: 'other' }
    expect(() => tab.run('connector.add', { ...add, pageId: 'nope' })).toThrow(/no page "nope"/)
    expect(() => tab.run('connector.add', { ...add, id: 'sq-story' })).toThrow(/taken/)
    expect(() => tab.run('connector.add', { ...add, to: 'nope' })).toThrow(/no frame or section "nope"/)
    expect(() => tab.run('connector.add', { ...add, to: 'bg' })).toThrow(/no frame or section "bg"/)
    expect(() => tab.run('connector.add', { ...add, to: 'empty' })).toThrow(/section "empty" has no frames/)
  })

  it('deletes, on its page, a connector with a missing end that a race left', () => {
    const design = sectionedDesign()
    const loose = { pageId: 'p1', from: 'gone', to: 'sq', order: 'a5' }
    const store = openTestStore({ ...design, connectors: { ...design.connectors, loose } })
    const tab = openTestSession(store)
    tab.run('connector.add', { pageId: 'p1', from: 'tall', to: 'other' })
    expect(readDesign(store).connectors.loose).toBeUndefined()
  })
})

describe('connector.delete', () => {
  it('deletes a connector in one undo step, and refuses a missing one', () => {
    const { store, tab } = sectioned()
    const before = readDesign(store)
    tab.run('connector.delete', { connectorId: 'ads-wide' })
    expect(Object.keys(readDesign(store).connectors)).toEqual(['sq-story'])
    tab.undo()
    expect(readDesign(store)).toEqual(before)
    expect(() => tab.run('connector.delete', { connectorId: 'nope' })).toThrow(/no connector "nope"/)
    expect(() => tab.run('connector.delete', { connectorId: 'sq' })).toThrow(/no connector "sq"/)
  })
})
