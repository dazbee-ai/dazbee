import { describe, expect, it } from 'vitest'

import { type BrandKit, brandVariables, EMPTY_BRAND_KIT } from './api.ts'
import {
  brandRoleOf,
  brandRolesOf,
  freeToken,
  inBrandRoleOrder,
  kitIsFull,
  withBrandRole,
  withoutBrandRole,
} from './brand-roles.ts'
import { NO_LETTER_SPACING } from './typography.ts'
import { bindProps } from './variables.ts'

const red = '#E0262BFF'
const cream = '#FFF8E7FF'
/** A kit made before the roles: Primary and Heading by name, two of the brand's own, and a font that took a colour role's token. */
const KIT: BrandKit = {
  ...EMPTY_BRAND_KIT,
  colors: [
    { token: 'sale-red', name: 'Sale red', value: red },
    { token: 'primary', name: 'Primary', value: '#14213DFF' },
    { token: 'cream', name: 'Cream', value: cream },
  ],
  fonts: [
    { token: 'heading', name: 'Heading', family: 'Inter' },
    { token: 'text', name: 'Text', family: 'Noto Sans' },
  ],
}

describe('BRAND_ROLES', () => {
  it("draws a layer bound to a role in each brand's own value", () => {
    const fills = [{ type: 'solid', color: '#000000FF' }]
    const bindings = { fill: 'brand:primary' } as const
    const other = withBrandRole(withBrandRole(EMPTY_BRAND_KIT, 'color', 'primary', red), 'font', 'heading', 'Lora')
    expect(bindProps('box', { fills }, bindings, brandVariables(KIT)).fills[0]?.color).toBe('#14213DFF')
    expect(bindProps('box', { fills }, bindings, brandVariables(other)).fills[0]?.color).toBe(red)
    const style = { fontFamily: 'Noto Sans', color: red }
    const heading = { fontFamily: 'brand:heading' } as const
    expect(bindProps('text', { style }, heading, brandVariables(other)).style.fontFamily).toBe('Lora')
  })
})

describe('brandRoleOf', () => {
  it('finds a role by its token, for its own kind only', () => {
    expect(brandRoleOf('color', 'primary')).toBe('primary')
    expect(brandRoleOf('color', 'text')).toBe('text')
    expect(brandRoleOf('font', 'heading')).toBe('heading')
    expect(brandRoleOf('font', 'primary')).toBeUndefined()
    expect(brandRoleOf('color', 'body')).toBeUndefined()
    expect(brandRoleOf('color', 'sale-red')).toBeUndefined()
  })
})

describe('inBrandRoleOrder', () => {
  it("puts the roles first, in role order, then the brand's own as the kit holds them", () => {
    const kit = { ...KIT, colors: [...KIT.colors, { token: 'accent', name: 'Accent', value: red }] }
    expect(inBrandRoleOrder('color', kit.colors).map((c) => c.token)).toEqual([
      'primary',
      'accent',
      'sale-red',
      'cream',
    ])
  })

  it("counts a role's token only for its own kind", () => {
    const fonts = [...KIT.fonts].reverse()
    expect(inBrandRoleOrder('font', fonts).map((f) => f.token)).toEqual(['heading', 'text'])
    const colors = [{ token: 'heading', name: 'Heading', value: red }, ...KIT.colors]
    expect(inBrandRoleOrder('color', colors).map((c) => c.token)).toEqual(['primary', 'heading', 'sale-red', 'cream'])
  })
})

describe('brandRolesOf', () => {
  it("lists every role of a kind, each with the kit's entry that fills it or none", () => {
    const kit = { ...KIT, fonts: KIT.fonts.filter((f) => f.token !== 'text') }
    expect(brandRolesOf(kit, 'color').map(({ role, entry }) => [role, entry?.value])).toEqual([
      ['primary', '#14213DFF'],
      ['secondary', undefined],
      ['accent', undefined],
      ['background', undefined],
      ['text', undefined],
    ])
    expect(brandRolesOf(kit, 'font').map(({ role, entry }) => [role, entry?.family])).toEqual([
      ['heading', 'Inter'],
      ['body', undefined],
    ])
  })

  it('leaves out a role whose token the other kind holds', () => {
    const kit = { ...KIT, colors: [...KIT.colors, { token: 'body', name: 'Body', value: cream }] }
    expect(brandRolesOf(kit, 'font').map((r) => r.role)).toEqual(['heading'])
    expect(brandRolesOf(KIT, 'color').map((r) => r.role)).not.toContain('text')
  })
})

describe('withBrandRole', () => {
  it("sets a role that isn't set, named as the role, keeping the rest", () => {
    const kit = withBrandRole(KIT, 'color', 'accent', red)
    expect(kit.colors).toEqual([...KIT.colors, { token: 'accent', name: 'Accent', value: red }])
    expect(kit.fonts).toBe(KIT.fonts)
    expect(withBrandRole(KIT, 'font', 'body', 'Lora').fonts).toEqual([
      ...KIT.fonts,
      { token: 'body', name: 'Body', family: 'Lora' },
    ])
  })

  it('changes a role that is set where it is, keeping its name', () => {
    const kit = withBrandRole(
      { ...KIT, colors: KIT.colors.map((c) => ({ ...c, name: 'Navy' })) },
      'color',
      'primary',
      red,
    )
    expect(kit.colors[1]).toEqual({ token: 'primary', name: 'Navy', value: red })
    expect(withBrandRole(KIT, 'font', 'heading', 'Lora').fonts[0]).toEqual({
      token: 'heading',
      name: 'Heading',
      family: 'Lora',
    })
  })

  it("leaves a full kit as it is for a role that isn't set, and changes one that is", () => {
    const fonts = Array.from({ length: 7 }, (_, i) => ({ token: `font-${i}`, name: `Font ${i}`, family: 'Inter' }))
    const full = { ...KIT, fonts: [...fonts, { token: 'heading', name: 'Heading', family: 'Inter' }] }
    expect(kitIsFull(full, 'font')).toBe(true)
    expect(kitIsFull(full, 'color')).toBe(false)
    expect(withBrandRole(full, 'font', 'body', 'Lora')).toBe(full)
    expect(withBrandRole(full, 'font', 'heading', 'Lora').fonts.at(-1)?.family).toBe('Lora')
  })

  it('leaves the kit as it is for a role the other kind holds, or of the other kind', () => {
    expect(withBrandRole(KIT, 'color', 'text', red)).toBe(KIT)
    expect(withBrandRole(KIT, 'font', 'primary', 'Lora')).toBe(KIT)
  })
})

describe('withoutBrandRole', () => {
  it('takes the role out, keeping the rest', () => {
    expect(withoutBrandRole(KIT, 'color', 'primary').colors.map((c) => c.token)).toEqual(['sale-red', 'cream'])
    expect(withoutBrandRole(KIT, 'font', 'heading').fonts.map((f) => f.token)).toEqual(['text'])
  })

  it('leaves a token of the other kind alone', () => {
    expect(withoutBrandRole(KIT, 'color', 'text')).toBe(KIT)
  })
})

describe('freeToken', () => {
  it('makes a token from a name, after the ones the kit holds', () => {
    expect(freeToken(KIT, 'Colour 3')).toBe('colour-3')
    expect(freeToken(KIT, 'Sale red')).toBe('sale-red-2')
    expect(freeToken(KIT, '  ')).toBe('token')
  })

  it("never gives a role's token, of any kind, set or not", () => {
    expect(freeToken(EMPTY_BRAND_KIT, 'Primary')).toBe('primary-2')
    expect(freeToken(EMPTY_BRAND_KIT, 'Text')).toBe('text-2')
    expect(freeToken(EMPTY_BRAND_KIT, 'Body')).toBe('body-2')
    expect(freeToken(KIT, 'Heading')).toBe('heading-2')
    expect(freeToken(EMPTY_BRAND_KIT, 'Logo')).toBe('logo-2')
  })

  it("never gives a text style's token", () => {
    const style = { token: 'headline', name: 'Headline', font: { token: 'heading' }, fontWeight: 700 }
    const kit: BrandKit = { ...KIT, textStyles: [{ ...style, fontStyle: 'normal', letterSpacing: NO_LETTER_SPACING }] }
    expect(freeToken(kit, 'Headline')).toBe('headline-2')
  })

  it('never gives a token a text style follows, though the kit holds no font with it', () => {
    const style = { token: 'headline', name: 'Headline', font: { token: 'brand-serif' }, fontWeight: 700 }
    const kit: BrandKit = { ...KIT, textStyles: [{ ...style, fontStyle: 'normal', letterSpacing: NO_LETTER_SPACING }] }
    expect(freeToken(kit, 'Brand serif')).toBe('brand-serif-2')
  })
})
