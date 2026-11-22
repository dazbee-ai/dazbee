import { describe, expect, it } from 'vitest'

import { EMPTY_BRAND_KIT } from '@dazbee/schema'

import { contrast, deepColour, paletteOf } from './palette.ts'
import { STYLES } from './styles.ts'

/** A kit of a pale accent and a light secondary, on white. */
const PALE = paletteOf(
  {
    ...EMPTY_BRAND_KIT,
    colors: [
      { token: 'primary', name: 'Primary', value: '#2E6BFFFF' },
      { token: 'secondary', name: 'Secondary', value: '#EFE6DAFF' },
      { token: 'accent', name: 'Accent', value: '#D9F27AFF' },
      { token: 'background', name: 'Background', value: '#FFFFFFFF' },
      { token: 'text', name: 'Text', value: '#1A1A1AFF' },
    ],
  },
  STYLES.minimal,
)

describe('deepColour', () => {
  it('finds a ground light ink reads on at 7:1, from a kit whose secondary is light', () => {
    const deep = deepColour(PALE)
    expect(
      Math.max(contrast(deep.value, '#FFFFFFFF'), contrast(deep.value, PALE.background.value)),
    ).toBeGreaterThanOrEqual(7)
    expect(deep.ref).toEqual(PALE.text.ref)
  })
})
