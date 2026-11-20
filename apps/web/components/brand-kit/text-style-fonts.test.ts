import { describe, expect, it } from 'vitest'

import { type BrandKit, EMPTY_BRAND_KIT } from '@dazbee/schema'

import { en } from '@/lib/i18n/en.ts'

import { textStyleFonts } from './text-style-fonts.ts'

const t = en.editor.brandKit
const KIT: BrandKit = {
  ...EMPTY_BRAND_KIT,
  fonts: [
    { token: 'brand-serif', name: 'Brand serif', family: 'Playfair Display' },
    { token: 'heading', name: 'Heading', family: 'Lora' },
  ],
}

describe('textStyleFonts', () => {
  it("offers the kit's font roles, set or not, then the brand's own, then each family", () => {
    expect(textStyleFonts(KIT, ['Inter', 'Lora'], t).map(({ font, label }) => [font, label])).toEqual([
      [{ token: 'heading' }, 'Heading · Lora'],
      [{ token: 'body' }, 'Body · Not set'],
      [{ token: 'brand-serif' }, 'Brand serif · Playfair Display'],
      [{ family: 'Inter' }, 'Inter'],
      [{ family: 'Lora' }, 'Lora'],
    ])
  })

  it('gives each a value of its own, a kit font apart from a family of the same name', () => {
    const values = textStyleFonts(
      { ...KIT, fonts: [{ token: 'inter', name: 'Inter', family: 'Inter' }] },
      ['Inter'],
      t,
    ).map((f) => f.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it('leaves out a font role whose token a colour holds', () => {
    const kit = { ...KIT, colors: [{ token: 'body', name: 'Body', value: '#000000FF' }] }
    expect(textStyleFonts(kit, [], t).map((f) => f.label)).toEqual(['Heading · Lora', 'Brand serif · Playfair Display'])
  })
})
