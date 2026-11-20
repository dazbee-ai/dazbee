import { describe, expect, it } from 'vitest'

import { type BrandKit, EMPTY_BRAND_KIT } from '@dazbee/schema'

import { en } from '@/lib/i18n/en.ts'

import { keptLetterSpacing, keptLineHeight, textStyleFonts } from './text-style-fields.ts'

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

  it('lists first a kit font since taken out, as Not set, or a family the catalog lacks', () => {
    expect(textStyleFonts(KIT, ['Inter'], t, { token: 'gone' })[0]).toEqual({
      value: 'kit:gone',
      font: { token: 'gone' },
      label: 'Not set',
    })
    expect(textStyleFonts(KIT, ['Inter'], t, { family: 'Old Face' })[0]?.label).toBe('Old Face')
    expect(textStyleFonts(KIT, ['Inter'], t, { family: 'Inter' })[0]?.label).toBe('Heading · Lora')
  })
})

describe('keptLineHeight', () => {
  it('keeps a line height between half and ten times the size, and none for a field left empty or at 0', () => {
    expect(keptLineHeight(1.25)).toBe(1.25)
    expect(keptLineHeight(0.1)).toBe(0.5)
    expect(keptLineHeight(999)).toBe(10)
    expect(keptLineHeight(undefined)).toBeUndefined()
    expect(keptLineHeight(0)).toBeUndefined()
    expect(keptLineHeight(-2)).toBeUndefined()
  })
})

describe('keptLetterSpacing', () => {
  it('keeps a letter spacing within a thousand either way, and none for a field left empty', () => {
    expect(keptLetterSpacing(-1.5)).toBe(-1.5)
    expect(keptLetterSpacing(99_999)).toBe(1000)
    expect(keptLetterSpacing(-99_999)).toBe(-1000)
    expect(keptLetterSpacing(undefined)).toBe(0)
  })
})
