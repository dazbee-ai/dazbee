import { describe, expect, it } from 'vitest'

import { GOOGLE_FONTS, googleFaces } from '@dazbee/fonts/google'

import { faceOfKey, parseFontKey } from './font-key.ts'

/** A Google family's faces in the catalog. */
const facesOf = (family: string) => {
  const listed = GOOGLE_FONTS.find((f) => f.family === family)
  if (!listed) throw new Error(`${family} left the Google list`)
  return googleFaces(listed)
}

describe('parseFontKey', () => {
  it('reads a key’s family, weight and style, and nothing from other text', () => {
    expect(parseFontKey('42dot Sans|300|normal')).toEqual({ family: '42dot Sans', weight: 300, style: 'normal' })
    expect(parseFontKey('A|B|700|italic')).toEqual({ family: 'A|B', weight: 700, style: 'italic' })
    for (const text of ['Roboto|750|normal', 'Roboto|700|oblique', 'Roboto|700', '|400|normal'])
      expect(parseFontKey(text)).toBeNull()
  })
})

describe('faceOfKey', () => {
  it('names Roboto’s variable normal face for Roboto|700|normal, at weight 700', () => {
    const key = parseFontKey('Roboto|700|normal')
    if (!key) throw new Error('not a key')
    const named = faceOfKey(key, facesOf('Roboto'))
    expect(named?.weight).toBe(700)
    expect(named?.face).toMatchObject({
      file: 'Roboto[wdth,wght].ttf',
      style: 'normal',
      weights: { min: 100, max: 900 },
    })
  })

  it('names a static face of the key’s weight, and nothing for a style or weight the family lacks', () => {
    const abeezee = facesOf('ABeeZee')
    expect(faceOfKey({ family: 'ABeeZee', weight: 400, style: 'italic' }, abeezee)?.face.file).toBe(
      'ABeeZee-Italic.ttf',
    )
    expect(faceOfKey({ family: 'ABeeZee', weight: 700, style: 'normal' }, abeezee)).toBeNull()
    const bebas = facesOf('Bebas Neue')
    expect(faceOfKey({ family: 'Bebas Neue', weight: 400, style: 'italic' }, bebas)).toBeNull()
  })
})
