import { describe, expect, it } from 'vitest'

import { type BrandKit, EMPTY_BRAND_KIT } from './api.ts'
import { type BrandTextStyle, brandTextStyleFamily, newBrandTextStyle, withoutKitFont } from './brand-text-styles.ts'

/** Names the form gives each new style, as the English catalog does. */
const ENGLISH = (preset: string | null, n: number) =>
  preset ? `${preset[0]?.toUpperCase()}${preset.slice(1)}` : `Style ${n}`

const KIT: BrandKit = {
  ...EMPTY_BRAND_KIT,
  fonts: [
    { token: 'heading', name: 'Heading', family: 'Lora' },
    { token: 'brand-serif', name: 'Brand serif', family: 'Playfair Display' },
  ],
}

/** Adds `count` new styles to `kit`, one after another, as the form's Add does. */
function added(kit: BrandKit, count: number): BrandKit {
  let next = kit
  for (let i = 0; i < count; i++) next = { ...next, textStyles: [...next.textStyles, newBrandTextStyle(next, ENGLISH)] }
  return next
}

describe('newBrandTextStyle', () => {
  it('offers Headline, Subhead and Body first, set in the Heading and Body roles', () => {
    expect(added(KIT, 3).textStyles).toEqual([
      {
        token: 'headline',
        name: 'Headline',
        font: { token: 'heading' },
        fontWeight: 700,
        fontStyle: 'normal',
        lineHeight: 1.1,
        letterSpacing: { unit: 'percent', value: -1 },
      },
      {
        token: 'subhead',
        name: 'Subhead',
        font: { token: 'heading' },
        fontWeight: 600,
        fontStyle: 'normal',
        lineHeight: 1.25,
        letterSpacing: { unit: 'percent', value: 0 },
      },
      {
        token: 'body-text',
        name: 'Body',
        font: { token: 'body' },
        fontWeight: 400,
        fontStyle: 'normal',
        lineHeight: 1.4,
        letterSpacing: { unit: 'percent', value: 0 },
      },
    ])
  })

  it("then adds styles in Body's look, numbered, each with a token no one holds", () => {
    const kit = added(KIT, 5)
    expect(kit.textStyles.slice(3).map((s) => [s.token, s.name, s.font, s.fontWeight])).toEqual([
      ['style-4', 'Style 4', { token: 'body' }, 400],
      ['style-5', 'Style 5', { token: 'body' }, 400],
    ])
  })

  it('offers a first name again once its style is gone, and skips one whose token the kit holds', () => {
    const kit = added(KIT, 3)
    const withoutHeadline = { ...kit, textStyles: kit.textStyles.filter((s) => s.token !== 'headline') }
    expect(newBrandTextStyle(withoutHeadline, ENGLISH).name).toBe('Headline')
    const red = { token: 'headline', name: 'Headline red', value: '#E0262BFF' }
    expect(newBrandTextStyle({ ...KIT, colors: [red] }, ENGLISH).name).toBe('Subhead')
  })
})

describe('brandTextStyleFamily', () => {
  const style = (font: BrandTextStyle['font']): BrandTextStyle => ({ ...newBrandTextStyle(KIT, ENGLISH), font })

  it("gives the family of the kit's font the style follows, or the style's own", () => {
    expect(brandTextStyleFamily(KIT, style({ token: 'heading' }))).toBe('Lora')
    expect(brandTextStyleFamily(KIT, style({ token: 'brand-serif' }))).toBe('Playfair Display')
    expect(brandTextStyleFamily(KIT, style({ family: 'Inter' }))).toBe('Inter')
  })

  it('gives none for a font the kit has not set', () => {
    expect(brandTextStyleFamily(KIT, style({ token: 'body' }))).toBeUndefined()
  })
})

describe('withoutKitFont', () => {
  it("takes a font of the brand's own out, and sets the styles that follow it in its family", () => {
    const kit = added(KIT, 1)
    const following = { ...kit, textStyles: kit.textStyles.map((s) => ({ ...s, font: { token: 'brand-serif' } })) }
    const next = withoutKitFont(following, 'brand-serif')
    expect(next.fonts.map((f) => f.token)).toEqual(['heading'])
    expect(next.textStyles.map((s) => s.font)).toEqual([{ family: 'Playfair Display' }])
  })

  it('leaves styles that follow a font role following it, set or not', () => {
    const kit = added(KIT, 1)
    expect(withoutKitFont(kit, 'heading').textStyles.map((s) => s.font)).toEqual([{ token: 'heading' }])
  })
})
