import { describe, expect, it } from 'vitest'

import { shownSpacing, spacingIn, typedUnit } from './letter-spacing.ts'

const px = (value: number) => ({ unit: 'px' as const, value })
const percent = (value: number) => ({ unit: 'percent' as const, value })

describe('typedUnit', () => {
  it('reads the unit typed after a value: a percent sign or px, whatever its case and spaces', () => {
    expect(typedUnit('2%')).toBe('percent')
    expect(typedUnit(' 1.5 px ')).toBe('px')
    expect(typedUnit('+1PX')).toBe('px')
    expect(typedUnit('*2 %')).toBe('percent')
  })

  it('reads none for a bare value, or a unit letter spacing does not take', () => {
    expect(typedUnit('2')).toBeNull()
    expect(typedUnit('-0.5')).toBeNull()
    expect(typedUnit('2em')).toBeNull()
    expect(typedUnit('')).toBeNull()
  })
})

describe('spacingIn', () => {
  it('gives letter spacing in another unit at the font size it is set at, the same room between letters', () => {
    expect(spacingIn(px(2), 'percent', 40)).toEqual(percent(5))
    expect(spacingIn(percent(10), 'px', 32)).toEqual(px(3.2))
    expect(spacingIn(px(2), 'px', 40)).toEqual(px(2))
  })
})

describe('shownSpacing', () => {
  it('shows the unit and value the styles share, each mixed where they differ, none as 0%', () => {
    expect(shownSpacing([{ letterSpacing: percent(2) }, { letterSpacing: percent(2) }])).toEqual({
      unit: 'percent',
      value: 2,
    })
    expect(shownSpacing([{ letterSpacing: px(1) }, { letterSpacing: px(3) }])).toEqual({ unit: 'px', value: 'mixed' })
    expect(shownSpacing([{ letterSpacing: px(1) }, { letterSpacing: percent(1) }])).toEqual({
      unit: 'mixed',
      value: 'mixed',
    })
    expect(shownSpacing([{}])).toEqual({ unit: 'percent', value: 0 })
  })
})
