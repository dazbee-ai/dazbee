import { describe, expect, it } from 'vitest'

import type { AiJobView } from '@dazbee/schema'

import { frameLayers, layerName, layerPlanOf, pieceId, scaleBox, visibleBox } from './layer-pieces.ts'

const layers = (n: number) => ({
  kind: 'layers' as const,
  layers: Array.from({ length: n }, (_, i) => ({ key: `k${i}`, width: 512, height: 512 })),
  gpuSeconds: 1,
})

const JOB: Pick<AiJobView, 'calls'> = {
  calls: [
    { index: 3, function: 'layer-split', state: 'done', output: layers(3) },
    {
      index: 0,
      function: 'layer-plan',
      state: 'done',
      output: {
        kind: 'text',
        text: '',
        json: {
          ad_type: 'graphical',
          elements: [
            {
              id: 'e1',
              kind: 'text',
              name: 'Headline',
              content: '',
              text_lines: [],
              box: { x_min: 0, y_min: 0, x_max: 9, y_max: 9 },
              shadow: 'none',
              group: null,
              ming_layer: 2,
            },
          ],
          prompt: '',
          notes: [],
          design_name: 'Sale',
        },
      },
    },
    { index: 1, function: 'layer-split', state: 'done', output: layers(2) },
    { index: 5, function: 'layer-split', state: 'running' },
  ],
}

describe('layerPlanOf', () => {
  it('reads the plan once its call is done', () => {
    expect(layerPlanOf(JOB)?.elements.map((e) => e.name)).toEqual(['Headline'])
    expect(layerPlanOf({ calls: [] })).toBeNull()
  })
})

describe('frameLayers', () => {
  it('finds a frame’s split layers after the layers of the splits before it, and none while its split runs', () => {
    expect(frameLayers(JOB, { callIndex: 1 })).toEqual({
      first: 0,
      layers: [
        { width: 512, height: 512 },
        { width: 512, height: 512 },
      ],
    })
    expect(frameLayers(JOB, { callIndex: 3 })?.first).toBe(2)
    expect(frameLayers(JOB, { callIndex: 5 })).toBeNull()
  })
})

describe('layerName', () => {
  it('names a layer by the plan’s elements in it, else by its number', () => {
    const plan = layerPlanOf(JOB)
    expect(layerName(plan, 1, 'Layer')).toBe('Headline')
    expect(layerName(plan, 0, 'Layer')).toBe('Layer 1')
    expect(layerName(null, 2, 'Layer')).toBe('Layer 3')
  })
})

describe('visibleBox', () => {
  it('is the box of the pixels that show, and null when none does', () => {
    const alpha = new Uint8Array(4 * 3)
    alpha[1 * 4 + 1] = 255
    alpha[2 * 4 + 2] = 40
    expect(visibleBox(alpha, 4, 3)).toEqual({ x: 1, y: 1, width: 2, height: 2 })
    expect(visibleBox(new Uint8Array(12), 4, 3)).toBeNull()
  })
})

describe('scaleBox', () => {
  it('scales a box and grows it to whole pixels around it', () => {
    expect(scaleBox({ x: 100, y: 50, width: 200, height: 100 }, 512, 1080)).toEqual({
      x: 210,
      y: 105,
      width: 423,
      height: 212,
    })
  })
})

describe('pieceId', () => {
  it('comes from the job, the frame and the layer, at most 64 characters', () => {
    expect(pieceId('job', 'frame', 2)).toBe('job-frame-2')
    expect(pieceId('j'.repeat(40), 'f'.repeat(40), 12)).toHaveLength(64)
  })
})
