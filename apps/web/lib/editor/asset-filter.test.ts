import { describe, expect, it } from 'vitest'

import { libraryShows } from './asset-filter.ts'

describe('libraryShows', () => {
  const mine = { id: 'mine', tags: ['logo'] }
  const made = { id: 'made', tags: ['ai'] }

  it('lists the person’s own images, and the AI’s under Made with AI', () => {
    expect(libraryShows([mine, made], false)).toEqual([mine])
    expect(libraryShows([mine, made], true)).toEqual([made])
  })
})
