import { describe, expect, it } from 'vitest'

import { findIcon, searchIcons } from './search.ts'

describe('searchIcons', () => {
  it('finds the icon named as the query first in each set, the sets taking turns', () => {
    const found = searchIcons('star', { limit: 4 }).map(({ graphic }) => graphic)
    expect(found.slice(0, 2)).toEqual(['tabler/star', 'phosphor/star'])
    expect(found.map((graphic) => graphic.split('/')[0])).toEqual(['tabler', 'phosphor', 'tabler', 'phosphor'])
  })

  it('needs every word to match, in the name or the tags', () => {
    const found = searchIcons('arrow right', { limit: 30 })
    expect(found.length).toBeGreaterThan(0)
    for (const { name, tags } of found) {
      const words = `${name} ${tags.join(' ')}`
      expect(words).toContain('arrow')
      expect(words).toContain('right')
    }
  })

  it('finds an icon by a tag, and a plural by its singular', () => {
    expect(searchIcons('trolley', { limit: 5, set: 'tabler' }).map(({ name }) => name)).toContain('shopping-cart')
    expect(searchIcons('carts', { limit: 5 }).map(({ name }) => name)).toContain('shopping-cart')
  })

  it('keeps to the set asked for and to the limit', () => {
    const found = searchIcons('arrow', { limit: 7, set: 'phosphor' })
    expect(found).toHaveLength(7)
    expect(found.every(({ set }) => set === 'phosphor')).toBe(true)
  })

  it('finds nothing for no words or words no icon has', () => {
    expect(searchIcons(' - ', { limit: 5 })).toEqual([])
    expect(searchIcons('zzqqxx', { limit: 5 })).toEqual([])
  })
})

describe('findIcon', () => {
  it('finds an icon by its id, with its styles', () => {
    expect(findIcon('tabler/star')).toMatchObject({ set: 'tabler', name: 'star', styles: ['outline', 'filled'] })
    expect(findIcon('phosphor/star')?.styles).toEqual(['regular', 'thin', 'light', 'bold', 'fill', 'duotone'])
  })

  it('finds no icon of another set, a missing name or a malformed id', () => {
    for (const id of ['material/star', 'tabler/no-such-icon', 'tabler', 'tabler/star/extra', '/star', 'constructor/x'])
      expect(findIcon(id)).toBeUndefined()
  })
})
