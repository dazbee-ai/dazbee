import { describe, expect, it } from 'vitest'

import { findPattern } from '@dazbee/patterns'
import { EMPTY_BRAND_KIT } from '@dazbee/schema'

import { patternSuggestions } from './pattern-suggestions.ts'

/** A photo and a cut-out, as apply_pattern reads them. */
const PHOTO = {
  assetId: 'photo',
  width: 1600,
  height: 1000,
  look: { subject: { x: 300, y: 200, width: 900, height: 600 }, inks: [] },
}
const CUT_OUT = { ...PHOTO, look: { ...PHOTO.look, extent: { x: 280, y: 180, width: 940, height: 640 } } }

describe('patternSuggestions', () => {
  it('suggests two or three ways from what the pattern and kit hold', () => {
    const photoBand = findPattern('photo-band')
    const arch = findPattern('arch')
    const wordsOnly = findPattern('words-only')
    if (!photoBand || !arch || !wordsOnly) throw new Error('no pattern')
    const headline = 'Free delivery on every order'
    // A kit with no heading font is told to choose one; a photo, to move its crop.
    const fontless = patternSuggestions(photoBand, 'bold', EMPTY_BRAND_KIT, { headline, photo: PHOTO })
    expect(fontless.length).toBeGreaterThanOrEqual(2)
    expect(fontless.length).toBeLessThanOrEqual(3)
    expect(fontless[0]).toMatch(/Anton/)
    expect(fontless.join(' ')).toMatch(/crop/)
    // A cut-out is fitted whole, so it is set larger or at an angle, never cropped.
    const kit = { ...EMPTY_BRAND_KIT, fonts: [{ token: 'heading' as const, name: 'Heading', family: 'Brand Serif' }] }
    const standing = patternSuggestions(arch, 'minimal', kit, { headline, photo: CUT_OUT })
    expect(standing.join(' ')).not.toMatch(/crop|list_fonts/)
    expect(standing.join(' ')).toMatch(/larger/)
    // Words only, with no photo and no highlight, gets a graphic and a headline treatment.
    const words = patternSuggestions(wordsOnly, 'minimal', kit, { headline })
    expect(words.join(' ')).toMatch(/search_graphics/)
    expect(words.join(' ')).toMatch(/highlight/)
  })
})
