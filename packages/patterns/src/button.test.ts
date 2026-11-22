import { describe, expect, it } from 'vitest'

import { EMPTY_BRAND_KIT } from '@dazbee/schema'

import { ctaFill } from './button.ts'
import { contrast, paletteOf } from './palette.ts'
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

describe('ctaFill', () => {
  it('fills the button with a colour that stands out from its ground at 3:1, never the ground’s own', () => {
    const { fill, edge } = ctaFill(PALE, PALE.background, 'accent')
    expect(fill.value).not.toBe(PALE.background.value)
    expect(contrast(fill.value, PALE.background.value)).toBeGreaterThanOrEqual(3)
    expect(edge).toBeUndefined()
  })

  it('edges the button in the ground’s ink where no colour of the kit stands out from it', () => {
    const grey = { value: '#808080FF' }
    const palette = {
      ...PALE,
      primary: grey,
      secondary: grey,
      accent: grey,
      text: { value: '#8A8A8AFF' },
    }
    const { edge } = ctaFill(palette, { value: '#858585FF' }, 'accent')
    expect(edge).toBeDefined()
  })
})
