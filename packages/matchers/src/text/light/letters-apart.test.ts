import { afterAll, describe, expect, it } from 'vitest'

import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'

import { textDrawer } from '../draw-text.ts'
import { SPACING_RANGE } from './fit.ts'
import { spacedApart } from './letters-apart.ts'
import { inkParts, lookOf, OVERLAP_FROM, worstOverlap } from './test-letters.ts'

const ck = await loadCanvasKit()
const drawer = textDrawer(
  ck,
  loadFontFiles().map(({ family, bytes }) => ({ family, bytes })),
)
afterAll(() => drawer.delete())

describe('spacedApart', () => {
  it('keeps a spacing at or above no letter spacing', () => {
    for (const spacing of [0, 4, 30]) {
      const look = lookOf('Noto Sans', 800, 60, spacing)
      expect(spacedApart(drawer, 'WAVE', look)).toBe(look)
    }
  })

  it("gives a heavy face's tightest spacing at which its letters don't overlap, and a spacing above it as it is", () => {
    const words = 'WAVE minimum'
    const squeezed = lookOf('Noto Sans', 800, 60, SPACING_RANGE.min)
    expect(worstOverlap(drawer, words, squeezed)).toBeGreaterThan(OVERLAP_FROM)
    const tightest = spacedApart(drawer, words, squeezed).spacing
    expect(tightest).toBeGreaterThan(SPACING_RANGE.min)
    expect(tightest).toBeLessThan(0)
    expect(worstOverlap(drawer, words, { ...squeezed, spacing: tightest })).toBeLessThanOrEqual(OVERLAP_FROM)
    expect(spacedApart(drawer, words, { ...squeezed, spacing: tightest + 1 }).spacing).toBe(tightest + 1)
    expect(spacedApart(drawer, words, { ...squeezed, spacing: tightest - 1 }).spacing).toBe(tightest)
  })

  it('keeps letters an outline grows apart too', () => {
    const plain = lookOf('Noto Sans', 800, 60, SPACING_RANGE.min)
    const outlined = { ...plain, outline: { width: 6, color: '#000000FF' as const } }
    expect(spacedApart(drawer, 'WAVE', outlined).spacing).toBeGreaterThan(spacedApart(drawer, 'WAVE', plain).spacing)
  })

  it.each([
    ['Arabic', 'Noto Naskh Arabic', 'تخفيضات الصيف'],
    ['Devanagari', 'Noto Sans Devanagari', 'दिवाली सेल आज ही'],
  ])('lets %s letters touch as they do unspaced, still joined', (_, family, words) => {
    const squeezed = lookOf(family, 700, 60, SPACING_RANGE.min)
    const apart = spacedApart(drawer, words, squeezed)
    expect(worstOverlap(drawer, words, apart)).toBeLessThanOrEqual(OVERLAP_FROM)
    expect(inkParts(drawer, words, apart)).toBe(inkParts(drawer, words, { ...squeezed, spacing: 0 }))
  })
})
