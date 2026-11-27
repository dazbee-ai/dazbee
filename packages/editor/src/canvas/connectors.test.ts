import { describe, expect, it } from 'vitest'

import type { Design } from '@dazbee/schema'

import {
  ARROW_HALF_WIDTH,
  ARROW_LENGTH,
  arrowheadOf,
  connectorAt,
  type ConnectorCurve,
  connectorCurve,
  connectorsShown,
  END_GAP,
  endBoxes,
  frameEndBox,
  nearCurve,
} from './connectors.ts'
import { LABEL_ROOM } from './frames.ts'
import { outlineAround } from './sections.ts'

/** The point `t` of the way along a curve. */
function pointAlong({ from, c1, c2, to }: ConnectorCurve, t: number) {
  const u = 1 - t
  const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
  return { x: a * from.x + b * c1.x + c * c2.x + d * to.x, y: a * from.y + b * c1.y + c * c2.y + d * to.y }
}

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
    const outline = { id: 's', title: 'S', box: { x: 0, y: 400, width: 100, height: 100 }, scale: 1 }
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
    const boxes = endBoxes(
      FRAMES,
      [{ id: 's', title: 'S', box: { x: 1, y: 2, width: 3, height: 4 }, scale: 1 }],
      AT_ONE,
    )
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

  it('turns square over a visible stretch when the ends are far apart across but close along', () => {
    // A frame just right of a section and well above it: the curve leaves the frame's left side and
    // reaches the section's right side, both square, in a smooth S.
    const frame = { x: 650, y: 210, width: 337, height: 364 }
    const section = { x: 345, y: 545, width: 272, height: 285 }
    expect(connectorCurve(frame, section)).toEqual({
      from: { x: 644, y: 392 },
      c1: { x: 564, y: 392 },
      c2: { x: 703, y: 687.5 },
      to: { x: 623, y: 687.5 },
    })
    // Stacked, and far to the side: the same, down.
    const below = connectorCurve({ x: 0, y: 0, width: 100, height: 100 }, { x: 400, y: 140, width: 100, height: 100 })
    expect([below.from, below.to]).toEqual([
      { x: 106, y: 50 },
      { x: 394, y: 190 },
    ])
  })

  it('leaves and reaches the facing sides square when the boxes overlap', () => {
    const curve = connectorCurve(box(0, 0), box(50, 50))
    expect(curve.from).toEqual({ x: 106, y: 50 })
    expect(curve.to).toEqual({ x: 44, y: 100 })
    expect([curve.c1.y, curve.c2.y]).toEqual([50, 100])
    expect(curve.c1.x).toBeGreaterThan(curve.from.x)
    expect(curve.c2.x).toBeLessThan(curve.to.x)
  })

  it('goes round the outside, from and to the same side of both, when the ends overlap both ways', () => {
    // A frame beside a section, at its height, a little inside its outline: facing sides would send the
    // curve back through both.
    const frame = { x: 480, y: 100, width: 320, height: 200 }
    const section = { x: 0, y: 0, width: 500, height: 400 }
    expect(connectorCurve(frame, section)).toEqual({
      from: { x: 640, y: 306 },
      c1: { x: 640, y: 486 },
      c2: { x: 250, y: 486 },
      to: { x: 250, y: 406 },
    })
  })

  it('keeps a curve between ends close together, where a wider bend would cut into them', () => {
    // 10 apart: a bend of MIN_BEND would reach into both.
    const curve = connectorCurve(box(0, 0), box(110, 0))
    expect(curve).toEqual({
      from: { x: 106, y: 50 },
      c1: { x: 107, y: 50 },
      c2: { x: 103, y: 50 },
      to: { x: 104, y: 50 },
    })
  })

  it('never cuts through a frame or the section it joins, at any zoom', () => {
    // A frame just right of the section's bottom-right corner, at its height; the outline's padding
    // and the frame's label row are screen pixels, so how the two boxes meet changes with the zoom.
    const inside = { pageId: 'p', name: 'In', x: 0, y: 0, width: 1080, height: 1080 }
    const beside = { pageId: 'p', name: 'Beside', x: 1200, y: 1000, width: 1080, height: 1080 }
    for (const zoom of [0.13, 0.15, 0.24, 0.27, 0.43, 1, 2.61]) {
      const camera = { x: 0, y: 0, zoom }
      const section = outlineAround([{ ...inside, id: 'in' }], camera)
      if (!section) throw new Error('no outline')
      const frame = frameEndBox({ ...beside, id: 'beside' }, camera)
      for (const curve of [connectorCurve(frame, section), connectorCurve(section, frame)]) {
        for (let i = 0; i <= 200; i++) {
          const p = pointAlong(curve, i / 200)
          const within = (b: typeof frame) =>
            p.x > b.x + 0.5 && p.x < b.x + b.width - 0.5 && p.y > b.y + 0.5 && p.y < b.y + b.height - 0.5
          expect([zoom, within(frame), within(section)]).toEqual([zoom, false, false])
        }
      }
    }
  })
})

describe('arrowheadOf', () => {
  const frame = { x: 650, y: 210, width: 337, height: 364 }
  const section = { x: 345, y: 545, width: 272, height: 285 }

  it('points along the curve’s last stretch, its base on the curve ARROW_LENGTH back from the end', () => {
    for (const curve of [
      connectorCurve(frame, section),
      connectorCurve({ x: 0, y: 0, width: 100, height: 100 }, { x: 300, y: 40, width: 100, height: 100 }),
      connectorCurve({ x: 0, y: 0, width: 100, height: 100 }, { x: 30, y: 400, width: 100, height: 100 }),
    ]) {
      const { head } = arrowheadOf(curve)
      const base = { x: (head.left.x + head.right.x) / 2, y: (head.left.y + head.right.y) / 2 }
      expect(head.tip).toEqual(curve.to)
      expect(Math.hypot(head.tip.x - base.x, head.tip.y - base.y)).toBeCloseTo(ARROW_LENGTH, 5)
      expect(nearCurve(curve, base, 0.5)).toBe(true)
      expect(Math.hypot(head.left.x - head.right.x, head.left.y - head.right.y)).toBeCloseTo(2 * ARROW_HALF_WIDTH, 5)
    }
  })

  it('gives the line up to the head’s base, so it never shows through the head', () => {
    const curve = connectorCurve(frame, section)
    const { head, line } = arrowheadOf(curve)
    const base = { x: (head.left.x + head.right.x) / 2, y: (head.left.y + head.right.y) / 2 }
    expect(line.from).toEqual(curve.from)
    expect(line.to.x).toBeCloseTo(base.x, 2)
    expect(line.to.y).toBeCloseTo(base.y, 2)
  })

  it('takes the whole of a curve shorter than the head', () => {
    const curve = { from: { x: 0, y: 0 }, c1: { x: 1, y: 0 }, c2: { x: 2, y: 0 }, to: { x: 3, y: 0 } }
    expect(arrowheadOf(curve).line.to).toEqual(curve.from)
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
