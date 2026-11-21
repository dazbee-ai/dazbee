// Shadows whose spread follows the layer's outline: measured on the CPU render, as exports draw
// them.
import { describe, expect, it } from 'vitest'

import {
  alphaAt,
  at200,
  BLACK,
  costsLine,
  covered,
  cutout,
  draw,
  expectNear,
  graphic,
  hash,
  largestDifference,
  photo,
  pixel,
  reach,
  shadow,
  slower,
  solid,
  WHITE,
} from './test-shadows.ts'

/**
 * The most times longer a spread may take to draw than spread 0: about twice the most measured on
 * CI runners under the whole suite's load (cards 1.53, the path 2.58; the PR gives the numbers), and
 * well under what drawing the spread by its pixels (cards 23, the path 104) or the path's by path
 * ops (113) measured.
 */
const SPREAD_COST = 5

describe('drawDropShadow', () => {
  it('grows an ellipse by the spread on its diagonal, not by the corner of a square', () => {
    const r = draw([graphic({ kind: 'ellipse' }, { ...at200, effects: [shadow(20)] })])
    expectNear(reach(r, 300, 300, -1, -1), 120)
  })

  it('grows a rounded corner round, from the centre of its arc', () => {
    const r = draw([graphic({ kind: 'rect', cornerRadius: 40 }, { ...at200, effects: [shadow(20)] })])
    expectNear(reach(r, 240, 240, -1, -1), 60)
  })

  it("grows a star's points along their edges, mitred", () => {
    const r = draw([graphic({ kind: 'star' }, { ...at200, effects: [shadow(10)] })])
    expect(reach(r, 300, 200, 0, -1)).toBeGreaterThanOrEqual(30)
  })

  it('shrinks an ellipse by the spread on its diagonal', () => {
    const r = draw(
      [graphic({ kind: 'ellipse' }, { x: 100, y: 200, width: 200, height: 200, effects: [shadow(-20, { x: 400 })] })],
      {
        width: 900,
        height: 600,
      },
    )
    expectNear(reach(r, 600, 300, -1, -1), 80)
  })

  it('shrinks overlapping contours of one path by their outline, not by their inner edges', () => {
    const circle = (cx: number) => `M${cx - 100} 100 A100 100 0 1 0 ${cx + 100} 100 A100 100 0 1 0 ${cx - 100} 100 Z`
    const r = draw(
      [
        graphic(
          { kind: 'path', d: `${circle(100)} ${circle(220)}` },
          { x: 100, y: 100, width: 320, height: 200, effects: [shadow(-20, { y: 300 })] },
        ),
      ],
      { width: 600, height: 700 },
    )
    // 10 inside the first circle's right edge, which lies inside the second.
    expect(alphaAt(r, 290, 500)).toBeGreaterThan(250)
    expectNear(reach(r, 200, 500, -1, -1), 80)
  })

  it('grows an open path past the edge that closes it', () => {
    const r = draw([
      graphic(
        { kind: 'path', d: 'M0 0 L200 0 L100 170' },
        { x: 200, y: 200, width: 200, height: 170, effects: [shadow(20)] },
      ),
    ])
    // From the middle of the closing edge, out along its normal.
    expectNear(reach(r, 250, 285, -170, 100), 20)
  })

  it("grows a ring's hole shut where the spread passes the hole's radius, leaving no hole at its centre", () => {
    const circle = (r: number) => `M${80 - r} 80 A${r} ${r} 0 1 0 ${80 + r} 80 A${r} ${r} 0 1 0 ${80 - r} 80 Z`
    const ring = (spread: number) =>
      draw(
        [
          graphic(
            { kind: 'path', d: `${circle(80)} ${circle(20)}`, fillRule: 'evenodd' },
            { x: 40, y: 40, width: 160, height: 160, effects: [shadow(spread, { x: 300 })] },
          ),
        ],
        { width: 600, height: 240 },
      )
    for (const spread of [25, 30, 40]) {
      const r = ring(spread)
      // The shadow's centre, and around it as far as the hole's radius less the spread would leave.
      for (const [x, y] of [
        [420, 120],
        [430, 120],
        [420, 135],
      ] as const)
        expect([spread, x, y, alphaAt(r, x, y)]).toEqual([spread, x, y, 255])
    }
  })

  it('grows a stroked ring with no fill shut where the grown stroke passes its centre', () => {
    const r = draw(
      [
        graphic(
          { kind: 'ellipse' },
          {
            x: 80,
            y: 80,
            width: 40,
            height: 40,
            fills: [],
            strokes: [{ paint: solid(BLACK), width: 10 }],
            effects: [shadow(40, { x: 200 })],
          },
        ),
      ],
      { width: 500, height: 200 },
    )
    expect(alphaAt(r, 300, 100)).toBe(255)
  })

  it("casts nothing once a shrink passes half the shape's shorter side", () => {
    const shrunk = (shape: Record<string, unknown>, spread: number) =>
      covered(
        draw([graphic(shape, { x: 50, y: 50, width: 100, height: 100, effects: [shadow(spread, { x: 200 })] })], {
          width: 400,
          height: 200,
        }),
        200,
        0,
        200,
        200,
      )
    expect([
      shrunk({ kind: 'ellipse' }, -100),
      shrunk({ kind: 'ellipse' }, -55),
      shrunk({ kind: 'rect', cornerRadius: 20 }, -200),
    ]).toEqual([0, 0, 0])
  })

  it("grows an open stroke's butt ends past them by the spread", () => {
    const r = draw(
      [
        graphic(
          { kind: 'path', d: 'M0 10 L200 10' },
          {
            x: 100,
            y: 50,
            width: 200,
            height: 20,
            fills: [],
            strokes: [{ paint: solid(BLACK), width: 10 }],
            effects: [shadow(20, { y: 100 })],
          },
        ),
      ],
      { width: 400, height: 300 },
    )
    expectNear(reach(r, 300, 160, 1, 0), 20)
    expectNear(reach(r, 100, 160, -1, 0), 20)
  })

  it("keeps a translucent fill's shadow as strong at spread 1 as at 0", () => {
    const at = (spread: number) =>
      draw(
        [
          graphic(
            { kind: 'rect' },
            {
              x: 100,
              y: 100,
              width: 200,
              height: 200,
              fills: [solid('#FF0000FF', 0.5)],
              effects: [shadow(spread, { x: 300 })],
            },
          ),
        ],
        { width: 700, height: 400 },
      )
    const [zero, one] = [at(0), at(1)]
    for (const [x, y] of [
      [500, 200],
      [401, 101],
      [598, 298],
    ] as const) {
      expect(Math.abs((pixel(one, x, y)[3] ?? 0) - (pixel(zero, x, y)[3] ?? 0))).toBeLessThanOrEqual(1)
    }
  })

  it('spreads a turned rounded card round', () => {
    const card = { x: 200, y: 200, width: 260, height: 160, rotation: -10 }
    const r = draw([graphic({ kind: 'rect', cornerRadius: 20 }, { ...card, effects: [shadow(10)] })], {
      width: 700,
      height: 600,
    })
    const turn = (-10 * Math.PI) / 180
    const [cx, cy] = [card.x + card.width / 2, card.y + card.height / 2]
    const [px, py] = [card.x + 20 - cx, card.y + 20 - cy]
    const corner = [
      cx + px * Math.cos(turn) - py * Math.sin(turn),
      cy + px * Math.sin(turn) + py * Math.cos(turn),
    ] as const
    const [dx, dy] = [-Math.cos(turn) + Math.sin(turn), -Math.sin(turn) - Math.cos(turn)]
    expectNear(reach(r, corner[0], corner[1], dx, dy), 30)
  })

  it("never cuts a star's shadow: the same with a clear shadow that reaches far further", () => {
    const star = (effects: unknown[]) => draw([graphic({ kind: 'star' }, { ...at200, effects })])
    const alone = star([shadow(10)])
    const widened = star([shadow(10), shadow(40, { color: '#00000000' })])
    expect(largestDifference(alone, widened)).toBe(0)
  })

  it('spreads an opaque photo covering a rounded card along its outline', () => {
    const r = draw(
      [
        graphic(
          { kind: 'rect', cornerRadius: 40 },
          { ...at200, fills: [{ type: 'image', assetId: 'photo', fit: 'fill' }], effects: [shadow(20)] },
        ),
      ],
      undefined,
      { photo },
    )
    expectNear(reach(r, 240, 240, -1, -1), 60)
  })

  it('draws the same bytes as before at spread 0, and for groups, text, cutouts and sharp rects at whole spreads', () => {
    // Shown behind the layers that aren't opaque, so no layer hides its own shadow and the bytes stay pinned.
    const zero = draw(
      [
        graphic(
          { kind: 'rect', cornerRadius: 30 },
          {
            x: 40,
            y: 40,
            width: 160,
            height: 120,
            effects: [shadow(0, { x: 8, y: 12, blur: 16, color: '#00000088' })],
          },
        ),
        graphic(
          { kind: 'ellipse' },
          {
            x: 260,
            y: 40,
            width: 160,
            height: 120,
            fills: [solid('#3366CCFF', 0.5)],
            effects: [shadow(0, { x: -6, y: 10, blur: 6, showBehind: true })],
          },
        ),
        graphic(
          { kind: 'star' },
          {
            x: 40,
            y: 220,
            width: 160,
            height: 160,
            effects: [{ type: 'glow', blur: 20, spread: 0, color: '#FF8800CC' }],
          },
        ),
        graphic(
          { kind: 'path', d: 'M0 0 L160 40 L40 160 Z' },
          {
            x: 260,
            y: 220,
            width: 160,
            height: 160,
            strokes: [{ paint: solid('#226622FF'), width: 10, align: 'outside' }],
            effects: [shadow(0, { x: 10, y: 10, blur: 10, color: '#00000066' })],
          },
        ),
      ],
      { width: 480, height: 420, fills: [solid('#F0F0E0FF')] },
    )
    const group = draw(
      [
        {
          type: 'group',
          props: {
            x: 100,
            y: 100,
            width: 300,
            height: 200,
            effects: [shadow(6, { x: 10, y: 14, blur: 12, color: '#00000099', showBehind: true })],
          },
          children: [
            graphic({ kind: 'ellipse' }, { x: 100, y: 100, width: 180, height: 180, fills: [solid('#7B1FA2FF')] }),
            graphic({ kind: 'rect' }, { x: 240, y: 160, width: 160, height: 140, fills: [solid('#FFB300FF')] }),
          ],
        },
      ],
      { width: 500, height: 400, fills: [solid(WHITE)] },
    )
    const text = draw(
      [
        {
          type: 'text',
          props: {
            x: 40,
            y: 60,
            width: 420,
            height: 120,
            text: 'Spread',
            style: { fontFamily: 'Noto Sans', fontSize: 96, fontWeight: 800, color: '#D81B60FF' },
            effects: [shadow(4, { x: 6, y: 8, blur: 8, color: '#00000099' })],
          },
        },
      ],
      { width: 500, height: 240, fills: [solid(WHITE)] },
    )
    const png = draw(
      [
        graphic(
          { kind: 'rect' },
          {
            ...at200,
            fills: [{ type: 'image', assetId: 'cutout', fit: 'fill' }],
            effects: [shadow(8, { y: 10, blur: 10, color: '#000000AA', showBehind: true })],
          },
        ),
      ],
      { width: 600, height: 600, fills: [solid(WHITE)] },
      { cutout },
    )
    const sharp = draw(
      [
        graphic(
          { kind: 'rect' },
          {
            ...at200,
            fills: [solid('#43A047FF')],
            effects: [shadow(10, { x: 20, y: 30, blur: 12, color: '#1B5E20AA' })],
          },
        ),
      ],
      { width: 600, height: 600, fills: [solid(WHITE)] },
    )
    expect([zero, group, text, png, sharp].map(hash)).toEqual([
      '1720e890be47f0f0',
      '15e701ca9e2147f4',
      '6378e9282411a3be',
      '8f8e5eec88004c88',
      '29097f935cd9ee9c',
    ])
  }, 30_000)

  it('costs a few times spread 0 at most: 40 rounded cards, and a path of 3000 segments at spread 75', () => {
    const cards = (spread: number) =>
      Array.from({ length: 40 }, (_, i) =>
        graphic(
          { kind: 'rect', cornerRadius: 10 },
          {
            x: 20 + (i % 8) * 52,
            y: 20 + Math.floor(i / 8) * 70,
            width: 40,
            height: 40,
            fills: [solid('#3F51B5FF')],
            effects: [shadow(spread, { y: 4, blur: 8, color: '#00000066' })],
          },
        ),
      )
    // A wavy ring 3000 segments round, in a 400 × 400 frame.
    const wavy = (() => {
      const points: string[] = []
      for (let i = 0; i < 3000; i++) {
        const a = (i / 3000) * 2 * Math.PI
        const r = 111 + 7.4 * Math.sin(a * 60)
        points.push(`${(200 + r * Math.cos(a)).toFixed(2)} ${(200 + r * Math.sin(a)).toFixed(2)}`)
      }
      return `M${points.join(' L')} Z`
    })()
    const path = (spread: number) => [
      graphic(
        { kind: 'path', d: wavy },
        { x: 0, y: 0, width: 400, height: 400, effects: [shadow(spread, { blur: 10 })] },
      ),
    ]
    const costs = {
      cards: slower(cards(4), cards(0), { width: 436, height: 370, fills: [solid(WHITE)] }),
      path: slower(path(75), path(0), { width: 400, height: 400 }),
    }
    console.info(costsLine(costs))
    for (const [name, cost] of Object.entries(costs)) expect(cost.times, name).toBeLessThan(SPREAD_COST)
  }, 60_000)
})

describe('drawInnerShadow', () => {
  it('casts a translucent fill its shadow along its edges only', () => {
    const r = draw(
      [
        graphic(
          { kind: 'rect' },
          {
            x: 100,
            y: 100,
            width: 200,
            height: 200,
            fills: [solid('#FF0000FF', 0.5)],
            effects: [{ type: 'innerShadow', x: 0, y: 0, blur: 20, spread: 0, color: BLACK }],
          },
        ),
      ],
      { width: 400, height: 400, fills: [solid(WHITE)] },
    )
    const [red = 0, green = 0, blue = 0] = pixel(r, 200, 200)
    expect(red).toBeGreaterThanOrEqual(254)
    expect(Math.abs(green - 127.5)).toBeLessThanOrEqual(1)
    expect(Math.abs(blue - 127.5)).toBeLessThanOrEqual(1)
    expect(pixel(r, 101, 200)[0]).toBeLessThan(200)
  })

  it("shadows the whole inside once the spread passes half the shape's shorter side", () => {
    const inner = (spread: number) =>
      draw(
        [
          graphic(
            { kind: 'ellipse' },
            {
              x: 50.5,
              y: 50.5,
              width: 100,
              height: 100,
              effects: [{ type: 'innerShadow', x: 0, y: 0, blur: 0, spread, color: BLACK }],
            },
          ),
        ],
        { width: 200, height: 200, fills: [solid(WHITE)] },
      )
    // The centre pixel's red, as the white fill shows through: 255 clear of the shadow, 0 under it.
    expect([45, 60, 100].map((spread) => pixel(inner(spread), 100, 100)[0])).toEqual([255, 0, 0])
  })

  it('draws the same bytes as before for opaque layers at spread 0, and a sharp rect as its pixels cast it at any', () => {
    const effects = (spread: number) => [{ type: 'innerShadow', x: 4, y: 6, blur: 10, spread, color: '#000000B0' }]
    const frame = { width: 440, height: 360, fills: [solid(WHITE)] }
    const box = { x: 100, y: 100, width: 240, height: 160 }
    const layer = (shape: Record<string, unknown>, props: Record<string, unknown>) =>
      graphic(shape, { ...box, fills: [solid('#4FC3F7FF')], ...props })
    const shapes = [{ kind: 'rect', cornerRadius: 24 }, { kind: 'ellipse' }, { kind: 'star' }, { kind: 'rect' }]
    expect(shapes.map((shape) => hash(draw([layer(shape, { effects: effects(0) })], frame)))).toEqual([
      'ca2770219899b63c',
      'a2580a8edbb2a072',
      'c0f60f3edeb0cf8e',
      'ac860f0249d973b5',
    ])
    // Its outline, shrunk, against a group of it, which casts from its pixels, spread square.
    const sharp = { kind: 'rect' }
    expect(
      largestDifference(
        draw([layer(sharp, { effects: effects(6) })], frame),
        draw([{ type: 'group', props: { ...box, effects: effects(6) }, children: [layer(sharp, {})] }], frame),
      ),
    ).toBeLessThanOrEqual(1)
  })
})
