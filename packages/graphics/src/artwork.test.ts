import { describe, expect, it } from 'vitest'

import { MAX_SVG_BYTES, MAX_UPLOAD_BYTES } from '@dazbee/schema'

import { artworkFiles, artworkOf, artworks } from './artwork.ts'
import { ARTWORK_SET_IDS, ARTWORK_SETS } from './artwork-sets.ts'

describe('artworks', () => {
  it('lists every set’s graphics, each with tags and a file in every style of its set', () => {
    for (const set of ARTWORK_SET_IDS) {
      const listed = artworks().filter((each) => each.set === set)
      expect(listed.length).toBeGreaterThan(20)
      for (const { files, tags } of listed) {
        expect(Object.keys(files)).toEqual(ARTWORK_SETS[set].styles)
        expect(tags.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('artworkOf', () => {
  it('finds a graphic by its set and name', () => {
    const [first] = artworks()
    expect(first && artworkOf(first.set, first.name)).toEqual(first)
    expect(artworkOf('coolshapes', 'no-such-shape')).toBeUndefined()
  })
})

describe('artworkFiles', () => {
  it('lists every file with its SHA-256, a size an upload may have, and its drawn size', () => {
    const files = artworkFiles()
    expect(files.length).toBe(artworks().reduce((sum, { files: each }) => sum + Object.keys(each).length, 0))
    for (const { set, sha256, byteSize, width, height, blend } of files) {
      expect(sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(byteSize).toBeGreaterThan(0)
      expect(byteSize).toBeLessThanOrEqual(ARTWORK_SETS[set].format === 'svg' ? MAX_SVG_BYTES : MAX_UPLOAD_BYTES)
      expect(Math.min(width, height)).toBeGreaterThan(0)
      if (blend) expect(ARTWORK_SETS[set].kind).toBe('effect')
    }
  })
})
