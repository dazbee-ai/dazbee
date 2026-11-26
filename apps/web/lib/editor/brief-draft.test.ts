import { describe, expect, it } from 'vitest'

import type { AssetSummary } from '@dazbee/schema'

import { briefDrafts } from './brief-draft.ts'

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
})
