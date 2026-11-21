import { describe, expect, it } from 'vitest'

import { TextStyle } from '@dazbee/schema'

import { featureOn, OFFERED_FEATURES, shownFeatures, textWithFeature, turnedFeatures } from './font-features.ts'

const offered = (tag: string) => {
  const feature = OFFERED_FEATURES.find((f) => f.tag === tag)
  if (!feature) throw new Error(`${tag} is not offered`)
  return feature
}

describe('shownFeatures', () => {
  const fonts: Record<string, string[]> = { Sans: ['liga', 'tnum', 'ss01'], Serif: ['liga', 'frac'] }
  const has = (family: string) => new Set(fonts[family] ?? [])

  it('shows the features every text’s font has, and small caps, superscript and subscript always, in the order they are offered', () => {
    expect(shownFeatures([{ fontFamily: 'Sans' }], has).map((f) => f.tag)).toEqual([
      'liga',
      'tnum',
      'ss01',
      'smcp',
      'sups',
      'subs',
    ])
    expect(shownFeatures([{ fontFamily: 'Sans' }, { fontFamily: 'Serif' }], has).map((f) => f.tag)).toEqual([
      'liga',
      'smcp',
      'sups',
      'subs',
    ])
    expect(shownFeatures([{ fontFamily: 'Not loaded' }], () => null).map((f) => f.tag)).toEqual([
      'smcp',
      'sups',
      'subs',
    ])
  })

  it('still shows a feature a text has turned away from the fonts’ way, so it can be turned back', () => {
    const turned = [{ fontFamily: 'Serif', features: { tnum: true, calt: true } }]
    expect(shownFeatures(turned, has).map((f) => f.tag)).toEqual(['liga', 'tnum', 'frac', 'smcp', 'sups', 'subs'])
  })
})

describe('turnedFeatures', () => {
  it('turns superscript on with subscript off, and subscript on with superscript off', () => {
    expect(turnedFeatures('sups', true)).toEqual({ sups: true, subs: false })
    expect(turnedFeatures('subs', true)).toEqual({ subs: true, sups: false })
  })

  it('turns any other feature, or either one off, alone', () => {
    expect(turnedFeatures('sups', false)).toEqual({ sups: false })
    expect(turnedFeatures('smcp', true)).toEqual({ smcp: true })
  })
})

describe('textWithFeature', () => {
  const text = {
    style: TextStyle.parse({ fontFamily: 'Sans', fontSize: 20, color: '#000000FF', features: { liga: false } }),
    runs: [
      { start: 0, end: 2, style: { features: { sups: true } } },
      { start: 2, end: 4, style: { color: '#FF0000FF' } },
    ],
  }

  it('turns subscript on in the whole text’s style, and superscript off in a run that has it on', () => {
    const turned = textWithFeature(text, 'subs', true)
    expect(turned.style.features).toEqual({ liga: false, subs: true, sups: false })
    expect(turned.runs).toEqual([{ start: 0, end: 2, style: { features: { sups: false } } }, text.runs[1]])
  })

  it('leaves the runs as they are when turning a feature off', () => {
    const turned = textWithFeature(text, 'sups', false)
    expect(turned.style.features).toEqual({ liga: false, sups: false })
    expect(turned.runs).toEqual(text.runs)
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
