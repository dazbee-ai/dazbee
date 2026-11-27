import { describe, expect, it } from 'vitest'

import { type AiJobView, type DesignAi, pictureLayerOf } from '@dazbee/schema'

import {
  drawMarks,
  MARKS_BLUE,
  type MarksPen,
  marksSize,
  markStart,
  pictureVersions,
  refineBoxPlace,
  refineDrafts,
  refineLayer,
  refining,
} from './refine.ts'

const AT = '2026-11-27T10:00:00.000Z'

const picture = (assetId: string) => ({
  kind: 'pictures' as const,
  pictures: [{ key: `originals/${assetId}`, width: 1080, height: 1080, assetId }],
})

const job = (id: string, calls: AiJobView['calls'], ended = true): AiJobView => ({
  id,
  kind: 'refine',
  state: ended ? 'done' : 'running',
  output: null,
  calls,
  error: null,
  createdAt: AT,
  endedAt: ended ? AT : null,
})

const AI: DesignAi = {
  frames: [
    {
      frameId: 'f1',
      briefId: 'b1',
      jobId: 'round',
      callIndex: 1,
      kind: 'draft',
      state: 'arrived',
      assetId: 'v2',
      updatedAt: AT,
    },
  ],
  jobs: [
    job('round', [{ index: 1, function: 'draft', state: 'done', output: picture('v0') }]),
    job('r1', [{ index: 1, function: 'refine-edit', state: 'done', output: picture('v1') }]),
    job('r2', [{ index: 1, function: 'refine-edit', state: 'done', output: picture('v2') }]),
    job('r3', [{ index: 1, function: 'refine-edit', state: 'running' }], false),
  ],
  briefs: [],
  refines: [
    { id: 'a', frameId: 'f1', pictureLayerId: pictureLayerOf('f1'), jobId: 'r1', resultAssetId: 'v1' },
    { id: 'b', frameId: 'f1', pictureLayerId: pictureLayerOf('f1'), jobId: 'r2', resultAssetId: null },
    { id: 'c', frameId: 'f1', pictureLayerId: pictureLayerOf('f1'), jobId: 'r3', resultAssetId: null },
  ],
}

describe('refining', () => {
  it('is true while a refine of the frame runs, and false once each has its version or has ended', () => {
    expect(refining(AI, 'f1')).toBe(true)
    expect(refining({ ...AI, refines: AI.refines.slice(0, 2) }, 'f1')).toBe(false)
    expect(refining(AI, 'other')).toBe(false)
  })
})

describe('pictureVersions', () => {
  it('lists the first picture, then each refine’s new version once made, made or marked', () => {
    expect(pictureVersions(AI, 'f1', pictureLayerOf('f1'))).toEqual([
      { assetId: 'v0', refineId: null },
      { assetId: 'v1', refineId: 'a' },
      { assetId: 'v2', refineId: 'b' },
    ])
    expect(pictureVersions(AI, 'other', pictureLayerOf('other'))).toEqual([])
  })

  it('lists only a layer’s own refines, with no first picture, for a layer of an editable frame', () => {
    const refines = [
      ...AI.refines,
      { id: 'd', frameId: 'f1', pictureLayerId: 'piece', jobId: 'r2', resultAssetId: 'v9' },
    ]
    expect(pictureVersions({ ...AI, refines }, 'f1', 'piece')).toEqual([{ assetId: 'v9', refineId: 'd' }])
  })
})

describe('refineLayer', () => {
  it('changes a draft’s picture layer, and on an editable frame the one picture selected in it', () => {
    expect(refineLayer(AI, 'f1', [])).toBe(pictureLayerOf('f1'))
    const editable = { ...AI, frames: AI.frames.map((f) => ({ ...f, state: 'editable' as const })) }
    expect(refineLayer(editable, 'f1', [])).toBeNull()
    expect(refineLayer(editable, 'f1', [{ id: 'p', parentId: 'f1', image: true }])).toBe('p')
    expect(refineLayer(editable, 'f1', [{ id: 't', parentId: 'f1', image: false }])).toBeNull()
  })
})

describe('marksSize', () => {
  it('is the frame’s own size, scaled down to 2048 on its longest side', () => {
    expect(marksSize({ width: 1080, height: 1920 })).toEqual({ width: 1080, height: 1920 })
    expect(marksSize({ width: 4096, height: 1024 })).toEqual({ width: 2048, height: 512 })
  })
})

describe('refineBoxPlace', () => {
  const room = { width: 1000, height: 800 }
  const box = { width: 360, height: 200 }

  it('goes under the frame, centred on it, inside the stage’s sides', () => {
    expect(refineBoxPlace({ left: 300, top: 100, right: 700, bottom: 400 }, box, room)).toEqual({ left: 320, top: 412 })
    expect(refineBoxPlace({ left: -400, top: 100, right: 0, bottom: 400 }, box, room).left).toBe(12)
  })

  it('goes up over the frame’s bottom when there is no room under it', () => {
    expect(refineBoxPlace({ left: 300, top: 100, right: 700, bottom: 700 }, box, room).top).toBe(588)
  })
})

describe('refineDrafts', () => {
  it('keeps a box’s words and marks per editor and frame', () => {
    const drafts = refineDrafts()
    const editor = {}
    const marks = [{ kind: 'box' as const, from: { x: 0, y: 0 }, to: { x: 5, y: 5 } }]
    drafts.set(editor, 'f1', { words: 'Bigger', marks })
    expect(drafts.get(editor, 'f1')).toEqual({ words: 'Bigger', marks })
    expect(drafts.get(editor, 'f2')).toEqual({ words: '', marks: [] })
    expect(drafts.get({}, 'f1')).toEqual({ words: '', marks: [] })
  })
})

describe('markStart', () => {
  it('is a box’s top left corner, or a stroke’s first point', () => {
    expect(markStart({ kind: 'box', from: { x: 9, y: 2 }, to: { x: 3, y: 8 } })).toEqual({ x: 3, y: 2 })
    expect(markStart({ kind: 'brush', points: [{ x: 4, y: 4 }] })).toEqual({ x: 4, y: 4 })
  })
})

describe('drawMarks', () => {
  it('draws each mark in blue, scaled to the picture, with its number on a blue disc at its start', () => {
    const log: string[] = []
    const pen: MarksPen = {
      strokeStyle: '',
      fillStyle: '',
      lineWidth: 0,
      lineCap: 'butt',
      lineJoin: 'miter',
      beginPath: () => log.push('begin'),
      moveTo: (x, y) => log.push(`move ${x} ${y}`),
      lineTo: (x, y) => log.push(`line ${x} ${y}`),
      arc: (x, y, r) => log.push(`disc ${x} ${y} ${r > 0}`),
      stroke: () => log.push(`stroke ${String(pen.strokeStyle)}`),
      fill: () => log.push(`fill ${String(pen.fillStyle)}`),
      strokeRect: (x, y, w, h) => log.push(`box ${x} ${y} ${w} ${h} ${String(pen.strokeStyle)}`),
    }
    drawMarks(
      pen,
      [
        { kind: 'box', from: { x: 200, y: 100 }, to: { x: 100, y: 300 } },
        {
          kind: 'brush',
          points: [
            { x: 0, y: 0 },
            { x: 50, y: 50 },
          ],
        },
      ],
      { width: 1000, height: 1000 },
      { width: 500, height: 500 },
    )
    expect(log).toContain(`box 50 50 50 100 ${MARKS_BLUE}`)
    expect(log).toContain('disc 50 50 true')
    expect(log).toContain('move 0 0')
    expect(log).toContain('line 25 25')
    expect(log.filter((l) => l.startsWith('disc'))).toHaveLength(2)
    expect(log).toContain(`fill ${MARKS_BLUE}`)
    expect(log).toContain('stroke #FFFFFF')
  })
})
