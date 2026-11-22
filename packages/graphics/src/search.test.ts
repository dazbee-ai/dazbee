import { describe, expect, it } from 'vitest'

import { findGraphic, searchGraphics } from './search.ts'

describe('searchGraphics', () => {
  it('finds the icon named as the query first in each icon set, the sets taking turns', () => {
    const found = searchGraphics('star', { kind: 'icon', limit: 4 }).map(({ id }) => id)
    expect(found.slice(0, 2)).toEqual(['tabler/star', 'phosphor/star'])
    expect(found.map((id) => id.split('/')[0])).toEqual(['tabler', 'phosphor', 'tabler', 'phosphor'])
  })

  it('needs every word to match, in the name or the tags', () => {
    const found = searchGraphics('arrow right', { limit: 30 })
    expect(found.length).toBeGreaterThan(0)
    for (const { name, tags } of found) {
      const words = `${name} ${tags.join(' ')}`
      expect(words).toContain('arrow')
      expect(words).toContain('right')
    }
  })

  it('finds an icon by a tag, and a plural by its singular', () => {
    expect(searchGraphics('trolley', { limit: 5, set: 'tabler' }).map(({ name }) => name)).toContain('shopping-cart')
    expect(searchGraphics('carts', { kind: 'icon', limit: 5 }).map(({ name }) => name)).toContain('shopping-cart')
  })

  it('keeps to the set asked for and to the limit', () => {
    const found = searchGraphics('arrow', { limit: 7, set: 'phosphor' })
    expect(found).toHaveLength(7)
    expect(found.every(({ set }) => set === 'phosphor')).toBe(true)
  })

  it('finds nothing for no words or words no graphic has', () => {
    expect(searchGraphics(' - ', { limit: 5 })).toEqual([])
    expect(searchGraphics('zzqqxx', { limit: 5 })).toEqual([])
  })

  it('finds each sticker set’s stickers by their names and tags, kind sticker', () => {
    const first = (query: string) => searchGraphics(query, { kind: 'sticker', limit: 1 })[0]
    expect(first('rocket')).toMatchObject({ id: 'fluent-emoji/rocket', kind: 'sticker', styles: ['3d', 'flat'] })
    expect(first('standing peep')).toMatchObject({ set: 'open-peeps', styles: ['drawing'] })
    expect(first('humaaan')).toMatchObject({ set: 'humaaans', styles: ['drawing'] })
    expect(first('coffee doodle')).toMatchObject({ id: 'open-doodles/coffee' })
  })

  it('gives every set’s graphics, icons and stickers taking turns, when no kind is asked for', () => {
    const found = searchGraphics('person', { limit: 12 })
    expect(new Set(found.map(({ kind }) => kind))).toEqual(new Set(['icon', 'sticker']))
    expect(new Set(found.map(({ set }) => set))).toEqual(
      new Set(['tabler', 'phosphor', 'fluent-emoji', 'open-peeps', 'humaaans', 'open-doodles']),
    )
  })

  it('gives only icons with kind icon, and only stickers with kind sticker', () => {
    expect(searchGraphics('heart', { kind: 'icon', limit: 50 }).every(({ kind }) => kind === 'icon')).toBe(true)
    const stickers = searchGraphics('heart', { kind: 'sticker', limit: 50 })
    expect(stickers.length).toBeGreaterThan(0)
    expect(stickers.every(({ kind }) => kind === 'sticker')).toBe(true)
  })
})

describe('findGraphic', () => {
  it('finds an icon by its id, with its styles', () => {
    expect(findGraphic('tabler/star')).toMatchObject({
      kind: 'icon',
      set: 'tabler',
      name: 'star',
      styles: ['outline', 'filled'],
    })
    expect(findGraphic('phosphor/star')?.styles).toEqual(['regular', 'thin', 'light', 'bold', 'fill', 'duotone'])
  })

  it('finds a sticker by its id, with its styles', () => {
    expect(findGraphic('fluent-emoji/thumbs-up')).toMatchObject({ kind: 'sticker', styles: ['3d', 'flat'] })
    expect(findGraphic('open-doodles/coffee')).toMatchObject({ kind: 'sticker', styles: ['drawing'] })
  })

  it('finds no graphic of another set, a missing name or a malformed id', () => {
    for (const id of [
      'material/star',
      'tabler/no-such-icon',
      'tabler',
      'tabler/star/extra',
      '/star',
      'constructor/x',
      'fluent-emoji/../tabler',
    ])
      expect(findGraphic(id)).toBeUndefined()
  })
})
