import { describe, expect, it } from 'vitest'

import type { Design } from '@dazbee/schema'

import {
  arrowAngle,
  connectorAt,
  connectorCurve,
  connectorsShown,
  END_GAP,
  endBoxes,
  frameEndBox,
  nearCurve,
} from './connectors.ts'
import { LABEL_ROOM } from './frames.ts'

/** Two 100 square frames side by side on page p1, a third on page p2, and connectors between them. */
const FRAMES = [
  { id: 'a', pageId: 'p1', name: 'A', x: 0, y: 0, width: 100, height: 100 },
  { id: 'b', pageId: 'p1', name: 'B', x: 300, y: 0, width: 100, height: 100 },
]
const AT_ONE = { x: 0, y: 0, zoom: 1 }
const design = (connectors: Record<string, { from: string; to: string }>) =>
  ({
    frames: {
      a: { ...FRAMES[0], order: 'a0' },
      b: { ...FRAMES[1], order: 'a1' },
      c: { pageId: 'p2', name: 'C', x: 0, y: 0, width: 100, height: 100, order: 'a2' },
    },
    sections: { s: { pageId: 'p1', title: 'S', order: 'a0' } },
    connectors: Object.fromEntries(
      Object.entries(connectors).map(([id, ends], i) => [id, { pageId: 'p1', order: `a${i}`, ...ends }]),
    ),
  }) as unknown as Design

describe('connectorsShown', () => {
  it('gives the shown page’s connectors with both ends drawn, by order, each curved between its ends’ boxes', () => {
    const shown = connectorsShown(
      design({ ab: { from: 'a', to: 'b' }, gone: { from: 'a', to: 'x' } }),
      FRAMES,
      [],
      AT_ONE,
    )
    expect(shown.map((c) => c.id)).toEqual(['ab'])
    expect(shown[0]?.curve.from).toEqual({ x: 100 + END_GAP, y: (100 - LABEL_ROOM) / 2 })
  })

  it('takes a section’s end from its outline as drawn', () => {
    const outline = { id: 's', title: 'S', box: { x: 0, y: 400, width: 100, height: 100 } }
    const withSection = {
      ...design({ as: { from: 'a', to: 's' } }),
      frames: { ...design({}).frames, b: { ...FRAMES[1], order: 'a1', sectionId: 's' } },
    } as unknown as Design
    const [shown] = connectorsShown(withSection, FRAMES, [outline], AT_ONE)
    expect(shown?.curve.to).toEqual({ x: 50, y: 400 - END_GAP })
  })

  it('gives none on a page with no frames', () => {
    expect(connectorsShown(design({ ab: { from: 'a', to: 'b' } }), [], [], AT_ONE)).toEqual([])
  })
})

describe('endBoxes', () => {
  it('gives each frame’s box with its label’s row and each outline’s box, by id', () => {
    const boxes = endBoxes(FRAMES, [{ id: 's', title: 'S', box: { x: 1, y: 2, width: 3, height: 4 } }], AT_ONE)
    expect([...boxes.keys()]).toEqual(['a', 'b', 's'])
    expect(boxes.get('s')).toEqual({ x: 1, y: 2, width: 3, height: 4 })
  })
})

describe('frameEndBox', () => {
  it('is the frame on the stage with its label’s row above it, at any zoom', () => {
    const frame = FRAMES[1]
    if (!frame) throw new Error('no frame')
    expect(frameEndBox(frame, { x: 10, y: 20, zoom: 0.5 })).toEqual({
      x: 160,
      y: 20 - LABEL_ROOM,
      width: 50,
      height: 50 + LABEL_ROOM,
    })
  })
})

describe('connectorCurve', () => {
  const box = (x: number, y: number) => ({ x, y, width: 100, height: 100 })

  it('runs horizontally between the facing sides of ends side by side, either way', () => {
    expect(connectorCurve(box(0, 0), box(300, 40))).toEqual({
      from: { x: 106, y: 50 },
      c1: { x: 200, y: 50 },
      c2: { x: 200, y: 90 },
      to: { x: 294, y: 90 },
    })
    const back = connectorCurve(box(300, 40), box(0, 0))
    expect([back.from, back.to]).toEqual([
      { x: 294, y: 90 },
      { x: 106, y: 50 },
    ])
  })

  it('runs vertically between the facing sides of stacked ends, either way', () => {
    expect(connectorCurve(box(0, 0), box(30, 400))).toEqual({
      from: { x: 50, y: 106 },
      c1: { x: 50, y: 250 },
      c2: { x: 80, y: 250 },
      to: { x: 80, y: 394 },
    })
    const up = connectorCurve(box(30, 400), box(0, 0))
    expect([up.from, up.to]).toEqual([
      { x: 80, y: 394 },
      { x: 50, y: 106 },
    ])
  })

  it('takes the sides of the wider gap when the ends are apart both ways', () => {
    const curve = connectorCurve(box(0, 0), box(400, 150))
    expect([curve.from, curve.to]).toEqual([
      { x: 106, y: 50 },
      { x: 394, y: 200 },
    ])
  })

  it('still bends between ends close together', () => {
    const curve = connectorCurve(box(0, 0), box(110, 0))
    expect(curve.c1.x - curve.from.x).toBe(24)
  })
})

describe('arrowAngle', () => {
  it('points along the curve where it reaches its end', () => {
    const right = connectorCurve({ x: 0, y: 0, width: 10, height: 10 }, { x: 100, y: 50, width: 10, height: 10 })
    expect(arrowAngle(right)).toBe(0)
    const down = connectorCurve({ x: 0, y: 0, width: 10, height: 10 }, { x: 0, y: 100, width: 10, height: 10 })
    expect(arrowAngle(down)).toBeCloseTo(Math.PI / 2)
  })
})

describe('nearCurve', () => {
  const curve = connectorCurve({ x: 0, y: 0, width: 100, height: 100 }, { x: 300, y: 200, width: 100, height: 100 })

  it('takes a point within 6 screen pixels of the curve, and not one further off', () => {
    expect(nearCurve(curve, { x: 106, y: 55 })).toBe(true)
    expect(nearCurve(curve, { x: 106, y: 57 })).toBe(false)
    // Across the curve's middle, (200, 150), where it runs steeply down.
    expect(nearCurve(curve, { x: 203.6, y: 148.3 })).toBe(true)
    expect(nearCurve(curve, { x: 207.2, y: 146.6 })).toBe(false)
  })
})

describe('connectorAt', () => {
  it('gives the last connector by order near a point, or none', () => {
    const curve = connectorCurve({ x: 0, y: 0, width: 100, height: 100 }, { x: 300, y: 0, width: 100, height: 100 })
    const shown = [
      { id: 'first', from: 'a', to: 'b', curve },
      { id: 'second', from: 'b', to: 'a', curve },
    ]
    expect(connectorAt(shown, { x: 200, y: 52 })?.id).toBe('second')
    expect(connectorAt(shown, { x: 200, y: 80 })).toBeUndefined()
  })
})
