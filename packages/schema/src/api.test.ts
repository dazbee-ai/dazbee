import { describe, expect, it } from 'vitest'

import { brandVariables, EMPTY_BRAND_KIT, faceWeights, MEMBER_ROLES, roleManages, roleWrites } from './api.ts'

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

  it('keeps a colour or font of the kit that holds the logo’s token', () => {
    const own = { ...kit, colors: [...kit.colors, { token: 'logo', name: 'Logo', value: '#E0262BFF' }] }
    expect(brandVariables(own, { id: 'logo-1', contentType: 'image/png' })['brand:logo']).toBe('#E0262BFF')
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
