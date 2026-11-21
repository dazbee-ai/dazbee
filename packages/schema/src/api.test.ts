import { describe, expect, it } from 'vitest'

import {
  BrandKit,
  brandVariables,
  EMPTY_BRAND_KIT,
  faceWeights,
  MEMBER_ROLES,
  roleManages,
  roleWrites,
  SaveBrandKit,
} from './api.ts'

/** A kit as the API stored it before kits held text styles. */
const KIT_BEFORE = {
  colors: [{ token: 'primary', name: 'Primary', value: '#14213DFF' }],
  fonts: [{ token: 'heading', name: 'Heading', family: 'Lora' }],
  logoAssetId: null,
  voice: '',
}
const HEADLINE = {
  token: 'headline',
  name: 'Headline',
  font: { token: 'heading' },
  fontWeight: 700,
  fontStyle: 'normal',
  lineHeight: 1.1,
  letterSpacing: { unit: 'percent', value: -1 },
}

describe('BrandKit', () => {
  it('reads a kit saved before text styles as one with none', () => {
    expect(BrandKit.parse(KIT_BEFORE).textStyles).toEqual([])
  })

  it('holds text styles set in a kit font or a family of their own, up to twelve', () => {
    const body = { ...HEADLINE, token: 'body-copy', name: 'Body copy', font: { family: 'Inter' }, textCase: 'upper' }
    expect(BrandKit.parse({ ...KIT_BEFORE, textStyles: [HEADLINE, body] }).textStyles).toEqual([HEADLINE, body])
    const many = Array.from({ length: 13 }, (_, i) => ({ ...HEADLINE, token: `style-${i + 1}` }))
    expect(BrandKit.safeParse({ ...KIT_BEFORE, textStyles: many.slice(0, 12) }).success).toBe(true)
    expect(BrandKit.safeParse({ ...KIT_BEFORE, textStyles: many }).success).toBe(false)
  })

  it('refuses a text style whose token names a colour, a font, another style, a brand role or the logo', () => {
    for (const token of ['primary', 'heading', 'body', 'accent', 'logo'])
      expect(BrandKit.safeParse({ ...KIT_BEFORE, textStyles: [{ ...HEADLINE, token }] }).success, token).toBe(false)
    expect(BrandKit.safeParse({ ...KIT_BEFORE, textStyles: [HEADLINE, HEADLINE] }).success).toBe(false)
  })

  it('refuses a text style that follows a colour, a colour role, another style or the logo', () => {
    const red = { token: 'red', name: 'Red', value: '#E0262BFF' }
    const kit = { ...KIT_BEFORE, colors: [...KIT_BEFORE.colors, red] }
    const subhead = { ...HEADLINE, token: 'subhead', name: 'Subhead' }
    for (const token of ['red', 'primary', 'text', 'subhead', 'logo'])
      expect(
        BrandKit.safeParse({ ...kit, textStyles: [{ ...HEADLINE, font: { token } }, subhead] }).success,
        token,
      ).toBe(false)
  })

  it('takes a text style that follows a font role or a kit font, set or not', () => {
    for (const token of ['heading', 'body', 'brand-serif'])
      expect(BrandKit.safeParse({ ...KIT_BEFORE, textStyles: [{ ...HEADLINE, font: { token } }] }).success, token).toBe(
        true,
      )
  })

  it('keeps no size, and refuses a font that is neither a token nor a family', () => {
    expect(BrandKit.parse({ ...KIT_BEFORE, textStyles: [{ ...HEADLINE, fontSize: 40 }] }).textStyles).toEqual([
      HEADLINE,
    ])
    expect(BrandKit.safeParse({ ...KIT_BEFORE, textStyles: [{ ...HEADLINE, font: {} }] }).success).toBe(false)
    expect(BrandKit.safeParse({ ...KIT_BEFORE, textStyles: [{ ...HEADLINE, font: 'Inter' }] }).success).toBe(false)
  })
})

describe('SaveBrandKit', () => {
  it('leaves the text styles out when a save from a tab built before has none', () => {
    expect(SaveBrandKit.parse(KIT_BEFORE).textStyles).toBeUndefined()
    expect(SaveBrandKit.parse({ ...KIT_BEFORE, textStyles: [] }).textStyles).toEqual([])
  })

  it('checks tokens as the kit does', () => {
    expect(SaveBrandKit.safeParse({ ...KIT_BEFORE, textStyles: [{ ...HEADLINE, token: 'primary' }] }).success).toBe(
      false,
    )
  })
})

describe('brandVariables', () => {
  const kit = {
    ...EMPTY_BRAND_KIT,
    colors: [{ token: 'primary', name: 'Primary', value: '#14213DFF' }],
    fonts: [{ token: 'heading', name: 'Heading', family: 'Lora' }],
    logoAssetId: 'logo-1',
  }

  it('gives each colour and font by its token, and the logo as brand:logo when it is an image', () => {
    expect(brandVariables(kit, { id: 'logo-1', contentType: 'image/png' })).toEqual({
      'brand:primary': '#14213DFF',
      'brand:heading': 'Lora',
      'brand:logo': 'logo-1',
    })
  })

  it('gives no brand:logo for an SVG logo, a logo it is not told of, or a kit without one', () => {
    const without = { 'brand:primary': '#14213DFF', 'brand:heading': 'Lora' }
    expect(brandVariables(kit, { id: 'logo-1', contentType: 'image/svg+xml' })).toEqual(without)
    expect(brandVariables(kit)).toEqual(without)
    expect(brandVariables(kit, { id: 'other', contentType: 'image/png' })).toEqual(without)
    expect(brandVariables({ ...kit, logoAssetId: null }, { id: 'logo-1', contentType: 'image/png' })).toEqual(without)
  })

  it('gives each text style as its look, in the family of the kit font it follows or its own', () => {
    const styled = BrandKit.parse({
      ...kit,
      fonts: [...kit.fonts, { token: 'script', name: 'Script', family: 'Pacifico' }],
      textStyles: [
        { ...HEADLINE, textCase: 'upper' },
        { ...HEADLINE, token: 'quote', name: 'Quote', font: { token: 'script' }, lineHeight: undefined },
        { ...HEADLINE, token: 'small', name: 'Small', font: { family: 'Inter' }, fontStyle: 'italic' },
        { ...HEADLINE, token: 'body-text', name: 'Body', font: { token: 'body' } },
      ],
    })
    const look = { fontWeight: 700, letterSpacing: { unit: 'percent', value: -1 } }
    expect(brandVariables(styled)).toEqual({
      'brand:primary': '#14213DFF',
      'brand:heading': 'Lora',
      'brand:script': 'Pacifico',
      'brand:headline': { ...look, fontFamily: 'Lora', fontStyle: 'normal', lineHeight: 1.1, textCase: 'upper' },
      'brand:quote': { ...look, fontFamily: 'Pacifico', fontStyle: 'normal' },
      'brand:small': { ...look, fontFamily: 'Inter', fontStyle: 'italic', lineHeight: 1.1 },
      // Body is not set: the look keeps each text's own family.
      'brand:body-text': { ...look, fontStyle: 'normal', lineHeight: 1.1 },
    })
  })

  it('gives the logo its token even where the kit holds a colour or font with it', () => {
    const own = { ...kit, colors: [...kit.colors, { token: 'logo', name: 'Logo', value: '#E0262BFF' }] }
    expect(brandVariables(own, { id: 'logo-1', contentType: 'image/png' })['brand:logo']).toBe('logo-1')
  })
})

describe('roleWrites', () => {
  it('lets an Owner, Admin or Editor write, and a Reviewer only read', () => {
    expect(MEMBER_ROLES.map((role) => [role, roleWrites(role)])).toEqual([
      ['owner', true],
      ['admin', true],
      ['editor', true],
      ['reviewer', false],
    ])
  })
})

describe('roleManages', () => {
  it('lets an Owner or Admin manage the workspace, and no one else', () => {
    expect(MEMBER_ROLES.map((role) => [role, roleManages(role)])).toEqual([
      ['owner', true],
      ['admin', true],
      ['editor', false],
      ['reviewer', false],
    ])
  })
})

describe('faceWeights', () => {
  it('gives a face of one weight that weight', () => {
    expect(faceWeights({ weight: 700 })).toEqual([700])
  })

  it('gives a variable face the hundreds in its range, with its ends and its default weight', () => {
    expect(faceWeights({ weight: 400, weights: { min: 100, max: 900 } })).toEqual([
      100, 200, 300, 400, 500, 600, 700, 800, 900,
    ])
    expect(faceWeights({ weight: 350, weights: { min: 250, max: 750 } })).toEqual([
      250, 300, 350, 400, 500, 600, 700, 750,
    ])
  })
})
