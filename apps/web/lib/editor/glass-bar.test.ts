import { describe, expect, it } from 'vitest'

import type { AiEstimate, AiFrameView, DesignAi } from '@dazbee/schema'

import { en } from '@/lib/i18n/en.ts'

import { editableAction, estimates, estimateWords, glassFrame, glassPlace, warmingUp } from './glass-bar.ts'

const AT = '2026-11-27T10:00:00.000Z'

const frame = (frameId: string, state: AiFrameView['state'], briefId: string | null = 'b1'): AiFrameView => ({
  frameId,
  briefId,
  jobId: 'j1',
  callIndex: 1,
  kind: 'draft',
  state,
  assetId: state === 'arrived' ? 'pic' : null,
  updatedAt: AT,
})

const AI: DesignAi = {
  frames: [frame('f1', 'arrived'), frame('f2', 'waiting'), frame('f3', 'failed'), frame('f4', 'arrived', null)],
  jobs: [],
  refines: [],
  briefs: [
    {
      id: 'b1',
      sectionId: 's1',
      title: 'Sale',
      words: 'Sale',
      pictureAssetIds: [],
      referenceAssetId: null,
      size: { width: 1080, height: 1080 },
      mode: 'precise',
      planned: true,
      createdAt: AT,
    },
  ],
}

describe('glassFrame', () => {
  it('is null for a frame that isn’t an AI frame, as a copy isn’t, and before the first read', () => {
    expect(glassFrame(AI, 'copy')).toBeNull()
    expect(glassFrame(null, 'f1')).toBeNull()
    expect(glassFrame(AI, null)).toBeNull()
  })

  it('offers More like this on a draft of a brief that arrived, in its brief’s mode', () => {
    expect(glassFrame(AI, 'f1')).toMatchObject({ mode: 'precise', moreLike: true, working: false })
  })

  it('offers Refine with AI on a frame that shows its picture, and turns every AI action off while it is refined', () => {
    expect(glassFrame(AI, 'f1')).toMatchObject({ refine: true })
    const refine = { id: 'r', frameId: 'f1', pictureLayerId: 'f1-picture', jobId: 'rj', resultAssetId: null }
    const running = {
      id: 'rj',
      kind: 'refine' as const,
      state: 'running' as const,
      output: null,
      calls: [],
      error: null,
      createdAt: AT,
      endedAt: null,
    }
    expect(glassFrame({ ...AI, refines: [refine], jobs: [running] }, 'f1')).toMatchObject({
      working: true,
      refine: false,
      moreLike: false,
    })
  })

  it('turns the AI actions off while the frame waits, and offers no More like this on a failed one or one of no brief', () => {
    expect(glassFrame(AI, 'f2')).toMatchObject({ moreLike: false, working: true })
    expect(glassFrame(AI, 'f3')).toMatchObject({ moreLike: false, working: false })
    expect(glassFrame(AI, 'f4')).toMatchObject({ mode: 'fast', moreLike: false })
  })
})

describe('glassPlace', () => {
  const at = { width: 200, height: 40, room: 1000, under: 60 }

  it('centres the bar over the frame, above its label', () => {
    expect(glassPlace({ ...at, frame: { left: 300, right: 700 }, label: 400 })).toEqual({ left: 400, top: 352 })
  })

  it('lifts the bar above the title of the frame’s section where it would cover it', () => {
    const title = { x: 250, y: 330, width: 400, height: 30 }
    expect(glassPlace({ ...at, frame: { left: 300, right: 700 }, label: 400, title })).toEqual({ left: 400, top: 282 })
    const aside = { ...title, x: 700 }
    expect(glassPlace({ ...at, frame: { left: 300, right: 700 }, label: 400, title: aside }).top).toBe(352)
  })

  it('keeps the bar inside the stage’s sides and below the top islands', () => {
    expect(glassPlace({ ...at, frame: { left: -500, right: 100 }, label: 50 })).toEqual({ left: 8, top: 68 })
    expect(glassPlace({ ...at, frame: { left: 900, right: 1400 }, label: 400 }).left).toBe(792)
  })
})

describe('estimateWords', () => {
  const g = en.editor.glass

  it('names the action until the estimate is known, then its share and time', () => {
    expect(estimateWords(null, 'More like this', g)).toBe('More like this')
    expect(estimateWords({ share: 2, seconds: 45 }, 'More like this', g)).toBe(
      'More like this: about 2% of your AI · about 45 s',
    )
    expect(estimateWords({ share: 'under-1', seconds: 150 }, 'X', g)).toBe('X: under 1% of your AI · about 3 min')
    expect(estimateWords({ share: null, seconds: 30 }, 'X', g)).toBe('X: about 30 s')
  })
})

describe('estimates', () => {
  it('asks each action and mode once per editor, and again after a failed ask', async () => {
    const kept = estimates()
    const editor = {}
    let asked = 0
    const answer: AiEstimate = { share: 1, seconds: 40 }
    const ask = () => {
      asked++
      return asked === 1 ? Promise.reject(new Error('offline')) : Promise.resolve(answer)
    }
    await expect(kept.get(editor, 'more-like-this', 'fast', ask)).rejects.toThrow('offline')
    expect(await kept.get(editor, 'more-like-this', 'fast', ask)).toBe(answer)
    expect(await kept.get(editor, 'more-like-this', 'fast', ask)).toBe(answer)
    expect(asked).toBe(2)
    await kept.get(editor, 'more-like-this', 'precise', ask)
    await kept.get({}, 'more-like-this', 'fast', ask)
    expect(asked).toBe(4)
  })
})

describe('editableAction', () => {
  const shows = (assetId: string) => [{ type: 'image', assetId }]
  const nodes = (visible: boolean, assetId = 'pic') => ({
    'f1-picture': { parentId: 'f1', props: { visible, fills: shows(assetId) } },
    group: { parentId: 'f1', props: {} },
    'j2-f1-0': { parentId: 'group', props: {} },
    mine: { parentId: 'f1', props: {} },
  })
  const design = (visible: boolean, assetId?: string) => ({ frames: { f1: {} }, nodes: nodes(visible, assetId) })
  const frame = { frameId: 'f1', jobId: 'j2', assetId: 'pic' }

  it('offers Make editable on a picture, Back to picture over its layers, and the layers again over the picture', () => {
    expect(editableAction({ ...frame, state: 'arrived' }, design(true))).toEqual({ kind: 'make' })
    expect(editableAction({ ...frame, state: 'editable' }, design(false))).toEqual({
      kind: 'back',
      layerIds: ['j2-f1-0'],
    })
    expect(editableAction({ ...frame, state: 'editable' }, design(true))).toEqual({
      kind: 'again',
      layerIds: ['j2-f1-0'],
    })
  })

  it('makes it editable anew over a picture the layers weren’t made from', () => {
    expect(editableAction({ ...frame, state: 'editable' }, design(true, 'other'))).toEqual({ kind: 'make' })
  })

  it('offers it again on an editable frame whose layers are gone, and nothing while it works or has no picture', () => {
    expect(
      editableAction(
        { ...frame, state: 'editable' },
        { frames: { f1: {} }, nodes: { 'f1-picture': { parentId: 'f1', props: {} } } },
      ),
    ).toEqual({
      kind: 'make',
    })
    expect(editableAction({ ...frame, state: 'layering' }, design(true))).toBeNull()
    expect(editableAction({ ...frame, state: 'arrived' }, { frames: {}, nodes: {} })).toBeNull()
  })
})

describe('warmingUp', () => {
  const job = (state: 'running' | 'done', split: 'running' | 'done', kind: 'layering' | 'round' = 'layering') => ({
    kind,
    state,
    createdAt: AT,
    calls:
      split === 'done'
        ? [
            {
              index: 1,
              function: 'layer-split',
              state: 'done' as const,
              output: { kind: 'layers' as const, layers: [], gpuSeconds: 1 },
            },
          ]
        : [{ index: 1, function: 'layer-split', state: 'running' as const }],
  })
  const at = Date.parse(AT)

  it('is true once the split has run 25 s with no layers made', () => {
    expect(warmingUp(job('running', 'running'), at + 24_000)).toBe(false)
    expect(warmingUp(job('running', 'running'), at + 25_000)).toBe(true)
    expect(warmingUp(job('running', 'done'), at + 60_000)).toBe(false)
    expect(warmingUp(job('done', 'running'), at + 60_000)).toBe(false)
    expect(warmingUp(job('running', 'running', 'round'), at + 60_000)).toBe(false)
  })
})
