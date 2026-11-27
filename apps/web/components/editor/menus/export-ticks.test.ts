import { describe, expect, it } from 'vitest'

import { Design, type DesignInput } from '@dazbee/schema'

import { exportGroups, firstTicks, shownOrder } from './export-ticks.ts'

/** A frame 100 square on page p1 at x, y, by its order. */
const frame = (name: string, order: string, x: number, y: number, more: Record<string, unknown> = {}) => ({
  pageId: 'p1',
  name,
  width: 100,
  height: 100,
  x,
  y,
  order,
  ...more,
})
/** Five frames on page p1, a to e by order, none in a section and none starred, and one on page p2. */
const FIVE: DesignInput = {
  meta: { designId: 'd1', name: 'Export' },
  pages: { p1: { name: 'Page 1', order: 'a0' }, p2: { name: 'Page 2', order: 'a1' } },
  frames: {
    a: frame('A', 'a0', 0, 0),
    b: frame('B', 'a1', 200, 0),
    c: frame('C', 'a2', 400, 0),
    d: frame('D', 'a3', 0, 400),
    e: frame('E', 'a4', 200, 400),
    other: { ...frame('Other', 'a0', 0, 0), pageId: 'p2' },
  },
  nodes: {},
}
const design = (input: DesignInput) => Design.parse(input)
/** FIVE with some frames' keys changed. */
const withFrames = (changes: Record<string, Record<string, unknown>>, sections: DesignInput['sections'] = {}) => {
  const frames = { ...FIVE.frames } as Record<string, Record<string, unknown>>
  for (const [id, change] of Object.entries(changes)) frames[id] = { ...frames[id], ...change }
  return design({ ...FIVE, frames: frames as DesignInput['frames'], sections })
}
/**
 * FIVE in two sections: "Lower" holds d and e, and "Upper" holds c and a, so Upper is listed first,
 * by the top of its frames, though it is ordered after Lower; b is in none.
 */
const SECTIONED = withFrames(
  { a: { sectionId: 'upper' }, c: { sectionId: 'upper' }, d: { sectionId: 'lower' }, e: { sectionId: 'lower' } },
  {
    lower: { pageId: 'p1', title: 'Lower', order: 'a0' },
    upper: { pageId: 'p1', title: 'Upper', order: 'a1' },
  },
)
const idsOf = (frames: [string, unknown][]) => frames.map(([id]) => id)

describe('firstTicks', () => {
  it("ticks the page's starred frames alone: two of five starred, those two", () => {
    const ticks = firstTicks(withFrames({ b: { starred: true }, e: { starred: true } }), 'p1')
    expect(ticks === 'all' ? ticks : [...ticks].sort()).toEqual(['b', 'e'])
  })

  it('ticks every frame when none of the page is starred', () => {
    expect(firstTicks(design(FIVE), 'p1')).toBe('all')
  })

  it('leaves the AI frames unticked when none is starred, and ticks a starred one', () => {
    const ticks = firstTicks(design(FIVE), 'p1', new Set(['a', 'c']))
    expect(ticks === 'all' ? ticks : [...ticks].sort()).toEqual(['b', 'd', 'e'])
    expect(firstTicks(withFrames({ a: { starred: true } }), 'p1', new Set(['a', 'c']))).toEqual(new Set(['a']))
  })

  it("reads only the page's own stars: one starred on another page leaves every frame ticked", () => {
    expect(firstTicks(withFrames({ other: { starred: true } }), 'p1')).toBe('all')
  })
})

describe('exportGroups', () => {
  it('lists a page with no sections as one group under no title, in the page order', () => {
    const groups = exportGroups(design(FIVE), 'p1')
    expect(groups.map((g) => [g.section, idsOf(g.frames)])).toEqual([[null, ['a', 'b', 'c', 'd', 'e']]])
  })

  it('lists the sections top to bottom under their titles, each by the page order, then the frames in none', () => {
    const groups = exportGroups(SECTIONED, 'p1')
    expect(groups.map((g) => [g.section, idsOf(g.frames)])).toEqual([
      [{ id: 'upper', title: 'Upper' }, ['a', 'c']],
      [{ id: 'lower', title: 'Lower' }, ['d', 'e']],
      [null, ['b']],
    ])
  })

  it('leaves out the group under no title when every frame is in a section', () => {
    const all = withFrames(
      {
        a: { sectionId: 's' },
        b: { sectionId: 's' },
        c: { sectionId: 's' },
        d: { sectionId: 's' },
        e: { sectionId: 's' },
      },
      { s: { pageId: 'p1', title: 'All', order: 'a0' } },
    )
    expect(exportGroups(all, 'p1').map((g) => g.section?.title ?? null)).toEqual(['All'])
  })

  it('lists a frame naming a missing section among the frames in none', () => {
    const groups = exportGroups(withFrames({ c: { sectionId: 'gone' } }), 'p1')
    expect(groups.map((g) => [g.section, idsOf(g.frames)])).toEqual([[null, ['a', 'b', 'c', 'd', 'e']]])
  })

  it('lists no group for a page with no frames', () => {
    const empty = design({ ...FIVE, frames: { other: FIVE.frames.other as DesignInput['frames'][string] } })
    expect(exportGroups(empty, 'p1')).toEqual([])
  })
})

describe('shownOrder', () => {
  it('gives the frames in the order the groups show them, which the files export in', () => {
    expect(shownOrder(exportGroups(SECTIONED, 'p1'))).toEqual(['a', 'c', 'd', 'e', 'b'])
  })
})
