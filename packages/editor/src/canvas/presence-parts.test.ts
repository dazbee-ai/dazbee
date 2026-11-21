import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ShownPerson } from '../presence.ts'
import { presenceParts, textOn } from './presence-parts.ts'
import { type Fake, fake, SQUARE, STORY } from './test-overlay.ts'

const BOB: ShownPerson = {
  tabId: 7,
  name: 'Bob',
  colour: '#9747FF',
  cursor: { x: 120.5, y: 40 },
  layers: [
    { frame: SQUARE, id: 'a' },
    { frame: STORY, id: 'b' },
  ],
  frame: null,
}
const CAT: ShownPerson = { tabId: 9, name: 'Cat', colour: '#14AE5C', cursor: null, layers: [], frame: STORY }
/** Iconoir's sparks, the agent's avatar: the big star, then the small one. */
const SPARKS_BIG =
  'M8 15C12.8747 15 15 12.949 15 8C15 12.949 17.1104 15 22 15C17.1104 15 15 17.1104 15 22C15 17.1104 12.8747 15 8 15Z'
const SPARKS_SMALL =
  'M2 6.5C5.13376 6.5 6.5 5.18153 6.5 2C6.5 5.18153 7.85669 6.5 11 6.5C7.85669 6.5 6.5 7.85669 6.5 11C6.5 7.85669 5.13376 6.5 2 6.5Z'

/** A layer's outline as the overlay builds one, named by its frame and layer. */
const layerOutline = (frame: { id: string }, id: string) => fake(`layer ${frame.id} ${id}`) as unknown as HTMLElement
const frameOutline = (frame: { id: string }) => fake(`frame ${frame.id}`) as unknown as HTMLElement

beforeEach(() => {
  vi.stubGlobal('document', { createElement: () => fake(), createElementNS: (_ns: string, name: string) => fake(name) })
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('presenceParts', () => {
  it("outlines each person's layers and picked frame in their colour, and draws a cursor only where their pointer is", () => {
    const { outlines, cursors } = presenceParts([BOB, CAT], layerOutline, frameOutline) as unknown as {
      outlines: Fake[]
      cursors: Fake[]
    }
    expect(outlines.map((o) => [o.className, o.style.color, o.dataset.tab])).toEqual([
      ['layer one-sq a', '#9747FF', '7'],
      ['layer one-story b', '#9747FF', '7'],
      ['frame one-story', '#14AE5C', '9'],
    ])
    expect(cursors).toHaveLength(1)
    const [cursor] = cursors
    expect([cursor?.className, cursor?.dataset.tab, cursor?.style]).toEqual([
      'presence-cursor',
      '7',
      { left: '120.5px', top: '40px', color: '#9747FF' },
    ])
    const [dart, tag] = cursor?.children ?? []
    expect(dart?.attributes.class).toBe('presence-dart')
    expect(dart?.children[0]?.attributes.d).toBe('M0 0 L3.5 15.5 L7.5 8.5 L15.5 4 Z')
    expect([tag?.className, tag?.style]).toEqual(['presence-tag', { background: '#9747FF', color: '#FFFFFF' }])
    // A person's tag holds their name alone: no avatar, no note.
    expect(tag?.children.map((c) => [c.className, c.textContent])).toEqual([['presence-name', 'Bob']])
  })

  it("starts an agent's tag with its avatar, and puts its note under its name", () => {
    const claude: ShownPerson = { ...CAT, tabId: 3, name: 'Claude (agent)', cursor: { x: 5, y: 6 }, agent: true }
    const noted = { ...claude, note: 'Writing the headline' }
    const tags = presenceParts([claude, noted], layerOutline, frameOutline).cursors.map(
      (cursor) => (cursor as unknown as Fake).children[1],
    )
    for (const tag of tags) {
      expect([tag?.className, tag?.style]).toEqual(['presence-tag', { background: '#14AE5C', color: '#FFFFFF' }])
      const [avatar] = tag?.children ?? []
      expect([avatar?.attributes.class, avatar?.style]).toEqual([
        'presence-avatar',
        { background: '#FFFFFF', fill: '#14AE5C' },
      ])
      expect(avatar?.children.map((path) => path.attributes.d)).toEqual([SPARKS_BIG, SPARKS_SMALL])
    }
    expect(tags[0]?.children.slice(1).map((c) => [c.className, c.textContent])).toEqual([
      ['presence-name', 'Claude (agent)'],
    ])
    expect(tags[1]?.children.slice(1).map((c) => [c.className, c.textContent])).toEqual([
      ['presence-name', 'Claude (agent)'],
      ['presence-note', 'Writing the headline'],
    ])
  })

  it('leaves out a layer the overlay has no box for', () => {
    const { outlines } = presenceParts(
      [BOB],
      (frame, id) => (id === 'a' ? layerOutline(frame, id) : null),
      frameOutline,
    )
    expect(outlines).toHaveLength(1)
  })
})

describe('textOn', () => {
  it('reads dark on a light colour and white on a dark one, by its weighted lightness', () => {
    expect([textOn('#FFE066'), textOn('#0D99FF'), textOn('#665CE0'), textOn('#FFFFFF')]).toEqual([
      '#1E1E1E',
      '#FFFFFF',
      '#FFFFFF',
      '#1E1E1E',
    ])
  })
})
