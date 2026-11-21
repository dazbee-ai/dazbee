import { describe, expect, it } from 'vitest'

import { colorRoles } from './site-colors.ts'

describe('colorRoles', () => {
  it('fills Primary, Secondary and Accent with different colours, the theme colour counting as the most used', () => {
    const used = new Map([
      ['#1F4D3AFF', 4],
      ['#E8833AFF', 3],
      ['#C96A24FF', 2],
      ['#2B6CB0FF', 1],
      ['#222222FF', 9],
    ])
    expect(colorRoles({ used, background: null, text: '#222222FF', read: true }, '#2B6CB0FF')).toEqual({
      primary: '#2B6CB0FF',
      secondary: '#1F4D3AFF',
      accent: '#E8833AFF',
      background: '#FFFFFFFF',
      text: '#222222FF',
    })
  })

  it('reads two hundred thousand colours with a theme colour', () => {
    const used = new Map(
      Array.from({ length: 200_000 }, (_, i) => [
        `#${(i * 37).toString(16).padStart(6, '0').slice(-6).toUpperCase()}FF`,
        1,
      ]),
    )
    expect(colorRoles({ used, background: null, text: null, read: false }, '#2B6CB0FF').primary).toBe('#2B6CB0FF')
  })
})
