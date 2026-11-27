import { describe, expect, it } from 'vitest'

import type { LayerPlanAnswer } from '@dazbee/schema'

import { splitCall } from './layer-split.ts'

type Part = LayerPlanAnswer['elements'][number]

/** A planned part with id `id`, a text in split layer 1. */
const part = (id: string, over: Partial<Part> = {}): Part => ({
  id,
  kind: 'text',
  name: 'Headline',
  content: 'Fresh coffee',
  text_lines: ['Fresh coffee'],
  box: { x_min: 100, y_min: 80, x_max: 900, y_max: 200 },
  shadow: 'none',
  group: null,
  ming_layer: 1,
  ...over,
})

/** A layer plan of `elements`, with a prompt. */
const planOf = (elements: Part[], prompt = 'Decompose this image into 2 layers.'): LayerPlanAnswer => ({
  ad_type: 'graphical',
  elements,
  prompt,
  notes: [],
  design_name: 'Harbour',
})

const KEY = 'workspaces/w/originals/ad'

describe('splitCall', () => {
  it('sends the plan’s prompt and its parts as the split reads them', () => {
    const backdrop = part('b1', {
      kind: 'background',
      shadow: 'drop',
      ming_layer: 2,
      box: { x_min: 0, y_min: 0, x_max: 999, y_max: 999 },
    })
    expect(splitCall(KEY, 512, planOf([part('t1'), backdrop]))).toEqual({
      kind: 'layer-split',
      picture: KEY,
      size: 512,
      plan: 'Decompose this image into 2 layers.',
      parts: [
        { id: 't1', kind: 'text', shadow: 'none', layer: 1, box: { left: 100, top: 80, right: 900, bottom: 200 } },
        { id: 'b1', kind: 'background', shadow: 'drop', layer: 2, box: { left: 0, top: 0, right: 999, bottom: 999 } },
      ],
    })
  })

  it('sends 60 parts, and none of 61', () => {
    const parts = (count: number) => Array.from({ length: count }, (_, n) => part(`p${n}`))
    expect(splitCall(KEY, 1024, planOf(parts(60)))).toMatchObject({ parts: { length: 60 } })
    expect(splitCall(KEY, 1024, planOf(parts(61)))).not.toHaveProperty('parts')
  })

  it('sends no parts when an id is empty, overlong or there twice', () => {
    for (const elements of [[part('')], [part('x'.repeat(101))], [part('t1'), part('t1')]]) {
      const call = splitCall(KEY, 1024, planOf(elements))
      expect(call).toMatchObject({ kind: 'layer-split', plan: 'Decompose this image into 2 layers.' })
      expect(call).not.toHaveProperty('parts')
    }
  })

  it('sends neither a plan nor parts for a plan with no prompt', () => {
    expect(splitCall(KEY, 1024, planOf([part('t1')], '   '))).toEqual({ kind: 'layer-split', picture: KEY, size: 1024 })
  })
})
