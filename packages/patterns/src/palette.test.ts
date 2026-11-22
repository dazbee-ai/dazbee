import { describe, expect, it } from 'vitest'

import { EMPTY_BRAND_KIT } from '@dazbee/schema'

import { contrast, deepColour, deltaE, lchOf, paletteOf } from './palette.ts'
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

describe('deltaE', () => {
  it('tells the same colour apart by nothing and plainly different colours by much', () => {
    expect(deltaE('#3D5AFEFF', '#3D5AFEFF')).toBe(0)
    expect(deltaE('#FFFFFFFF', '#000000FF')).toBeCloseTo(100, 0)
    // A blue and a slightly different blue are close; a blue and a yellow are far apart.
    expect(deltaE('#3D5AFEFF', '#2E5BFFFF')).toBeLessThan(10)
    expect(deltaE('#3D5AFEFF', '#FFD23FFF')).toBeGreaterThan(60)
  })

  it('reads a grey as without chroma, and an orange as warm', () => {
    expect(lchOf('#808080FF').chroma).toBeLessThan(1)
    const orange = lchOf('#FF5A36FF')
    expect(orange.hue).toBeGreaterThan(20)
    expect(orange.hue).toBeLessThan(60)
  })
})
