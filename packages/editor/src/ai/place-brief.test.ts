import { describe, expect, it } from 'vitest'

import { type DesignSize, SYNC_LIMITS } from '@dazbee/schema'

import { briefPassesWarning, DRAFTS, pictureLayerOf, planBrief } from './place-brief.ts'

const EMPTY: DesignSize = { layers: 0, frames: 0, pages: 1, sections: 0, connectors: 0, bytes: 1000 }

describe('planBrief', () => {
  it('makes a section and four frames, each with a picture layer whose id comes from its frame’s', () => {
    let n = 0
    const plan = planBrief(() => `id${++n}`)
    expect(plan).toEqual({
      sectionId: 'id5',
      frames: [1, 2, 3, 4].map((i) => ({ frameId: `id${i}`, pictureLayerId: pictureLayerOf(`id${i}`) })),
    })
    expect(plan.frames).toHaveLength(DRAFTS)
  })
})

describe('briefPassesWarning', () => {
  it('is false for a design well within its limits', () => {
    expect(briefPassesWarning(EMPTY)).toBe(false)
  })

  it('is true when four more frames and layers would reach the warning on layers', () => {
    const at = SYNC_LIMITS.designLayers * SYNC_LIMITS.warnAt
    expect(briefPassesWarning({ ...EMPTY, layers: at - DRAFTS - 1 })).toBe(false)
    expect(briefPassesWarning({ ...EMPTY, layers: at - DRAFTS })).toBe(true)
  })

  it('is true when one more section would reach the warning on sections', () => {
    expect(briefPassesWarning({ ...EMPTY, sections: SYNC_LIMITS.designSections * SYNC_LIMITS.warnAt - 1 })).toBe(true)
  })

  it('is true when the brief’s bytes would reach the warning on bytes', () => {
    expect(briefPassesWarning({ ...EMPTY, bytes: SYNC_LIMITS.designBytes * SYNC_LIMITS.warnAt - 1000 })).toBe(true)
  })
})
