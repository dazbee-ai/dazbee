import { describe, expect, it } from 'vitest'

import type { AiBriefView, AssetSummary } from '@dazbee/schema'

import { briefDraftOf, briefDrafts, briefOfSection } from './brief-draft.ts'

describe('briefDrafts', () => {
  it('gives an editor’s box an empty draft at the size given and Fast, until one is kept', () => {
    const drafts = briefDrafts()
    expect(drafts.get({}, 'story')).toEqual({ words: '', pictures: [], sizeId: 'story', mode: 'fast' })
  })

  it('keeps the words, pictures, size and speed for the editor, so the box opened again shows them, and none for another', () => {
    const drafts = briefDrafts()
    const [editor, other] = [{}, {}]
    const draft = {
      words: 'Autumn cold brew\nWarm tones',
      pictures: [{ key: 'k1', name: 'cutout.png' }],
      sizeId: 'story',
      mode: 'precise' as const,
    }
    drafts.set(editor, draft)
    expect(drafts.get(editor, 'feed-square')).toEqual(draft)
    expect(drafts.get(other, 'feed-square').words).toBe('')
  })

  it('takes in an upload that ends while the box is closed', () => {
    const drafts = briefDrafts()
    const editor = {}
    drafts.set(editor, { words: 'w', pictures: [{ key: 'k1', name: 'a.png' }], sizeId: 'story', mode: 'fast' })
    const asset = { id: 'a1' } as AssetSummary
    drafts.patchPicture(editor, 'k1', { asset })
    expect(drafts.get(editor, 'story').pictures).toEqual([{ key: 'k1', name: 'a.png', asset }])
  })

  it('fills an editor’s draft and tells a box open on it, until it stops listening', () => {
    const drafts = briefDrafts()
    const editor = {}
    const told: string[] = []
    const stop = drafts.onFill(editor, (draft) => told.push(draft.words))
    drafts.fill(editor, { words: 'again', pictures: [], sizeId: 'story', mode: 'fast' })
    stop()
    drafts.fill(editor, { words: 'later', pictures: [], sizeId: 'story', mode: 'fast' })
    expect(told).toEqual(['again'])
    expect(drafts.get(editor, 'feed-square').words).toBe('later')
  })
})

describe('briefDraftOf', () => {
  const brief: AiBriefView = {
    id: 'b1',
    sectionId: 's1',
    title: 'Diwali serum sale',
    words: 'Diwali serum sale\nwarm lights',
    pictureAssetIds: ['p1', 'p2'],
    referenceAssetId: null,
    size: { width: 1080, height: 1920 },
    mode: 'precise',
    planned: true,
    createdAt: '2026-11-27T10:00:00.000Z',
  }

  it('fills the box with the brief’s words, pictures, size and speed', () => {
    expect(briefDraftOf(brief, (n) => `Picture ${n + 1}`)).toEqual({
      words: 'Diwali serum sale\nwarm lights',
      pictures: [
        { key: 'b1/p1', name: 'Picture 1', asset: { id: 'p1' } },
        { key: 'b1/p2', name: 'Picture 2', asset: { id: 'p2' } },
      ],
      sizeId: 'story',
      mode: 'precise',
    })
  })

  it('takes the first size of the AI’s list for a size the list has no more', () => {
    expect(briefDraftOf({ ...brief, size: { width: 999, height: 998 } }, String).sizeId).toBe('feed-square')
  })
})

describe('briefOfSection', () => {
  it('finds the brief whose section it is, and none for another section or before the first read', () => {
    const brief = {
      id: 'b1',
      sectionId: 's1',
      title: 'Sale',
      words: 'Sale',
      pictureAssetIds: [],
      referenceAssetId: null,
      size: { width: 1080, height: 1080 },
      mode: 'fast' as const,
      planned: true,
      createdAt: '2026-11-27T10:00:00.000Z',
    }
    const ai = { frames: [], jobs: [], briefs: [brief], refines: [] }
    expect(briefOfSection(ai, 's1')).toBe(brief)
    expect(briefOfSection(ai, 's2')).toBeUndefined()
    expect(briefOfSection(null, 's1')).toBeUndefined()
  })
})
