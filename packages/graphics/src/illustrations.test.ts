import { describe, expect, it } from 'vitest'

import { MAX_SVG_BYTES } from '@dazbee/schema'

import { illustrationOf, illustrations } from './illustrations.ts'
import { ILLUSTRATION_SET_IDS } from './sets.ts'

describe('illustrations', () => {
  it('lists every set’s scenes, each with its source, SHA-256, size within an SVG upload’s, drawn size and tags', () => {
    for (const set of ILLUSTRATION_SET_IDS)
      expect(illustrations().filter((each) => each.set === set).length).toBeGreaterThan(400)
    expect(illustrations().filter(({ set }) => set === 'undraw').length).toBeGreaterThan(1300)
    for (const { source, sha256, byteSize, width, height, tags, topics } of illustrations()) {
      expect(source).toMatch(/^(svgs\/[^/]+\.svg|https:\/\/[^\s]+\.svg)$/)
      expect(sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(byteSize).toBeGreaterThan(0)
      expect(byteSize).toBeLessThanOrEqual(MAX_SVG_BYTES)
      expect(Math.min(width, height)).toBeGreaterThan(0)
      expect(tags.length).toBeGreaterThan(0)
      expect(topics.every((topic) => !tags.includes(topic))).toBe(true)
    }
  })
})

describe('illustrationOf', () => {
  it('finds an illustration by its set and name', () => {
    expect(illustrationOf('undraw', 'delivery')).toMatchObject({ set: 'undraw', source: 'svgs/delivery.svg' })
    expect(illustrationOf('undraw', 'no-such-scene')).toBeUndefined()
  })
})
