import { describe, expect, it } from 'vitest'

import { RunStyle, TextStyle } from './layers.ts'
import { Features, LetterSpacing, letterSpacingPx, withRunStyle } from './typography.ts'

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

describe('letterSpacingPx', () => {
  it('gives pixels as they are, and a percentage of the font size it is set at', () => {
    expect(letterSpacingPx({ unit: 'px', value: 1.5 }, 40)).toBe(1.5)
    expect(letterSpacingPx({ unit: 'percent', value: 2 }, 50)).toBe(1)
    expect(letterSpacingPx({ unit: 'percent', value: -10 }, 30)).toBe(-3)
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
})
