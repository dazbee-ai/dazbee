import { describe, expect, it } from 'vitest'

import { drawnRows, keptInPlace, layOut, ROW_HEIGHT, scrollToShow, scrollToShowWeights } from './drawn-rows.ts'
import { fontRows } from './font-rows.ts'
import { LIBRARY_CATALOG, TEST_CATALOG } from './test-families.ts'

const rows = fontRows(TEST_CATALOG, { query: '', category: null, script: null }, ['Family 150 display'], {
  family: null,
  weight: null,
})
const layout = layOut(rows)
/** How tall the list shows, as at 1440 × 900. */
const VIEW = 320

const names = (from: number, to: number) =>
  rows.slice(from, to).map((row) => (row.kind === 'family' ? row.family.family : `# ${row.group}`))

describe('layOut', () => {
  it('stacks the rows, the first heading taking no room as it stays pinned above the list', () => {
    expect(layout.tops.slice(0, 4)).toEqual([0, 0, ROW_HEIGHT.family, 2 * ROW_HEIGHT.family])
    expect(layout.total).toBe(2 * ROW_HEIGHT.heading + 303 * ROW_HEIGHT.family)
  })
})

describe('drawnRows', () => {
  it('draws only the rows in view and a few past it, of 300 families', () => {
    const { from, to } = drawnRows(rows, layout, 0, VIEW)
    expect(from).toBe(0)
    expect(to - from).toBeLessThan(25)
    expect((layout.tops[to - 1] ?? 0) + ROW_HEIGHT.family).toBeGreaterThanOrEqual(VIEW)
  })

  it('draws the rows a scroll brings into view, and none from the top', () => {
    const scrollTop =
      layout.tops[rows.findIndex((row) => row.kind === 'family' && row.family.family === 'Family 200 handwriting')] ?? 0
    const { from, to } = drawnRows(rows, layout, scrollTop, VIEW)
    expect(names(from, to)).toContain('Family 200 handwriting')
    expect(names(from, to)).toContain('Family 207 handwriting')
    expect(from).toBeGreaterThan(150)
    expect(to - from).toBeLessThan(30)
  })

  it('pins the heading of the group the list is scrolled to, once its own heading has gone by', () => {
    const recentHeading = rows.findIndex((row) => row.kind === 'heading' && row.group === 'recent')
    const top = layout.tops[recentHeading] ?? 0
    expect(drawnRows(rows, layout, 0, VIEW).pinned).toBe('brand')
    expect(drawnRows(rows, layout, top + 10, VIEW).pinned).toBe('brand')
    expect(drawnRows(rows, layout, top + ROW_HEIGHT.heading, VIEW).pinned).toBe('recent')
    expect(drawnRows(rows, layout, layout.total - VIEW, VIEW).pinned).toBe('all')
  })

  it('draws as few rows of the whole library’s 1,950 families, wherever the list is scrolled to', () => {
    const library = fontRows(LIBRARY_CATALOG, { query: '', category: null, script: null }, [], {
      family: null,
      weight: null,
    })
    const stacked = layOut(library)
    expect(stacked.total).toBe(1950 * ROW_HEIGHT.family)
    for (const scrollTop of [0, stacked.total / 2, stacked.total - VIEW]) {
      const { from, to, pinned } = drawnRows(library, stacked, scrollTop, VIEW)
      expect(to - from).toBeLessThan(30)
      expect(pinned).toBe('all')
      const shown = library.slice(from, to).flatMap((row) => (row.kind === 'family' ? [row.family.family] : []))
      const atTop = library[Math.floor(scrollTop / ROW_HEIGHT.family) + 1]
      expect(atTop?.kind === 'family' && shown.includes(atTop.family.family)).toBe(true)
    }
  })

  it('draws nothing in an empty list', () => {
    expect(drawnRows([], layOut([]), 0, VIEW)).toEqual({ from: 0, to: 0, pinned: null })
  })
})

describe('scrollToShow', () => {
  it('scrolls the least that shows the row whole, and not at all when it shows', () => {
    const at = 100
    const top = layout.tops[at] ?? 0
    expect(scrollToShow(rows, layout, at, 0, VIEW)).toBe(top + ROW_HEIGHT.family - VIEW)
    expect(scrollToShow(rows, layout, at, top + 1000, VIEW)).toBe(top)
    expect(scrollToShow(rows, layout, at, top - 10, VIEW)).toBe(top - 10)
  })
})

describe('keptInPlace', () => {
  it('keeps a picked family where it showed, though the weights of the family picked before close above it', () => {
    const chosen = (family: string) =>
      fontRows(TEST_CATALOG, { query: '', category: null, script: null }, ['Family 150 display'], {
        family,
        weight: 400,
      })
    const before = chosen('Family 150 display')
    const after = chosen('Family 200 handwriting')
    const key = 'all Family 200 handwriting'
    const top = layOut(before).tops[before.findIndex((row) => row.key === key)] ?? 0
    const scrollTop = top - 100
    const kept = keptInPlace(after, layOut(after), key, top - scrollTop)
    const newTop = layOut(after).tops[after.findIndex((row) => row.key === key)] ?? 0
    expect(newTop).toBeLessThan(top)
    expect(newTop - (kept ?? 0)).toBe(100)
  })

  it('has no scroll for a row no longer listed', () => {
    expect(keptInPlace(rows, layout, 'all Gone Sans', 40)).toBeNull()
  })
})

describe('scrollToShowWeights', () => {
  const picked = fontRows(TEST_CATALOG, { query: '', category: null, script: null }, ['Family 150 display'], {
    family: 'Family 200 handwriting',
    weight: 400,
  })
  const pickedLayout = layOut(picked)
  const key = 'all Family 200 handwriting'
  const top = pickedLayout.tops[picked.findIndex((row) => row.key === key)] ?? 0
  /** The bottom of the family's last weight row: its two weights, Regular and Bold, under it. */
  const weightsEnd = top + ROW_HEIGHT.family + 2 * ROW_HEIGHT.weight

  it('scrolls a family picked at the bottom edge up just far enough to show its weights', () => {
    const scrollTop = top + ROW_HEIGHT.family - VIEW
    expect(scrollToShowWeights(picked, pickedLayout, key, scrollTop, VIEW)).toBe(weightsEnd - VIEW)
  })

  it('leaves the list where it is when the weights already show', () => {
    expect(scrollToShowWeights(picked, pickedLayout, key, top - 40, VIEW)).toBe(top - 40)
  })

  it('never scrolls the family itself past the top edge', () => {
    expect(scrollToShowWeights(picked, pickedLayout, key, top + ROW_HEIGHT.family - 50, 50)).toBe(top)
  })

  it('has no scroll for a row no longer listed', () => {
    expect(scrollToShowWeights(picked, pickedLayout, 'all Gone Sans', 0, VIEW)).toBeNull()
  })
})
