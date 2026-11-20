import { describe, expect, it } from 'vitest'

import { type BrandKit, brandVariables, EMPTY_BRAND_KIT } from './api.ts'
import { brandRoleOf, freeToken, inRoleOrder, roleSlots, withoutRole, withRole } from './brand-roles.ts'
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
    const other = withRole(withRole(EMPTY_BRAND_KIT, 'color', 'primary', red), 'font', 'heading', 'Lora')
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

describe('inRoleOrder', () => {
  it("puts the roles first, in role order, then the brand's own as the kit holds them", () => {
    const kit = { ...KIT, colors: [...KIT.colors, { token: 'accent', name: 'Accent', value: red }] }
    expect(inRoleOrder('color', kit.colors).map((c) => c.token)).toEqual(['primary', 'accent', 'sale-red', 'cream'])
  })

  it("counts a role's token only for its own kind", () => {
    const fonts = [...KIT.fonts].reverse()
    expect(inRoleOrder('font', fonts).map((f) => f.token)).toEqual(['heading', 'text'])
    const colors = [{ token: 'heading', name: 'Heading', value: red }, ...KIT.colors]
    expect(inRoleOrder('color', colors).map((c) => c.token)).toEqual(['primary', 'heading', 'sale-red', 'cream'])
  })
})

describe('roleSlots', () => {
  it("lists every role of a kind, each with the kit's entry that fills it or none", () => {
    const kit = { ...KIT, fonts: KIT.fonts.filter((f) => f.token !== 'text') }
    expect(roleSlots(kit, 'color').map(({ role, entry }) => [role, entry?.value])).toEqual([
      ['primary', '#14213DFF'],
      ['secondary', undefined],
      ['accent', undefined],
      ['background', undefined],
      ['text', undefined],
    ])
    expect(roleSlots(kit, 'font').map(({ role, entry }) => [role, entry?.family])).toEqual([
      ['heading', 'Inter'],
      ['body', undefined],
    ])
  })

  it('leaves out a role whose token the other kind holds', () => {
    const kit = { ...KIT, colors: [...KIT.colors, { token: 'body', name: 'Body', value: cream }] }
    expect(roleSlots(kit, 'font').map((slot) => slot.role)).toEqual(['heading'])
    expect(roleSlots(KIT, 'color').map((slot) => slot.role)).not.toContain('text')
  })
})

describe('withRole', () => {
  it("sets a role that isn't set, named as the role, keeping the rest", () => {
    const kit = withRole(KIT, 'color', 'accent', red)
    expect(kit.colors).toEqual([...KIT.colors, { token: 'accent', name: 'Accent', value: red }])
    expect(kit.fonts).toBe(KIT.fonts)
    expect(withRole(KIT, 'font', 'body', 'Lora').fonts).toEqual([
      ...KIT.fonts,
      { token: 'body', name: 'Body', family: 'Lora' },
    ])
  })

  it('changes a role that is set where it is, keeping its name', () => {
    const kit = withRole({ ...KIT, colors: KIT.colors.map((c) => ({ ...c, name: 'Navy' })) }, 'color', 'primary', red)
    expect(kit.colors[1]).toEqual({ token: 'primary', name: 'Navy', value: red })
    expect(withRole(KIT, 'font', 'heading', 'Lora').fonts[0]).toEqual({
      token: 'heading',
      name: 'Heading',
      family: 'Lora',
    })
  })

  it('leaves the kit as it is for a role the other kind holds, or of the other kind', () => {
    expect(withRole(KIT, 'color', 'text', red)).toBe(KIT)
    expect(withRole(KIT, 'font', 'primary', 'Lora')).toBe(KIT)
  })
})

describe('withoutRole', () => {
  it('takes the role out, keeping the rest', () => {
    expect(withoutRole(KIT, 'color', 'primary').colors.map((c) => c.token)).toEqual(['sale-red', 'cream'])
    expect(withoutRole(KIT, 'font', 'heading').fonts.map((f) => f.token)).toEqual(['text'])
  })

  it('leaves a token of the other kind alone', () => {
    expect(withoutRole(KIT, 'color', 'text')).toBe(KIT)
  })
})

describe('freeToken', () => {
  it('makes a token from a name, after the ones the kit holds', () => {
    expect(freeToken(KIT, 'Colour 3')).toBe('colour-3')
    expect(freeToken(KIT, 'Sale red')).toBe('sale-red-2')
    expect(freeToken(KIT, '  ')).toBe('token')
  })

  it("never gives a role's token, of either kind, set or not", () => {
    expect(freeToken(EMPTY_BRAND_KIT, 'Primary')).toBe('primary-2')
    expect(freeToken(EMPTY_BRAND_KIT, 'Text')).toBe('text-2')
    expect(freeToken(EMPTY_BRAND_KIT, 'Body')).toBe('body-2')
    expect(freeToken(KIT, 'Heading')).toBe('heading-2')
  })
})
