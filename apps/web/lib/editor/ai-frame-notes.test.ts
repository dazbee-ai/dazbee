import { describe, expect, it } from 'vitest'

import type { AiBriefView, AiFrameView, DesignAi } from '@dazbee/schema'

import { briefChips, failedNotes } from './ai-frame-notes.ts'

const AT = '2026-11-27T10:00:00.000Z'

const frame = (frameId: string, state: AiFrameView['state'], over: Partial<AiFrameView> = {}): AiFrameView => ({
  frameId,
  briefId: 'planned',
  jobId: 'j1',
  callIndex: 1,
  kind: 'draft',
  state,
  assetId: null,
  updatedAt: AT,
  ...over,
})

const brief = (id: string, sectionId: string, over: Partial<AiBriefView> = {}): AiBriefView => ({
  id,
  sectionId,
  title: 'Sale',
  words: 'Sale',
  pictureAssetIds: [],
  referenceAssetId: null,
  size: { width: 1080, height: 1080 },
  mode: 'fast',
  planned: true,
  createdAt: AT,
  ...over,
})

const DESIGN = {
  frames: {
    f1: { pageId: 'p1' },
    f2: { pageId: 'p1' },
    f3: { pageId: 'p1' },
    f4: { pageId: 'p1' },
    f9: { pageId: 'p2' },
  },
  sections: { s1: { pageId: 'p1' }, s2: { pageId: 'p1' }, s9: { pageId: 'p2' } },
}

const AI: DesignAi = {
  frames: [
    frame('f1', 'failed'),
    frame('f2', 'failed', { briefId: 'unplanned' }),
    frame('f3', 'failed', { kind: 'size' }),
    frame('f4', 'arrived'),
    frame('f9', 'failed'),
    frame('gone', 'failed'),
  ],
  jobs: [],
  refines: [],
  briefs: [
    brief('planned', 's1', { pictureAssetIds: ['a1', 'a2'] }),
    brief('unplanned', 's2', { planned: false }),
    brief('other', 's9', { pictureAssetIds: ['a3'] }),
  ],
}

describe('failedNotes', () => {
  it('notes each failed frame of the page, saying what wasn’t charged: the draft, the size, or nothing when its plan failed', () => {
    expect(failedNotes(AI, DESIGN, 'p1')).toEqual([
      { frameId: 'f1', notCharged: 'draft' },
      { frameId: 'f2', notCharged: 'nothing' },
      { frameId: 'f3', notCharged: 'size' },
    ])
  })

  it('notes nothing before the first read', () => {
    expect(failedNotes(null, DESIGN, 'p1')).toEqual([])
  })
})

describe('briefChips', () => {
  it('gives the pictures of each brief with any whose section is on the page', () => {
    expect(briefChips(AI, DESIGN, 'p1')).toEqual([{ sectionId: 's1', assetIds: ['a1', 'a2'] }])
    expect(briefChips(AI, DESIGN, 'p2')).toEqual([{ sectionId: 's9', assetIds: ['a3'] }])
  })
})
