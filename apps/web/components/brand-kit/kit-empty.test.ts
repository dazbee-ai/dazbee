import { describe, expect, it } from 'vitest'

import { EMPTY_BRAND_KIT, newBrandTextStyle } from '@dazbee/schema'

import { kitIsEmpty } from './kit-empty.ts'

describe('kitIsEmpty', () => {
  it('is true for a kit with no colours, fonts, text styles, logo or voice', () => {
    expect(kitIsEmpty(EMPTY_BRAND_KIT)).toBe(true)
    expect(kitIsEmpty({ ...EMPTY_BRAND_KIT, voice: '  \n' })).toBe(true)
  })

  it('is false once the kit holds any one of them', () => {
    expect(kitIsEmpty({ ...EMPTY_BRAND_KIT, colors: [{ token: 'primary', name: 'Primary', value: '#ff0000' }] })).toBe(
      false,
    )
    expect(kitIsEmpty({ ...EMPTY_BRAND_KIT, fonts: [{ token: 'heading', name: 'Heading', family: 'Figtree' }] })).toBe(
      false,
    )
    expect(kitIsEmpty({ ...EMPTY_BRAND_KIT, logoAssetId: '0198c0de-0000-7000-8000-000000000001' })).toBe(false)
    expect(kitIsEmpty({ ...EMPTY_BRAND_KIT, voice: 'Warm and plain.' })).toBe(false)
    const headline = newBrandTextStyle(EMPTY_BRAND_KIT, () => 'Headline')
    expect(kitIsEmpty({ ...EMPTY_BRAND_KIT, textStyles: [headline] })).toBe(false)
  })
})
