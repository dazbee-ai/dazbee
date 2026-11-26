import { describe, expect, it } from 'vitest'

import type { MyAiJob } from '@dazbee/schema'

import { ar } from '@/lib/i18n/ar.ts'
import { en } from '@/lib/i18n/en.ts'

import { estimateWords, imageTiles, madeImages, tileWords } from './make-image.ts'

/** One of the person's image jobs in `state`, asked for with `words` at the wide ratio. */
function job(
  id: string,
  state: MyAiJob['state'],
  words = 'A soft sunrise sky',
  change: Partial<MyAiJob> = {},
): MyAiJob {
  return {
    id,
    kind: 'image',
    state,
    workspaceId: 'w1',
    brandId: 'b1',
    designId: null,
    designName: null,
    image: { words, ratio: 'wide', assetId: state === 'done' ? `asset-${id}` : null },
    made: state === 'done' ? 1 : 0,
    failed: state === 'failed' ? 1 : 0,
    createdAt: '2026-11-26T10:00:00.000Z',
    endedAt: null,
    ...change,
  }
}

describe('imageTiles', () => {
  it('shows a job still working and one that didn’t come out, with their words and ratio, and none for one made', () => {
    expect(imageTiles([job('c', 'running'), job('b', 'failed', 'A beach'), job('a', 'done', 'A forest')])).toEqual([
      { job: 'c', words: 'A soft sunrise sky', ratio: 'wide', state: 'working' },
      { job: 'b', words: 'A beach', ratio: 'wide', state: 'failed' },
    ])
    expect(imageTiles([job('w', 'waiting')])[0]?.state).toBe('working')
  })

  it('hides a failed job that was asked for again since, whatever came of the new one', () => {
    expect(imageTiles([job('new', 'running', 'A beach'), job('old', 'failed', 'A beach')]).map((t) => t.job)).toEqual([
      'new',
    ])
    expect(imageTiles([job('new', 'done', 'A beach'), job('old', 'failed', 'A beach')])).toEqual([])
    // The same words at another ratio are another image.
    const tall = job('new', 'done', 'A beach', { image: { words: 'A beach', ratio: 'tall', assetId: 'a1' } })
    expect(imageTiles([tall, job('old', 'failed', 'A beach')]).map((t) => t.job)).toEqual(['old'])
  })

  it('leaves out a cancelled job and a job that makes no image', () => {
    const round = job('r', 'running', '', { kind: 'round', designId: 'd1', designName: 'Coffee', image: null })
    expect(imageTiles([job('x', 'cancelled'), round])).toEqual([])
  })
})

describe('tileWords', () => {
  it('says what happened before the image’s words, in both languages', () => {
    const words = 'A calm sea at sunrise with one small red boat, soft pink sky'
    const tile = { job: 'j', words, ratio: 'wide' as const, state: 'failed' as const }
    expect(tileWords(tile, en.editor.makeImage)).toBe(`Didn’t come out, and you weren’t charged: “${words}”`)
    expect(tileWords({ ...tile, state: 'working' }, en.editor.makeImage)).toBe(`Making “${words}”`)
    for (const t of [en.editor.makeImage, ar.editor.makeImage]) {
      for (const state of ['working', 'failed'] as const)
        expect(tileWords({ ...tile, state }, t).endsWith(`${words}${t[state].slice(-1)}`)).toBe(true)
    }
  })
})

describe('madeImages', () => {
  it('lists the images of the jobs that are done', () => {
    expect(madeImages([job('b', 'done'), job('a', 'running'), job('f', 'failed')])).toEqual(['asset-b'])
  })
})

describe('estimateWords', () => {
  const t = en.editor.makeImage

  it('says the share of the workspace’s AI and the time', () => {
    expect(estimateWords({ share: 2, seconds: 26 }, t)).toBe('About 2% of this month’s AI, about 26 s')
    expect(estimateWords({ share: 'under-1', seconds: 26 }, t)).toBe('Under 1% of this month’s AI, about 26 s')
  })

  it('says the time alone with no allowance, and the button’s name before it is read', () => {
    expect(estimateWords({ share: null, seconds: 26 }, t)).toBe('About 26 s')
    expect(estimateWords(null, t)).toBe('Make an image')
  })
})
