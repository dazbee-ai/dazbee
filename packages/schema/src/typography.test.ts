import { describe, expect, it } from 'vitest'

import { RunStyle, TextStyle } from './layers.ts'
import { Features, inColour, LetterSpacing, letterSpacingPx, shownGradient, withRunStyle } from './typography.ts'

const sweep = {
  type: 'linear' as const,
  from: { x: 0, y: 0 },
  to: { x: 1, y: 0 },
  stops: [
    { offset: 0, color: '#FF2E7EFF' },
    { offset: 1, color: '#3D6BFFFF' },
  ],
}

describe('LetterSpacing', () => {
  it('takes pixels or a percentage of the font size, and nothing else', () => {
    expect(LetterSpacing.parse({ unit: 'px', value: -1.5 })).toEqual({ unit: 'px', value: -1.5 })
    expect(LetterSpacing.parse({ unit: 'percent', value: 2 })).toEqual({ unit: 'percent', value: 2 })
    expect(LetterSpacing.safeParse(2).success).toBe(false)
    expect(LetterSpacing.safeParse({ unit: 'em', value: 2 }).success).toBe(false)
  })

  it('is a percentage of 0 in a text style that sets none', () => {
    const style = TextStyle.parse({ fontFamily: 'Inter', fontSize: 20, color: '#000000FF' })
    expect(style.letterSpacing).toEqual({ unit: 'percent', value: 0 })
  })
})

describe('Features', () => {
  it('takes four-letter tags turned on or off, in a style and in a run', () => {
    expect(Features.parse({ liga: false, tnum: true, ss01: true })).toEqual({ liga: false, tnum: true, ss01: true })
    expect(RunStyle.parse({ features: { smcp: true } })).toEqual({ features: { smcp: true } })
  })

  it('refuses a tag that is not four printable ASCII characters, naming it', () => {
    for (const tag of ['lig', 'ligat', 'ligä', 'li\u0000a', '']) {
      const parsed = Features.safeParse({ [tag]: true })
      expect(parsed.success).toBe(false)
    }
    const issues = RunStyle.safeParse({ features: { ligature: true } }).error?.issues ?? []
    expect(issues.length).toBeGreaterThan(0)
    expect(issues.every((i) => i.path[0] === 'features')).toBe(true)
  })
})

describe('textStyleFields', () => {
  it('takes a gradient that is linear, radial or angular, in a style and in a run', () => {
    const style = TextStyle.parse({ fontFamily: 'Inter', fontSize: 20, color: '#000000FF', gradient: sweep })
    expect(style.gradient).toEqual(sweep)
    const ring = { type: 'radial', center: { x: 0.5, y: 0.5 }, radius: 0.5, stops: sweep.stops }
    expect(RunStyle.parse({ gradient: ring })).toEqual({ gradient: ring })
    const turn = { type: 'angular', center: { x: 0.5, y: 0.5 }, angle: 0, stops: sweep.stops }
    expect(RunStyle.parse({ gradient: turn })).toEqual({ gradient: turn })
  })

  it('refuses a solid or an image, which are not gradients', () => {
    expect(RunStyle.safeParse({ gradient: { type: 'solid', color: '#000000FF' } }).success).toBe(false)
    const image = { type: 'image', assetId: 'a', fit: 'fill', opacity: 1 }
    expect(RunStyle.safeParse({ gradient: image }).success).toBe(false)
  })

  it('takes an outline over the letters unless it says under', () => {
    expect(RunStyle.parse({ outline: { width: 2, color: '#000000FF' } }).outline?.under).toBeUndefined()
    expect(RunStyle.parse({ outline: { width: 2, color: '#000000FF', under: true } }).outline?.under).toBe(true)
  })
})

describe('letterSpacingPx', () => {
  it('gives pixels as they are, and a percentage of the font size it is set at', () => {
    expect(letterSpacingPx({ unit: 'px', value: 1.5 }, 40)).toBe(1.5)
    expect(letterSpacingPx({ unit: 'percent', value: 2 }, 50)).toBe(1)
    expect(letterSpacingPx({ unit: 'percent', value: -10 }, 30)).toBe(-3)
  })
})

describe('shownGradient', () => {
  it('gives a style’s gradient while it shows, and none when it is hidden or left out', () => {
    expect(shownGradient({ gradient: sweep })).toBe(sweep)
    expect(shownGradient({ gradient: { ...sweep, visible: false } })).toBeNull()
    expect(shownGradient({})).toBeNull()
  })
})

describe('inColour', () => {
  it('sets the colour and takes the gradient off', () => {
    expect(inColour({ color: '#000000FF', gradient: sweep, fontSize: 20 }, '#FF0000FF')).toEqual({
      color: '#FF0000FF',
      fontSize: 20,
    })
  })
})

describe('withRunStyle', () => {
  it('puts each key a run sets over the style, features tag by tag', () => {
    const base: RunStyle = { fontSize: 20, features: { liga: false, tnum: true } }
    expect(withRunStyle(base, { fontSize: 30, features: { tnum: false, zero: true } })).toEqual({
      fontSize: 30,
      features: { liga: false, tnum: false, zero: true },
    })
    expect(withRunStyle(base, { fontSize: 30 })).toEqual({ fontSize: 30, features: { liga: false, tnum: true } })
    expect(withRunStyle<RunStyle>({ fontSize: 20 }, { features: { smcp: true } })).toEqual({
      fontSize: 20,
      features: { smcp: true },
    })
  })

  it('takes a colour and a gradient as one paint: a run that sets either replaces both', () => {
    const red = '#FF0000FF'
    const blue = '#0000FFFF'
    expect(withRunStyle<RunStyle>({ color: blue, gradient: sweep }, { color: red })).toEqual({ color: red })
    expect(withRunStyle<RunStyle>({ color: blue }, { gradient: sweep })).toEqual({ color: blue, gradient: sweep })
    expect(withRunStyle<RunStyle>({ color: blue, gradient: sweep }, { fontSize: 30 })).toEqual({
      color: blue,
      gradient: sweep,
      fontSize: 30,
    })
  })
})
