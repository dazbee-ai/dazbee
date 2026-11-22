import { describe, expect, it } from 'vitest'

import { type BrandKit, EMPTY_BRAND_KIT } from '@dazbee/schema'

import { buildPattern, buildPatterns } from './catalog.ts'
import { KEEP, UNDERLINED_LEADING } from './headline-runs.ts'
import { apart } from './palette.ts'
import { CHANNEL_SIZES, CONTENT, EVERY, KIT, measure } from './test-input.ts'

describe('a pattern’s headline', () => {
  it('sets the headline’s highlight apart without a slant its font hasn’t got', () => {
    // A kit whose colours don't read on the ground, with the style's own Anton, which has no italic.
    const kit = { ...EMPTY_BRAND_KIT, colors: [{ token: 'accent', name: 'Accent', value: '#FFFFFFFF' }] }
    const { nodes } = buildPattern('words-only', {
      style: 'bold',
      kit: kit as BrandKit,
      content: { headline: 'Free delivery on every order', highlight: 'Free delivery' },
      width: 1080,
      height: 1080,
      measure,
    })
    const headline = nodes.headline
    if (headline?.type !== 'text') throw new Error('no headline')
    expect(headline.props.runs.map((run) => run.style.fontStyle)).not.toContain('italic')
    expect(headline.props.runs).toHaveLength(1)
    // The words set apart stay on one line: the space between them doesn't break.
    expect(headline.props.text).toBe('Free delivery on every order')
  })

  it('sets an underlined highlight with the leading its rule needs to clear the next line', () => {
    // A ground no colour of the kit reads on as small text, at a size where the headline is small text.
    const kit = {
      ...EMPTY_BRAND_KIT,
      colors: [
        { token: 'primary', name: 'Primary', value: '#7A7A7AFF' },
        { token: 'accent', name: 'Accent', value: '#8A8A8AFF' },
        { token: 'secondary', name: 'Secondary', value: '#6F6F6FFF' },
        { token: 'text', name: 'Text', value: '#000000FF' },
        { token: 'background', name: 'Background', value: '#7F7F7FFF' },
      ],
    }
    const { nodes } = buildPattern('words-only', {
      style: 'bold',
      kit: kit as BrandKit,
      content: { headline: 'Free delivery on every order and more', highlight: 'Free delivery' },
      width: 300,
      height: 600,
      measure,
    })
    const headline = nodes.headline
    if (headline?.type !== 'text') throw new Error('no headline')
    expect(headline.props.runs.some((run) => run.style.underline)).toBe(true)
    expect(headline.props.style.lineHeight).toBeGreaterThanOrEqual(UNDERLINED_LEADING)
  })

  it('sets a highlight in a colour that reads on the ground as large text does, before an underline', () => {
    const { nodes } = buildPattern('words-only', {
      style: 'bold',
      kit: KIT,
      content: { headline: 'Free delivery on every order', highlight: 'Free delivery' },
      width: 1080,
      height: 1080,
      measure,
    })
    const headline = nodes.headline
    if (headline?.type !== 'text') throw new Error('no headline')
    expect(headline.props.runs.some((run) => run.style.underline)).toBe(false)
    expect(headline.props.runs.some((run) => run.style.color)).toBe(true)
  })

  it.each(EVERY)(
    'sets apart the highlight of %s in the %s style alike at every size it is built at together',
    (id, style) => {
      const set = buildPatterns(id, { style, kit: KIT, content: CONTENT, measure }, CHANNEL_SIZES)
      const ways = set.flatMap(({ nodes }, i) => {
        const headline = nodes.headline
        if (headline?.type !== 'text') return []
        const run = headline.props.runs.find((each) => !('fontSize' in each.style))
        const short = (CHANNEL_SIZES[i]?.height ?? 0) <= 100
        // A short frame, with no room for an underline, sets its highlight plain.
        if (!run) return short ? [] : ['none']
        const ink = headline.props.style.color
        const colour = run.style.color
        if (colour) expect(apart(colour, ink, 1.5, 20)).toBe(true)
        return [JSON.stringify(run.style)]
      })
      expect(new Set(ways).size).toBeLessThanOrEqual(1)
    },
  )

  it('never splits a lead of two words, such as a product’s name, at any size', () => {
    for (const { width, height } of CHANNEL_SIZES) {
      const content = { ...CONTENT, headline: 'Stride Air' }
      const { nodes } = buildPattern('product-badge', { style: 'bold', kit: KIT, content, width, height, measure })
      const headline = nodes.headline
      if (headline?.type === 'text') expect(headline.props.text).toBe(`Stride${KEEP}Air`)
    }
  })
})
