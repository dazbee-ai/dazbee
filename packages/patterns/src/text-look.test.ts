import { describe, expect, it } from 'vitest'

import { EMPTY_BRAND_KIT, type TextProps } from '@dazbee/schema'

import { frameRoom } from './frame-shape.ts'
import { paletteOf } from './palette.ts'
import { STYLES } from './styles.ts'
import { lookStyle } from './text-look.ts'
import type { Measure } from './types.ts'

/** A measure whose every character is `share` of the size wide, in one line. */
const setAt =
  (share: number): Measure =>
  (props: TextProps) => ({ width: props.text.length * props.style.fontSize * share, height: props.style.fontSize })

/** The minimal style, whose headline takes negative tracking, with a kit that sets its own heading font or none. */
const settingOf = (measure: Measure, brand: boolean) => {
  const kit = brand
    ? { ...EMPTY_BRAND_KIT, fonts: [{ token: 'heading' as const, name: 'Heading', family: 'Brand Display' }] }
    : EMPTY_BRAND_KIT
  return { style: STYLES.minimal, palette: paletteOf(kit, STYLES.minimal), frame: frameRoom(1080, 1080, 0.09), measure }
}

describe('a text’s look', () => {
  it('adds none of the style’s negative tracking to a brand’s already tight font, and all of it to one as wide as the style’s own', () => {
    const tracking = (share: number, brand: boolean) =>
      lookStyle(settingOf(setAt(share), brand), STYLES.minimal.headline, 100).letterSpacing.value
    expect(STYLES.minimal.headline.tracking).toBeLessThan(0)
    // A condensed display face, its letters already close.
    expect(tracking(0.44, true)).toBe(0)
    // A face as wide as the style's own takes the style's tracking.
    expect(tracking(0.56, true)).toBe(STYLES.minimal.headline.tracking)
    // In between, a share of it.
    const between = tracking(0.5, true)
    expect(between).toBeLessThan(0)
    expect(between).toBeGreaterThan(STYLES.minimal.headline.tracking)
    // The style's own font, whose spacing the tracking was set for, keeps it however it measures.
    expect(tracking(0.44, false)).toBe(STYLES.minimal.headline.tracking)
  })
})
