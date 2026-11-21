import { describe, expect, it } from 'vitest'

import { type Layer, Layer as LayerSchema } from '@dazbee/schema'

import { patternSteps } from './batch.ts'
import type { PatternLayers } from './types.ts'

/** A pattern's layers at one size: a background and a headline, each id and link id its part. */
const layers = (): PatternLayers => {
  const node = (key: string, type: 'graphic' | 'text', index: string): Layer =>
    LayerSchema.parse({
      type,
      name: key,
      parentId: 'frame',
      link: key,
      index,
      props:
        type === 'text'
          ? {
              x: 0,
              y: 0,
              width: 10,
              height: 10,
              text: 'Hi',
              style: { fontFamily: 'Outfit', fontSize: 40, color: '#000000FF' },
            }
          : { x: 0, y: 0, width: 10, height: 10, shape: { kind: 'rect' } },
    })
  return {
    nodes: { background: node('background', 'graphic', 'a0'), headline: node('headline', 'text', 'a1') },
    roots: ['background', 'headline'],
  }
}

describe('patternSteps', () => {
  it('adds a frame for each size without one and places its layers, each part with one new link id across the sizes', () => {
    let next = 0
    const steps = patternSteps(
      'p1',
      [
        { frame: { width: 300, height: 250, frameId: 'empty' }, layers: layers() },
        { frame: { width: 1080, height: 1920 }, layers: layers() },
      ],
      () => `new${next++}`,
    )
    expect(steps.map(({ command, as }) => [command, as])).toEqual([
      ['design.place', 'layers-1'],
      ['frame.add', 'frame-2'],
      ['design.place', 'layers-2'],
    ])
    expect(steps[1]?.input).toEqual({ pageId: 'p1', name: '1080 × 1920', width: 1080, height: 1920 })
    const placed = (i: number) =>
      steps[i]?.input as { parentId: unknown; keepLinksFrom: string; tree: PatternLayers; withIds: true }
    expect(placed(0).parentId).toBe('empty')
    expect(placed(2).parentId).toEqual({ $ref: 'frame-2' })
    expect(placed(0).keepLinksFrom).toBe('p1')
    const links = (i: number) =>
      Object.fromEntries(Object.entries(placed(i).tree.nodes).map(([part, n]) => [part, n.link]))
    expect(links(0)).toEqual({ background: 'new0', headline: 'new1' })
    expect(links(2)).toEqual(links(0))
  })
})
