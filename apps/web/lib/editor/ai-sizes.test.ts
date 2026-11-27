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
  nodes: { 'draft-picture': { parentId: 'draft', props: { fills: [{ type: 'image', assetId: 'pic' }] } } },
  connectors: { c1: { from: 'draft', to: 'sizes' } },
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
  it('takes a section’s AI sizes that show their picture, with the picture of the draft joined to it', () => {
    expect(sizesToLayer(AI, DESIGN, 'sizes')).toEqual({ frameIds: ['tall', 'wide'], planAssetId: 'pic' })
  })

  it('is null for a section with no draft joined to it, or fewer than two sizes', () => {
    expect(sizesToLayer(AI, { ...DESIGN, connectors: {} }, 'sizes')).toBeNull()
    expect(sizesToLayer({ ...AI, frames: [frame('tall')] }, DESIGN, 'sizes')).toBeNull()
  })
})
