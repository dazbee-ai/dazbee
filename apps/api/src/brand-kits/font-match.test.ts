import { describe, expect, it } from 'vitest'

import type { FontFamily } from '@dazbee/schema'

import { matchFont } from './font-match.ts'

/** A Google family of `category`, at `rank` in popularity, upright from `min` to `max`, drawing `scripts`. */
function google(
  family: string,
  category: string,
  rank: number,
  min: number,
  max: number,
  scripts = ['Latn'],
): FontFamily {
  return {
    family,
    source: 'google',
    category,
    rank,
    scripts,
    faces: [
      {
        id: `${family}-normal`,
        family,
        weight: 400,
        weights: { min, max },
        style: 'normal',
        source: 'google',
        byteSize: 1,
      },
      {
        id: `${family}-italic`,
        family,
        weight: 400,
        weights: { min, max },
        style: 'italic',
        source: 'google',
        byteSize: 1,
      },
    ],
  }
}

/** A catalog of a few Google families and one brand upload. */
const CATALOG: FontFamily[] = [
  google('Noto Sans Arabic', 'sans-serif', 1, 100, 900, ['Arab']),
  google('Roboto', 'sans-serif', 2, 100, 900),
  google('Inter', 'sans-serif', 5, 100, 900),
  google('Roboto Mono', 'monospace', 20, 100, 700),
  google('Merriweather', 'serif', 25, 300, 900),
  google('Playfair Display', 'serif', 30, 400, 900),
  google('Space Grotesk', 'sans-serif', 150, 300, 700),
  google('Hanken Grotesk', 'sans-serif', 200, 100, 900),
  {
    family: 'Proxima Nova',
    source: 'upload',
    category: null,
    faces: [{ id: 'own', family: 'Proxima Nova', weight: 400, style: 'normal', source: 'upload', byteSize: 1 }],
  },
]

describe('matchFont', () => {
  it('uses a family the catalog has as it is, a Google Font or the brand’s own upload, whatever ending the site gives it', () => {
    expect(matchFont(['Inter var', 'sans-serif'], [], CATALOG)).toEqual({
      site: 'Inter var',
      family: 'Inter',
      match: 'same',
    })
    expect(matchFont(['InterVariable', 'sans-serif'], [], CATALOG)).toMatchObject({ family: 'Inter' })
    expect(matchFont(['proxima nova', 'sans-serif'], [], CATALOG)).toEqual({
      site: 'proxima nova',
      family: 'Proxima Nova',
      match: 'same',
    })
  })

  it('uses the site’s own fallback when the catalog has it', () => {
    expect(matchFont(['Graphik', 'Helvetica Neue', 'Roboto', 'sans-serif'], [], CATALOG)).toEqual({
      site: 'Graphik',
      family: 'Roboto',
      match: 'fallback',
    })
  })

  it('picks a family sharing a word that describes the design, drawing the weights the site uses', () => {
    expect(matchFont(['Aperture Grotesk', 'Arial', 'sans-serif'], [300, 700], CATALOG)).toEqual({
      site: 'Aperture Grotesk',
      family: 'Space Grotesk',
      match: 'closest',
    })
    // Space Grotesk draws neither 200 nor 800.
    expect(matchFont(['Aperture Grotesk', 'sans-serif'], [200, 800], CATALOG)).toMatchObject({
      family: 'Hanken Grotesk',
    })
  })

  it('keeps to the category the stack’s generic family names, else the name’s words, and picks the most used there', () => {
    expect(matchFont(['Tiempos Headline', 'Georgia', 'serif'], [400, 700], CATALOG)).toMatchObject({
      family: 'Merriweather',
    })
    expect(matchFont(['GT America Mono'], [], CATALOG)).toMatchObject({ family: 'Roboto Mono', match: 'closest' })
    expect(matchFont(['Acme Slab'], [], CATALOG)).toMatchObject({ family: 'Merriweather' })
  })

  it('never picks a family that draws no Latin, and matches a stack of system fonts by its category', () => {
    expect(matchFont(['Circular Std', 'sans-serif'], [], CATALOG)).toMatchObject({ family: 'Roboto' })
    expect(matchFont(['-apple-system', 'BlinkMacSystemFont', 'sans-serif'], [], CATALOG)).toEqual({
      site: '-apple-system',
      family: 'Roboto',
      match: 'closest',
    })
  })

  it('gives nothing for a stack that names no family, or an empty catalog', () => {
    expect(matchFont([], [], CATALOG)).toBeNull()
    expect(matchFont(['emoji'], [], CATALOG)).toBeNull()
    expect(matchFont(['Inter'], [], [])).toBeNull()
  })
})
