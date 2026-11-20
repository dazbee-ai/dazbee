import { describe, expect, it } from 'vitest'

import { featureOn, OFFERED_FEATURES, shownFeatures } from './font-features.ts'

const offered = (tag: string) => {
  const feature = OFFERED_FEATURES.find((f) => f.tag === tag)
  if (!feature) throw new Error(`${tag} is not offered`)
  return feature
}

describe('shownFeatures', () => {
  const fonts: Record<string, string[]> = { Sans: ['liga', 'tnum', 'ss01'], Serif: ['liga', 'frac'] }
  const has = (family: string) => new Set(fonts[family] ?? [])

  it('shows the features every text’s font has, and small caps always, in the order they are offered', () => {
    expect(shownFeatures([{ fontFamily: 'Sans' }], has).map((f) => f.tag)).toEqual(['liga', 'tnum', 'ss01', 'smcp'])
    expect(shownFeatures([{ fontFamily: 'Sans' }, { fontFamily: 'Serif' }], has).map((f) => f.tag)).toEqual([
      'liga',
      'smcp',
    ])
    expect(shownFeatures([{ fontFamily: 'Not loaded' }], () => null).map((f) => f.tag)).toEqual(['smcp'])
  })

  it('still shows a feature a text has turned away from the fonts’ way, so it can be turned back', () => {
    const turned = [{ fontFamily: 'Serif', features: { tnum: true, calt: true } }]
    expect(shownFeatures(turned, has).map((f) => f.tag)).toEqual(['liga', 'tnum', 'frac', 'smcp'])
  })
})

describe('featureOn', () => {
  it('reads a feature on, off or mixed, one a style doesn’t set being as fonts have it', () => {
    expect(featureOn([{}, { features: { liga: true } }], offered('liga'))).toBe(true)
    expect(featureOn([{}, { features: { liga: false } }], offered('liga'))).toBe('mixed')
    expect(featureOn([{}, {}], offered('tnum'))).toBe(false)
    expect(featureOn([{ features: { tnum: true } }], offered('tnum'))).toBe(true)
  })
})
