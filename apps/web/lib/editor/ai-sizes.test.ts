import { describe, expect, it } from 'vitest'

import type { AiFrameView, DesignAi } from '@dazbee/schema'

import { aiSizes, sizesToLayer } from './ai-sizes.ts'

const AT = '2026-11-27T10:00:00.000Z'

const frame = (frameId: string, over: Partial<AiFrameView> = {}): AiFrameView => ({
  frameId,
  briefId: null,
  jobId: 'resize',
  callIndex: 0,
  kind: 'size',
  state: 'arrived',
  assetId: null,
  updatedAt: AT,
  ...over,
})

const AI: DesignAi = {
  frames: [frame('tall'), frame('wide'), frame('waiting', { state: 'waiting' }), frame('draft', { kind: 'draft' })],
  jobs: [],
  briefs: [],
  refines: [],
}

const square = { width: 1080, height: 1080 }
const DESIGN = {
  frames: {
    draft: { ...square },
    tall: { ...square, sectionId: 'sizes' },
    wide: { ...square, sectionId: 'sizes' },
    waiting: { ...square, sectionId: 'sizes' },
  },
}

describe('aiSizes', () => {
  it('keeps the sizes from 1:3 to 3:1', () => {
    expect(aiSizes([square, { width: 1000, height: 200 }, { width: 600, height: 1800 }])).toEqual([
      square,
      { width: 600, height: 1800 },
    ])
  })
})

describe('sizesToLayer', () => {
  it('takes a section’s AI sizes that show their picture', () => {
    expect(sizesToLayer(AI, DESIGN, 'sizes')).toEqual({ frameIds: ['tall', 'wide'] })
  })

  it('is null for a section with fewer than two sizes showing their picture, and for another section', () => {
    expect(
      sizesToLayer({ ...AI, frames: [frame('tall'), frame('waiting', { state: 'waiting' })] }, DESIGN, 'sizes'),
    ).toBeNull()
    expect(sizesToLayer(AI, DESIGN, 'drafts')).toBeNull()
  })
})
