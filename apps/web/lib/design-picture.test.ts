import { describe, expect, it } from 'vitest'

import { designPictureSrc } from './design-picture.ts'

describe('designPictureSrc', () => {
  const design = { id: 'd1', updatedAt: '2026-11-27T10:00:00.000Z' }

  it('names the design’s last edit, so each version has an address of its own', () => {
    expect(designPictureSrc('w1', 'b1', design)).toBe('/w/w1/brands/b1/designs/d1/thumbnail?v=1795773600000')
    expect(designPictureSrc('w1', 'b1', design, {})).toBe('/w/w1/brands/b1/designs/d1/thumbnail?v=1795773600000')
    expect(designPictureSrc('w1', 'b1', design, null)).toBe('/w/w1/brands/b1/designs/d1/thumbnail?v=1795773600000')
  })

  it('names the draft the cover frame shows while no tab has written it, so the picture with it is read anew', () => {
    expect(designPictureSrc('w1', 'b1', design, { draftAssetId: 'a9' })).toBe(
      '/w/w1/brands/b1/designs/d1/thumbnail?v=1795773600000-a9',
    )
  })
})
