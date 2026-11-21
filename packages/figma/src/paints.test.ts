import { describe, expect, it } from 'vitest'

import { apply, type Matrix } from '@dazbee/svg'

import { angularPaint, linearPaint, ovalOf, radialPaint } from './paints.ts'
import { box, frame, onePage, outline, rectangle, solid, type TestNode, vector } from './test-figma.ts'
import { built, imported, layersOf, linesOf, onlyFrame } from './test-import.ts'

type P = { x: number; y: number }

const inFrame = (children: TestNode[]) => onePage([frame('1:1', box(0, 0, 400, 300), children)])
const rectWith = (extra: Record<string, unknown>) => inFrame([rectangle('1:2', box(0, 0, 400, 200), extra)])
const propsOf = (text: string) => layersOf(onlyFrame(text))['1-2']?.props as Record<string, unknown>
const itemsOf = (text: string) => imported(text).converted.report.items.map((i) => [i.line, i.count])
const stops = [
  { offset: 0, color: '#FF0000FF' },
  { offset: 1, color: '#0000FFFF' },
]
const pt = (x: number, y: number): P => ({ x, y })
/** The 9 points of a 3 × 3 grid across the unit box. */
const SAMPLES = [0, 0.5, 1].flatMap((x) => [0, 0.5, 1].map((y) => pt(x, y)))
const REF = 'a'.repeat(40)
const SQUARE = 'M0 0L20 0L20 10L0 10Z'
/** A matrix placing a 20 × 10 node at (10, 10), skewed so its bottom edge runs 10 px further right. */
const SKEWED: Matrix = [1, 0, 1, 1, 10, 10]

/** A Figma gradient of `type` with `handles` in the node's unit box, its stops out of order. */
const gradient = (type: string, handles: P[], extra: Record<string, unknown> = {}) => ({
  type,
  gradientHandlePositions: handles,
  gradientStops: [
    { position: 1, color: { r: 0, g: 0, b: 1, a: 1 } },
    { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
  ],
  ...extra,
})

describe('paintLayer', () => {
  it('makes a solid its #RRGGBBAA colour, keeping the paint’s opacity as its opacity', () => {
    const color = { r: 1, g: 0.5, b: 0, a: 0.25 }
    const props = propsOf(rectWith({ fills: [{ type: 'SOLID', color, opacity: 0.5 }] }))
    expect(props.fills).toEqual([{ type: 'solid', color: '#FF800040', opacity: 0.5 }])
  })

  it('maps a gradient from its handles in the node’s unit box, its stops in order, and keeps a hidden paint hidden', () => {
    const linear = gradient('GRADIENT_LINEAR', [pt(0, 0.5), pt(1, 0.5), pt(0, 1)], { visible: false })
    expect(propsOf(rectWith({ fills: [linear] })).fills).toEqual([
      { type: 'linear', from: { x: 0, y: 0.5 }, to: { x: 1, y: 0.5 }, stops, visible: false },
    ])
  })

  it('takes a gradient’s handles into the layer’s unit box as its geometry places them', () => {
    const linear = gradient('GRADIENT_LINEAR', [pt(0, 1), pt(1, 1), pt(0, 0)])
    const text = inFrame([vector('1:2', SKEWED, 20, 10, { fillGeometry: [outline(SQUARE)], fills: [linear] })])
    const handles = built(text).paints['1-2']?.handles as Matrix
    expect(propsOf(text).fills).toMatchObject([{ type: 'linear', from: apply(handles, 0, 1) }])
  })

  it('draws a diamond as the radial through its handles, reported', () => {
    const diamond = gradient('GRADIENT_DIAMOND', [pt(0.5, 0.5), pt(1, 0.5), pt(0.5, 1)])
    const text = rectWith({ fills: [diamond] })
    expect(propsOf(text).fills).toMatchObject([{ type: 'radial', center: { x: 0.5, y: 0.5 } }])
    expect(linesOf(text)).toEqual(['diamond-gradients', 'radial-ovals-round'])
  })

  it('reports a paint blended in another way than normal, drawing it normal', () => {
    const text = rectWith({
      fills: [
        { ...solid('#ff0000'), blendMode: 'MULTIPLY' },
        { ...solid('#00ff00'), blendMode: 'NORMAL' },
      ],
    })
    expect(propsOf(text).fills).toHaveLength(2)
    expect(linesOf(text)).toEqual(['paint-blend-modes'])
  })

  it('leaves out each paint type Dazbee has no paint for, and paints it can’t read, each with its line', () => {
    const fills = [
      { type: 'EMOJI' },
      { type: 'VIDEO' },
      { type: 'PATTERN' },
      { type: 'GRADIENT_SPARKLE' },
      { color: { r: 1, g: 0, b: 0 } },
      { type: 'SOLID' },
      { type: 'GRADIENT_LINEAR', gradientStops: [] },
      'junk',
      { type: 'IMAGE', imageRef: '__proto__' },
      { type: 'IMAGE' },
    ]
    const text = rectWith({ fills })
    expect(propsOf(text).fills).toEqual([])
    expect(itemsOf(text)).toEqual([
      ['emoji-paints', 1],
      ['video-paints', 1],
      ['pattern-paints', 1],
      ['unknown-paints', 1],
      ['unreadable-paints', 4],
      ['missing-images', 2],
    ])
  })

  describe('image fills', () => {
    const image = (extra: Record<string, unknown> = {}) => ({ type: 'IMAGE', imageRef: REF, scaleMode: 'FILL', ...extra })
    const fillOf = (extra: Record<string, unknown>) => (propsOf(rectWith({ fills: [image(extra)] })).fills as unknown[])[0]

    it('keys an image fill by its imageRef, covering, fitting or tiling as Figma does', () => {
      expect(fillOf({ opacity: 0.5 })).toEqual({ type: 'image', assetId: REF, fit: 'fill', opacity: 0.5 })
      expect(fillOf({ scaleMode: 'FIT' })).toEqual({ type: 'image', assetId: REF, fit: 'fit', opacity: 1 })
      expect(fillOf({ scaleMode: 'TILE', scalingFactor: 0.5 })).toEqual({
        type: 'image',
        assetId: REF,
        fit: 'tile',
        tileScale: 0.5,
        opacity: 1,
      })
      expect(imported(rectWith({ fills: [image(), image()] })).imageRefs).toEqual([REF])
    })

    it('brings a tile’s scale within the sizes a tile can be, reported', () => {
      const text = rectWith({
        fills: [image({ scaleMode: 'TILE', scalingFactor: 40 }), image({ scaleMode: 'TILE', scalingFactor: 0 })],
      })
      expect((propsOf(text).fills as { tileScale: number }[]).map((f) => f.tileScale)).toEqual([10, 0.01])
      expect(itemsOf(text)).toEqual([['tile-scales-clamped', 2]])
    })

    it('keeps a stretched image’s transform as a crop in shares of the image, for withImages to size', () => {
      const imageTransform = [
        [0.5, 0, 0.25],
        [0, 0.4, 0.1],
      ]
      expect(fillOf({ scaleMode: 'STRETCH', imageTransform })).toEqual({
        type: 'image',
        assetId: REF,
        fit: 'crop',
        crop: { x: 0.25, y: 0.1, width: 0.5, height: 0.4 },
        opacity: 1,
      })
      expect(fillOf({ scaleMode: 'STRETCH' })).toMatchObject({ fit: 'crop', crop: { x: 0, y: 0, width: 1, height: 1 } })
    })

    it('covers the layer with a stretched image whose transform turns or mirrors it, reported', () => {
      const turned = [
        [0, 1, 0],
        [-1, 0, 1],
      ]
      const mirrored = [
        [-1, 0, 1],
        [0, 1, 0],
      ]
      const text = rectWith({
        fills: [
          image({ scaleMode: 'STRETCH', imageTransform: turned }),
          image({ scaleMode: 'STRETCH', imageTransform: mirrored }),
        ],
      })
      expect((propsOf(text).fills as { fit: string }[]).map((f) => f.fit)).toEqual(['fill', 'fill'])
      expect(itemsOf(text)).toEqual([['stretched-images-turned', 2]])
    })

    it('takes exposure, contrast, saturation, temperature and tint × 100 into adjust, and reports highlights and shadows', () => {
      const filters = { exposure: 0.5, contrast: -0.25, saturation: 1, temperature: -1, tint: 0.3, highlights: 0.2 }
      const text = rectWith({ fills: [image({ filters })] })
      expect((propsOf(text).fills as { adjust: unknown }[])[0]?.adjust).toEqual({
        exposure: 50,
        contrast: -25,
        saturation: 100,
        temperature: -100,
        tint: 30,
      })
      expect(linesOf(text)).toEqual(['image-highlights-shadows'])
      expect(fillOf({ filters: { exposure: 0, shadows: 0 } })).not.toHaveProperty('adjust')
    })

    it('reports a turned image and a GIF', () => {
      const text = rectWith({
        fills: [image({ rotation: 90 }), image({ rotation: 360 }), image({ gifRef: 'b'.repeat(40) })],
      })
      expect(propsOf(text).fills).toHaveLength(3)
      expect(linesOf(text)).toEqual(['image-rotations', 'gif-images'])
    })

    it('reports an image on a skewed shape, drawn unskewed', () => {
      const text = inFrame([vector('1:2', SKEWED, 20, 10, { fillGeometry: [outline(SQUARE)], fills: [image()] })])
      expect(linesOf(text)).toEqual(['skewed-images'])
    })
  })
})

describe('linearPaint', () => {
  // Figma's value at p: p = start + s·(end − start) + r·(width − start), and the value is s.
  const figmaValue = (h: { start: P; end: P; width: P }, p: P) => {
    const a = { x: h.end.x - h.start.x, y: h.end.y - h.start.y }
    const u = { x: h.width.x - h.start.x, y: h.width.y - h.start.y }
    const d = { x: p.x - h.start.x, y: p.y - h.start.y }
    return (d.x * u.y - d.y * u.x) / (a.x * u.y - a.y * u.x)
  }
  // Dazbee's value at p: its projection on from → to in the unit box.
  const dazbeeValue = (from: P, to: P, p: P) => {
    const t = { x: to.x - from.x, y: to.y - from.y }
    return ((p.x - from.x) * t.x + (p.y - from.y) * t.y) / (t.x * t.x + t.y * t.y)
  }

  it('gives Figma’s value at 9 points when the width handle isn’t perpendicular, in 400 × 200', () => {
    const h = { start: pt(0.1, 0.2), end: pt(0.9, 0.6), width: pt(0.3, 0.9) }
    const lines: string[] = []
    const paint = linearPaint(h, stops, (line) => lines.push(line))
    for (const p of SAMPLES) expect(Math.abs(dazbeeValue(paint.from, paint.to, p) - figmaValue(h, p))).toBeLessThan(1e-9)
    expect(paint).toMatchObject({ type: 'linear', from: h.start, stops })
    expect(lines).toEqual([])
  })

  it('draws from start to end when the handles lie on one line, reported', () => {
    const lines: string[] = []
    const h = { start: pt(0, 0), end: pt(1, 0), width: pt(0.5, 0) }
    expect(linearPaint(h, stops, (line) => lines.push(line))).toMatchObject({ from: h.start, to: h.end })
    expect(linearPaint({ ...h, width: h.start }, stops, (line) => lines.push(line))).toMatchObject({ to: h.end })
    expect(lines).toEqual(['gradient-handles-in-line', 'gradient-handles-in-line'])
  })
})

describe('radialPaint', () => {
  const skewed = { start: pt(0.4, 0.5), end: pt(0.9, 0.7), width: pt(0.3, 0.95) }

  it('draws an oval round with its area, at √(σ1·σ2) of the shorter side, reported', () => {
    const lines: string[] = []
    const { major, minor } = ovalOf(skewed, 400, 200)
    const paint = radialPaint(skewed, 400, 200, stops, (line) => lines.push(line))
    expect(paint).toMatchObject({ type: 'radial', center: skewed.start, stops })
    expect(paint?.radius).toBeCloseTo(Math.sqrt(major * minor) / 200, 12)
    expect(lines).toEqual(['radial-ovals-round'])
  })

  it('keeps a round radial’s radius as a share of the shorter side', () => {
    const lines: string[] = []
    const round = { start: pt(0.5, 0.5), end: pt(0.75, 0.5), width: pt(0.5, 1) }
    expect(radialPaint(round, 400, 200, stops, (line) => lines.push(line))?.radius).toBeCloseTo(0.5, 12)
    expect(lines).toEqual([])
  })

  it('leaves out a radial flattened to under 1e-6 px across, reported', () => {
    const lines: string[] = []
    const flat = { start: pt(0.5, 0.5), end: pt(0.75, 0.5), width: pt(1, 0.5 + 1e-10) }
    expect(radialPaint(flat, 400, 200, stops, (line) => lines.push(line))).toBeNull()
    expect(lines).toEqual(['flat-gradients'])
  })
})

describe('angularPaint', () => {
  const three = [
    { offset: 0, color: '#FF0000FF' },
    { offset: 0.25, color: '#00FF00FF' },
    { offset: 1, color: '#0000FFFF' },
  ]

  it('starts along the end handle, in the unit box, and turns clockwise when the width handle is clockwise of it', () => {
    const lines: string[] = []
    const h = { start: pt(0.5, 0.5), end: pt(0.5, 0.75), width: pt(0.25, 0.5) }
    expect(angularPaint(h, three, (line) => lines.push(line))).toEqual({
      type: 'angular',
      center: h.start,
      angle: 90,
      stops: three,
    })
    expect(lines).toEqual([])
  })

  it('reverses its stops when the width handle is counter-clockwise of the end handle (det < 0)', () => {
    const lines: string[] = []
    const h = { start: pt(0.5, 0.5), end: pt(0.75, 0.5), width: pt(0.5, 0.25) }
    expect(angularPaint(h, three, (line) => lines.push(line))).toEqual({
      type: 'angular',
      center: h.start,
      angle: 0,
      stops: [
        { offset: 0, color: '#0000FFFF' },
        { offset: 0.75, color: '#00FF00FF' },
        { offset: 1, color: '#FF0000FF' },
      ],
    })
    expect(lines).toEqual([])
  })

  it('reports handles that aren’t square, or of two lengths, in the unit box', () => {
    const lines: string[] = []
    angularPaint({ start: pt(0, 0), end: pt(1, 0), width: pt(0.2, 1) }, three, (line) => lines.push(line))
    angularPaint({ start: pt(0, 0), end: pt(1, 0), width: pt(0, 0.5) }, three, (line) => lines.push(line))
    expect(lines).toEqual(['angular-gradients-changed', 'angular-gradients-changed'])
  })
})

describe('ovalOf', () => {
  /**
   * The SVD of [A B], found by search: the longest and shortest |M·v| over unit v, and the angle of
   * M·v at the longest, in degrees clockwise from pointing right.
   */
  const numericSvd = (m: [number, number, number, number]) => {
    const at = (t: number) => ({
      x: m[0] * Math.cos(t) + m[2] * Math.sin(t),
      y: m[1] * Math.cos(t) + m[3] * Math.sin(t),
    })
    const length = (t: number) => Math.hypot(at(t).x, at(t).y)
    let best = 0
    for (let i = 0; i < 100_000; i++) if (length((i * Math.PI) / 100_000) > length(best)) best = (i * Math.PI) / 100_000
    let [lo, hi] = [best - 1e-4, best + 1e-4]
    for (let i = 0; i < 200; i++) {
      const [p, q] = [lo + (hi - lo) / 3, hi - (hi - lo) / 3]
      if (length(p) < length(q)) lo = p
      else hi = q
    }
    const t = (lo + hi) / 2
    return { major: length(t), minor: length(t + Math.PI / 2), angle: (Math.atan2(at(t).y, at(t).x) * 180) / Math.PI }
  }

  it('finds the oval of skewed handles as a numeric SVD does', () => {
    // In pixels of 400 × 200: A = (200, 40) from the end handle, B = (−40, 90) from the width handle.
    const svd = numericSvd([200, 40, -40, 90])
    const oval = ovalOf({ start: pt(0.4, 0.5), end: pt(0.9, 0.7), width: pt(0.3, 0.95) }, 400, 200)
    expect(oval.major).toBeCloseTo(svd.major, 6)
    expect(oval.minor).toBeCloseTo(svd.minor, 6)
    const turn = (((oval.angle - svd.angle) % 180) + 180) % 180
    expect(Math.min(turn, 180 - turn)).toBeLessThan(1e-4)
  })
})
