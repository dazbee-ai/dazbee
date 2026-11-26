import { describe, expect, it } from 'vitest'

import { FRAME_GAP } from './frames.ts'
import {
  Connector,
  connectorsOf,
  connectorsTouching,
  framesInSection,
  MAX_SECTION_TITLE,
  Section,
  sectionBox,
  sectionOf,
  sectionsByPlace,
  sectionsOf,
} from './sections.ts'

const frame = (pageId: string, order: string, x: number, y: number, more: Record<string, unknown> = {}) => ({
  pageId,
  name: 'F',
  width: 100,
  height: 50,
  x,
  y,
  fills: [],
  order,
  ...more,
})

/**
 * A page of four frames: two in section "top" (to the right, above), one in section "left" (to the
 * left, below), one in none; an empty section, a section on another page, and connectors to each.
 */
const design = () => ({
  frames: {
    a: frame('p1', 'a0', 500, 0, { sectionId: 'top' }),
    b: frame('p1', 'a1', 700, 100, { sectionId: 'top' }),
    c: frame('p1', 'a2', 0, 300, { sectionId: 'left' }),
    loose: frame('p1', 'a3', 0, 0),
    // Names a section on another page: it is in none.
    astray: frame('p1', 'a4', 900, 900, { sectionId: 'far' }),
    away: frame('p2', 'a0', 0, 0, { sectionId: 'far' }),
  },
  sections: {
    left: { pageId: 'p1', title: 'Left', order: 'a1' },
    top: { pageId: 'p1', title: 'Top', order: 'a2' },
    empty: { pageId: 'p1', title: 'Empty', order: 'a0' },
    far: { pageId: 'p2', title: 'Far', order: 'a0' },
  },
  connectors: {
    ab: { pageId: 'p1', from: 'a', to: 'b', order: 'a1' },
    toSection: { pageId: 'p1', from: 'loose', to: 'top', order: 'a0' },
    toEmpty: { pageId: 'p1', from: 'loose', to: 'empty', order: 'a2' },
    toGone: { pageId: 'p1', from: 'a', to: 'gone', order: 'a3' },
    acrossPages: { pageId: 'p1', from: 'a', to: 'away', order: 'a4' },
    onTwo: { pageId: 'p2', from: 'away', to: 'far', order: 'a0' },
  },
})

describe('Section', () => {
  it('takes a title of 1 to 120 characters, trimmed', () => {
    expect(Section.parse({ pageId: 'p1', title: '  Feed ads ', order: 'a0' }).title).toBe('Feed ads')
    expect(Section.safeParse({ pageId: 'p1', title: '   ', order: 'a0' }).success).toBe(false)
    expect(Section.safeParse({ pageId: 'p1', title: 'x'.repeat(MAX_SECTION_TITLE), order: 'a0' }).success).toBe(true)
    expect(Section.safeParse({ pageId: 'p1', title: 'x'.repeat(MAX_SECTION_TITLE + 1), order: 'a0' }).success).toBe(
      false,
    )
  })
})

describe('Connector', () => {
  it('holds its page, its two ends and its order', () => {
    expect(Connector.parse({ pageId: 'p1', from: 'a', to: 'b', order: 'a0' })).toEqual({
      pageId: 'p1',
      from: 'a',
      to: 'b',
      order: 'a0',
    })
    expect(Connector.safeParse({ pageId: 'p1', from: 'a', order: 'a0' }).success).toBe(false)
  })
})

describe('sectionsOf', () => {
  it("lists a page's sections that a frame of the page names, in order", () => {
    expect(sectionsOf(design(), 'p1').map(([id]) => id)).toEqual(['left', 'top'])
    expect(sectionsOf(design(), 'p2').map(([id]) => id)).toEqual(['far'])
    expect(sectionsOf({ frames: {}, sections: {} }, 'p1')).toEqual([])
  })
})

describe('framesInSection', () => {
  it('lists the frames of its page that name it, in order; none for a missing section', () => {
    expect(framesInSection(design(), 'top').map(([id]) => id)).toEqual(['a', 'b'])
    expect(framesInSection(design(), 'far').map(([id]) => id)).toEqual(['away'])
    expect(framesInSection(design(), 'empty')).toEqual([])
    expect(framesInSection(design(), 'gone')).toEqual([])
  })
})

describe('sectionOf', () => {
  it("is the section a frame names, but not one that is gone or on another page, nor a missing frame's", () => {
    expect(sectionOf(design(), 'a')).toBe('top')
    expect(sectionOf(design(), 'loose')).toBeUndefined()
    expect(sectionOf(design(), 'astray')).toBeUndefined()
    expect(sectionOf({ ...design(), sections: {} }, 'a')).toBeUndefined()
    expect(sectionOf(design(), 'gone')).toBeUndefined()
  })
})

describe('connectorsOf', () => {
  it('lists the connectors of a page with both ends drawn on it, in order', () => {
    expect(connectorsOf(design(), 'p1').map(([id]) => id)).toEqual(['toSection', 'ab'])
    expect(connectorsOf(design(), 'p2').map(([id]) => id)).toEqual(['onTwo'])
  })
})

describe('connectorsTouching', () => {
  it('lists every connector with an end at the id, drawn or not', () => {
    expect(connectorsTouching(design(), 'a').map(([id]) => id)).toEqual(['ab', 'toGone', 'acrossPages'])
    expect(connectorsTouching(design(), 'top').map(([id]) => id)).toEqual(['toSection'])
    expect(connectorsTouching(design(), 'nothing')).toEqual([])
  })
})

describe('sectionBox', () => {
  it('is the union of its frames on the page, none for a section no frame names', () => {
    expect(sectionBox(design(), 'top')).toEqual({ x: 500, y: 0, width: 300, height: 150 })
    expect(sectionBox(design(), 'left')).toEqual({ x: 0, y: 300, width: 100, height: 50 })
    expect(sectionBox(design(), 'empty')).toBeUndefined()
    expect(sectionBox(design(), 'gone')).toBeUndefined()
  })
})

describe('sectionsByPlace', () => {
  it("orders a page's drawn sections by their box's top, then its left", () => {
    expect(sectionsByPlace(design(), 'p1').map(([id]) => id)).toEqual(['top', 'left'])
    const level = design()
    level.frames.c = { ...level.frames.c, y: 0 }
    expect(sectionsByPlace(level, 'p1').map(([id]) => id)).toEqual(['left', 'top'])
  })

  it('breaks a tie of tops by the left, whatever the order', () => {
    const d = design()
    d.frames.c = { ...d.frames.c, x: 500 + FRAME_GAP, y: 0 }
    expect(sectionsByPlace(d, 'p1').map(([id]) => id)).toEqual(['top', 'left'])
  })
})
