// Catalogs for the chooser's tests: 300 Google families, 60 in each category, and two brand uploads;
// and the whole library's size of them.
import type { FontFamily, FontSource } from '@dazbee/schema'

import { FONT_CATEGORIES, type FontCategory } from '@/components/brand-kit/font-catalog.ts'

/** A family of Regular and Bold in a category, from a source, with Google's rank and scripts when given. */
export function testFamily(
  name: string,
  source: FontSource,
  category: FontCategory | null,
  google: { rank: number; scripts: string[] } | null = null,
): FontFamily {
  return {
    family: name,
    source,
    category,
    ...google,
    faces: [400, 700].map((weight) => ({
      id: `${name}-${weight}`,
      family: name,
      weight,
      style: 'normal' as const,
      source,
      byteSize: 1,
    })),
  }
}

/** The scripts of the family at `i`: Latin, but Arabic and Latin every tenth from 3, and Japanese alone every fiftieth from 7. */
const scriptsAt = (i: number) => (i % 10 === 3 ? ['Arab', 'Latn'] : i % 50 === 7 ? ['Jpan'] : ['Latn'])

/** `count` Google families, each named with its place and category (`Family 070 serif`), ranked in that order. */
function googleFamilies(count: number, perCategory: number): FontFamily[] {
  return Array.from({ length: count }, (_, i) => {
    const category = FONT_CATEGORIES[Math.floor(i / perCategory) % FONT_CATEGORIES.length] ?? 'sans-serif'
    const name = `Family ${String(i).padStart(count > 1000 ? 4 : 3, '0')} ${category}`
    return testFamily(name, 'google', category, { rank: i + 1, scripts: scriptsAt(i) })
  })
}

/**
 * Family 000 to Family 299, each named with its category (`Family 070 serif`) and ranked in that
 * order: the first 60 sans serif, then 60 serif, display, handwriting and monospace. Each draws
 * Latin, but every tenth from Family 003 draws Arabic and Latin, and every fiftieth from Family 007
 * Japanese alone. Then two uploads, which have no category and no scripts.
 */
export const TEST_CATALOG: readonly FontFamily[] = [
  ...googleFamilies(300, 60),
  testFamily('Harbour Grotesk', 'upload', null),
  testFamily('Harbour Script', 'upload', null),
]

/** 1,950 Google families, as many as the whole library, named and ranked as `TEST_CATALOG`'s are. */
export const LIBRARY_CATALOG: readonly FontFamily[] = googleFamilies(1950, 390)
