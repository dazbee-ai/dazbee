import { describe, expect, it } from 'vitest'

import { EMPTY_BRAND_KIT } from '@dazbee/schema'

import { findPattern } from './catalog.ts'
import { DRAFT, draftSuggestions } from './draft.ts'
import { CONTENT, KIT } from './test-input.ts'

describe('a pattern’s draft', () => {
  it('is told as a first draft to adapt, with two or three ways to make it the brand’s own from what the pattern and kit hold', () => {
    const photoBand = findPattern('photo-band')
    const wordsOnly = findPattern('words-only')
    if (!photoBand || !wordsOnly) throw new Error('no pattern')
    expect(DRAFT).toMatch(/first draft/)
    // A kit with no heading font is told to choose one; a photo, to move its crop.
    const fontless = draftSuggestions(photoBand, 'bold', EMPTY_BRAND_KIT, CONTENT)
    expect(fontless.length).toBeGreaterThanOrEqual(2)
    expect(fontless.length).toBeLessThanOrEqual(3)
    expect(fontless[0]).toMatch(/Anton/)
    expect(fontless.join(' ')).toMatch(/crop/)
    // A kit with its own heading font isn't; words only, with no photo, gets a graphic and a headline treatment.
    const words = draftSuggestions(wordsOnly, 'minimal', KIT, { headline: 'Free delivery on every order' })
    expect(words.join(' ')).not.toMatch(/list_fonts|crop/)
    expect(words.join(' ')).toMatch(/search_graphics/)
    expect(words.join(' ')).toMatch(/highlight/)
  })
})
