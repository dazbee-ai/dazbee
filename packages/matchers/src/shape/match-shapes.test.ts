import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import { type MatchAnswer, MatchJob, type MatchKit, type Paint, type UnplacedLayer } from '@dazbee/schema'

import { looksSame } from '../looks-same/rule.ts'
import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { type Around, gradientOf, matchShapes, matchShapesOf, SHAPE_STEPS, type ShapeStep } from './match-shapes.ts'
import { hexRgb } from './parts/colour.ts'
import { toFloatPicture } from './parts/float-picture.ts'
import { splitPatches } from './patches.ts'
import { ellipse, graphic, hiding, noise, pngBase64, rectangle, shadowed } from './test-pieces.ts'

type Graphic = Extract<UnplacedLayer, { type: 'graphic' }>
interface Box {
  x: number
  y: number
  width: number
  height: number
}

const ck = await loadCanvasKit()
const BLUE = '#2563EBFF'
const CORAL = '#F2765AFF'
const GREEN = '#16A34AFF'
const RED = '#DC2626FF'
const INK = '#111827FF'
const WHITE = '#FFFFFFFF'
const WIDTH = 200
const HEIGHT = 140

const LINEAR: Paint = {
  type: 'linear',
  from: { x: 0, y: 0.5 },
  to: { x: 1, y: 0.5 },
  stops: [
    { offset: 0, color: '#FDE68AFF' },
    { offset: 1, color: '#B91C1CFF' },
  ],
}

/**
 * The answer for graphics drawn as a piece, with the steps told. The piece is drawn and matched twice: the two
 * answers are one, and the first is returned.
 */
const matched = (
  layers: ShapeLayer[],
  {
    width = WIDTH,
    height = HEIGHT,
    colors = {},
    around = {},
  }: { width?: number; height?: number; colors?: MatchKit['colors']; around?: Around } = {},
) => {
  const piece = drawGraphics(ck, layers, width, height)
  const steps: ShapeStep[] = []
  const answer = matchShapesOf(ck, piece, colors, around, (step) => steps.push(step))
  expect(matchShapesOf(ck, drawGraphics(ck, layers, width, height), colors, around)).toEqual(answer)
  return { piece, answer, steps }
}

/** An answer's graphics, back to front; it throws for a piece that stayed a picture. */
const graphicsOf = (answer: MatchAnswer): Graphic[] => {
  if (answer.kind !== 'layers') throw new Error(`a picture: ${answer.why}`)
  expect(answer.approximate).toBe(false)
  return answer.layers.map((layer) => {
    if (layer.type !== 'graphic') throw new Error(`a ${layer.type} layer`)
    return layer
  })
}

/** The graphics that rebuild graphics drawn as a piece, which look the same as the piece by the rule. */
const rebuilt = (layers: ShapeLayer[], options: Parameters<typeof matched>[1] = {}): Graphic[] => {
  const { piece, answer } = matched(layers, options)
  const graphics = graphicsOf(answer)
  expect(looksSame('shape', piece, drawGraphics(ck, graphics, piece.width, piece.height)).same).toBe(true)
  return graphics
}

/** The one graphic that rebuilds graphics drawn as a piece. */
const rebuiltAsOne = (layers: ShapeLayer[], options: Parameters<typeof matched>[1] = {}): Graphic => {
  const [only, ...others] = rebuilt(layers, options)
  expect(others).toEqual([])
  if (!only) throw new Error('no graphic')
  return only
}

/** Expects a graphic's box to be the one drawn, each number within `within` pixels. */
const expectBox = (layer: Graphic, box: Box, within = 1) => {
  expect(Math.abs(layer.props.x - box.x)).toBeLessThanOrEqual(within)
  expect(Math.abs(layer.props.y - box.y)).toBeLessThanOrEqual(within)
  expect(Math.abs(layer.props.width - box.width)).toBeLessThanOrEqual(within)
  expect(Math.abs(layer.props.height - box.height)).toBeLessThanOrEqual(within)
}

/** Expects a colour to be another, each channel within 6 of 255. */
const expectColour = (color: string | undefined, want: string) => {
  const got = hexRgb(color ?? '')
  hexRgb(want).forEach((channel, i) => expect(Math.abs((got[i] ?? NaN) - channel)).toBeLessThanOrEqual(6))
}

/** A graphic's one fill, when it is a flat colour. */
const flatFill = (layer: Graphic) => {
  const [fill, ...others] = layer.props.fills
  expect(others).toEqual([])
  if (fill?.type !== 'solid') throw new Error(`a ${fill?.type} fill`)
  return fill
}

/** What other layers hide of a 200 × 140 piece: the pixels of a box of it. */
const hides = (box: Box): Uint8Array => hiding(box, WIDTH, HEIGHT)

/** A mask as a job gives it: one bit a pixel, the first pixel of a byte in its highest bit, in base64. */
const bitsOf = (hidden: Uint8Array): string => {
  const bits = new Uint8Array(Math.ceil(hidden.length / 8))
  hidden.forEach((covered, i) => {
    if (covered) bits[i >> 3] = (bits[i >> 3] ?? 0) | (128 >> (i & 7))
  })
  return Buffer.from(bits).toString('base64')
}

const panelBox = { x: 20, y: 20, width: 160, height: 100 }
const panel = rectangle(panelBox, BLUE, 12)
const pillBox = { x: 40, y: 40, width: 140, height: 48 }
const pill = rectangle(pillBox, GREEN, 24)
const badgeBox = { x: 80, y: 50, width: 40, height: 40 }
const badge = rectangle(badgeBox, INK)
/** A see-through white panel with a white dot on it: over white, the dot can't be seen. */
const glass = [
  graphic({ kind: 'rect', cornerRadius: 12 }, panelBox, { fill: { type: 'solid', color: WHITE, opacity: 0.5 } }),
  ellipse({ x: 140, y: 40, width: 12, height: 12 }, WHITE),
]

describe('matchShapes', () => {
  /** A picture of a panel and a disc, and a job for the piece round the disc. */
  const picture = drawGraphics(
    ck,
    [
      rectangle({ x: 20, y: 20, width: 160, height: 100 }, BLUE, 12),
      ellipse({ x: 240, y: 30, width: 80, height: 80 }, '#F0765EFF'),
    ],
    360,
    140,
  )
  const job = (fields: Partial<MatchJob> = {}): MatchJob =>
    MatchJob.parse({
      picture: pngBase64(ck, picture),
      pieces: [{ kind: 'shape', rect: { x: 220, y: 10, width: 120, height: 120 } }],
      kit: { colors: { accent: CORAL }, fonts: {}, textStyles: [] },
      ...fields,
    })
  const answerOf = (matchJob: MatchJob, step?: (step: ShapeStep) => void): MatchAnswer => {
    const [piece] = matchJob.pieces
    if (!piece) throw new Error('no piece')
    return matchShapes(ck, matchJob, piece, step)
  }

  it('rebuilds the piece under its rect, in the piece’s pixels, with the kit’s colour bound', () => {
    const steps: ShapeStep[] = []
    const [disc, ...others] = graphicsOf(answerOf(job(), (step) => steps.push(step)))
    expect(others).toEqual([])
    if (!disc) throw new Error('no graphic')
    expect(disc.props.shape.kind).toBe('ellipse')
    expectBox(disc, { x: 20, y: 20, width: 80, height: 80 })
    expect(disc.bindings).toEqual({ fill: 'brand:accent' })
    expect(disc.props.fills).toEqual([{ type: 'solid', color: CORAL }])
    expect(steps).toEqual(['patches', 'graphics', 'judging'])
  })

  it('rebuilds nothing of what the job says other layers hide', () => {
    const framed = drawGraphics(ck, [panel, badge], WIDTH, HEIGHT)
    const whole = {
      picture: pngBase64(ck, framed),
      pieces: [{ kind: 'shape' as const, rect: { x: 0, y: 0, width: WIDTH, height: HEIGHT } }],
    }
    expect(graphicsOf(answerOf(job(whole)))).toHaveLength(2)
    const [only, ...others] = graphicsOf(answerOf(job({ ...whole, hidden: bitsOf(hides(badgeBox)) })))
    expect(others).toEqual([])
    if (!only) throw new Error('no graphic')
    expectBox(only, panelBox)
    expectColour(flatFill(only).color, BLUE)
  })

  it('judges a see-through piece over the job’s first background', () => {
    const seen = {
      picture: pngBase64(ck, drawGraphics(ck, glass, WIDTH, HEIGHT)),
      pieces: [{ kind: 'shape' as const, rect: { x: 0, y: 0, width: WIDTH, height: HEIGHT } }],
    }
    expect(answerOf(job(seen))).toMatchObject({ kind: 'picture', why: 'looksDifferent' })
    expect(graphicsOf(answerOf(job({ ...seen, backgrounds: [[255, 255, 255]] })))).toHaveLength(1)
  })
})

describe('matchShapesOf', () => {
  it('rebuilds a rectangle as a rectangle', () => {
    const box = { x: 20, y: 20, width: 160, height: 100 }
    const layer = rebuiltAsOne([rectangle(box, BLUE)])
    expect(layer.props.shape.kind).toBe('rect')
    expectBox(layer, box)
    expect(layer.props.rotation).toBe(0)
    expect(flatFill(layer)).toEqual({ type: 'solid', color: BLUE })
    expect(layer.props.strokes).toEqual([])
  })

  it('rebuilds a rounded rectangle with its radius, and each corner’s own', () => {
    const rounded = rebuiltAsOne([panel])
    expectBox(rounded, panelBox)
    expect(rounded.props.shape).toMatchObject({ kind: 'rect' })
    expect(rounded.props.shape.kind === 'rect' && Math.abs(rounded.props.shape.cornerRadius - 12)).toBeLessThan(1)
    const radii = [0, 30, 0, 14] as const
    const tab = rebuiltAsOne([
      graphic({ kind: 'rect', cornerRadius: 0, corners: [...radii] }, panelBox, {
        fill: { type: 'solid', color: BLUE },
      }),
    ])
    expectBox(tab, panelBox)
    const corners = tab.props.shape.kind === 'rect' ? tab.props.shape.corners : undefined
    expect(corners).toHaveLength(4)
    // The round corners have their radii, and the square ones stay all but square.
    expect(Math.abs((corners?.[1] ?? NaN) - 30)).toBeLessThan(1)
    expect(Math.abs((corners?.[3] ?? NaN) - 14)).toBeLessThan(1)
    expect(corners?.[0]).toBeLessThan(3)
    expect(corners?.[2]).toBeLessThan(3)
  })

  it('rebuilds a pill as a rectangle rounded by half its height', () => {
    const layer = rebuiltAsOne([pill])
    expectBox(layer, pillBox)
    expect(layer.props.shape.kind === 'rect' && Math.abs(layer.props.shape.cornerRadius - 24)).toBeLessThan(1)
    expect(layer.name).toBe('Green pill')
  })

  it('rebuilds a circle as an ellipse, at 40 px and at 300 px too', () => {
    const box = { x: 50, y: 20, width: 100, height: 100 }
    const layer = rebuiltAsOne([ellipse(box, RED)])
    expect(layer.props.shape).toEqual({ kind: 'ellipse' })
    expectBox(layer, box)
    expect(flatFill(layer)).toEqual({ type: 'solid', color: RED })
    const small = rebuiltAsOne([ellipse({ x: 4, y: 4, width: 32, height: 32 }, RED)], { width: 40, height: 40 })
    expect(small.props.shape).toEqual({ kind: 'ellipse' })
    expectBox(small, { x: 4, y: 4, width: 32, height: 32 })
    const large = rebuiltAsOne([ellipse({ x: 20, y: 20, width: 260, height: 260 }, RED)], { width: 300, height: 300 })
    expect(large.props.shape).toEqual({ kind: 'ellipse' })
    expectBox(large, { x: 20, y: 20, width: 260, height: 260 })
  })

  it('rebuilds a turned rectangle with its turn', () => {
    const box = { x: 40, y: 40, width: 120, height: 60, rotation: -30 }
    const layer = rebuiltAsOne([rectangle(box, BLUE)])
    expect(layer.props.shape.kind).toBe('rect')
    expectBox(layer, box)
    expect(Math.abs(layer.props.rotation + 30)).toBeLessThan(0.5)
  })

  it('rebuilds a line as a line with a stroke of its width', () => {
    const line = graphic(
      { kind: 'line', start: 'none', end: 'none' },
      { x: 20, y: 28, width: 200, height: 4 },
      { stroke: { paint: { type: 'solid', color: INK }, width: 4, align: 'center', cap: 'butt' } },
    )
    const layer = rebuiltAsOne([line], { width: 240, height: 60 })
    expect(layer.props.shape).toMatchObject({ kind: 'line', start: 'none', end: 'none' })
    expectBox(layer, { x: 20, y: 28, width: 200, height: 4 })
    expect(layer.props.fills).toEqual([])
    expect(layer.props.strokes).toHaveLength(1)
    expect(layer.props.strokes[0]).toMatchObject({ paint: { type: 'solid', color: INK }, cap: 'butt' })
    expect(layer.props.strokes[0]?.width).toBeCloseTo(4, 0)
  })

  it('rebuilds a ring and a rectangle’s outline as stroked shapes with no fill', () => {
    const ringBox = { x: 50, y: 20, width: 100, height: 100 }
    const stroke = (width: number) => ({
      stroke: { paint: { type: 'solid' as const, color: '#7C3AEDFF' }, width, align: 'inside' as const },
    })
    const ring = rebuiltAsOne([graphic({ kind: 'ellipse' }, ringBox, stroke(8))])
    expect(ring.props.shape).toEqual({ kind: 'ellipse' })
    expectBox(ring, ringBox)
    expect(ring.props.fills).toEqual([])
    expect(ring.props.strokes[0]).toMatchObject({ paint: { type: 'solid', color: '#7C3AEDFF' }, align: 'inside' })
    expect(Math.abs((ring.props.strokes[0]?.width ?? NaN) - 8)).toBeLessThan(0.5)
    const outline = rebuiltAsOne([graphic({ kind: 'rect', cornerRadius: 10 }, panelBox, stroke(6))])
    expect(outline.props.shape.kind).toBe('rect')
    expectBox(outline, panelBox)
    expect(outline.props.fills).toEqual([])
    expect(Math.abs((outline.props.strokes[0]?.width ?? NaN) - 6)).toBeLessThan(0.5)
  })

  it('rebuilds a regular polygon as one of as many sides', () => {
    const box = { x: 50, y: 20, width: 100, height: 100 }
    for (const sides of [3, 6]) {
      const layer = rebuiltAsOne([
        graphic({ kind: 'polygon', sides, cornerRadius: 0 }, box, { fill: { type: 'solid', color: '#0891B2FF' } }),
      ])
      expect(layer.props.shape).toMatchObject({ kind: 'polygon', sides })
      expectBox(layer, box, 1.5)
      expect(Math.abs(layer.props.rotation)).toBeLessThan(1)
    }
  })

  it('rebuilds a star as one of as many points', () => {
    const box = { x: 30, y: 20, width: 200, height: 200 }
    const layer = rebuiltAsOne(
      [
        graphic({ kind: 'star', points: 5, innerRadius: 0.382, cornerRadius: 0 }, box, {
          fill: { type: 'solid', color: '#F59E0BFF' },
        }),
      ],
      { width: 260, height: 240 },
    )
    expect(layer.props.shape).toMatchObject({ kind: 'star', points: 5 })
    expect(layer.props.shape.kind === 'star' && Math.abs(layer.props.shape.innerRadius - 0.382)).toBeLessThan(0.03)
    expectBox(layer, box, 3)
    expect(Math.abs(layer.props.rotation)).toBeLessThan(1)
  })

  it('rebuilds a linear gradient as a gradient fill along the way it runs', () => {
    const box = { x: 10, y: 10, width: 220, height: 100 }
    const layer = rebuiltAsOne([graphic({ kind: 'rect', cornerRadius: 0 }, box, { fill: LINEAR })], {
      width: 240,
      height: 120,
    })
    expect(layer.props.shape.kind).toBe('rect')
    expectBox(layer, box)
    const [fill] = layer.props.fills
    if (fill?.type !== 'linear') throw new Error(`a ${fill?.type} fill`)
    // It runs from left to right, level.
    expect(fill.to.x - fill.from.x).toBeGreaterThan(0.8)
    expect(Math.abs(fill.to.y - fill.from.y)).toBeLessThan(0.05)
    expectColour(fill.stops[0]?.color, '#FDE68AFF')
    expectColour(fill.stops.at(-1)?.color, '#B91C1CFF')
  })

  it('rebuilds two overlapping shapes as two graphics, back to front, the one behind whole', () => {
    const discBox = { x: 110, y: 50, width: 80, height: 80 }
    const [back, front, ...others] = rebuilt([panel, ellipse(discBox, CORAL)], { width: 220, height: 150 })
    expect(others).toEqual([])
    if (!back || !front) throw new Error('fewer than two graphics')
    expect(back.props.shape.kind).toBe('rect')
    expectBox(back, panelBox)
    expectColour(flatFill(back).color, BLUE)
    expect(front.props.shape).toEqual({ kind: 'ellipse' })
    expectBox(front, discBox)
    expectColour(flatFill(front).color, CORAL)
  })

  it('rebuilds a pill with a drop shadow as one graphic with the shadow as its effect', () => {
    const shadow = { x: 0, y: 8, blur: 16, color: '#00000066' }
    const layer = rebuiltAsOne([shadowed(pill, shadow)], { width: 220, height: 140 })
    expect(layer.props.shape.kind).toBe('rect')
    expectBox(layer, pillBox)
    expectColour(flatFill(layer).color, GREEN)
    const [effect, ...others] = layer.props.effects
    expect(others).toEqual([])
    if (effect?.type !== 'dropShadow') throw new Error(`a ${effect?.type} effect`)
    expect(Math.abs(effect.x)).toBeLessThan(1.5)
    expect(Math.abs(effect.y - 8)).toBeLessThan(1.5)
    expect(Math.abs(effect.blur - 16)).toBeLessThan(4)
    // Black, or all but.
    for (const channel of hexRgb(effect.color)) expect(channel).toBeLessThan(16)
  })

  it('rebuilds a pill with a glow as one graphic with a shadow of no offset in the glow’s colour', () => {
    const layer = rebuiltAsOne([shadowed(pill, { x: 0, y: 0, blur: 18, color: '#F59E0BCC' })], {
      width: 220,
      height: 128,
    })
    expect(layer.props.shape.kind).toBe('rect')
    expectBox(layer, pillBox)
    const [effect] = layer.props.effects
    if (effect?.type !== 'dropShadow') throw new Error(`a ${effect?.type} effect`)
    expect(Math.abs(effect.x)).toBeLessThan(1)
    expect(Math.abs(effect.y)).toBeLessThan(1)
    expect(Math.abs(effect.blur - 18)).toBeLessThan(4)
    // Orange, not the pill's green or a shadow's black.
    const [red, green, blue] = hexRgb(effect.color)
    expect(red).toBeGreaterThan(200)
    expect(green).toBeGreaterThan(130)
    expect(blue).toBeLessThan(60)
  })

  it('rebuilds a see-through panel with its fill as see-through', () => {
    const layer = rebuiltAsOne([
      graphic({ kind: 'rect', cornerRadius: 12 }, panelBox, { fill: { type: 'solid', color: INK, opacity: 0.5 } }),
    ])
    expect(layer.props.shape.kind).toBe('rect')
    expectBox(layer, panelBox)
    const fill = flatFill(layer)
    expect(fill.color).toBe(INK)
    expect(fill.opacity).toBeCloseTo(0.5, 1)
  })

  it('rebuilds an icon of loose parts of one colour as one path', () => {
    // A tick with a dot to each side of it.
    const tick = graphic(
      {
        kind: 'path',
        d: 'M10 55 L25 40 L42 57 L78 18 L92 32 L42 88 Z',
        fillRule: 'nonzero',
        drawnIn: { width: 100, height: 100 },
      },
      { x: 30, y: 10, width: 100, height: 100 },
      { fill: { type: 'solid', color: INK } },
    )
    const dots = [
      ellipse({ x: 10, y: 14, width: 14, height: 14 }, INK),
      ellipse({ x: 136, y: 90, width: 14, height: 14 }, INK),
    ]
    const layer = rebuiltAsOne([tick, ...dots], { width: 160, height: 120 })
    expect(layer.props.shape.kind).toBe('path')
    // It reaches from the first dot to the second.
    expectBox(layer, { x: 10, y: 14, width: 140, height: 90 })
    expect(flatFill(layer)).toEqual({ type: 'solid', color: INK })
  })

  it('keeps a picture of noise a picture, as it has too many parts', () => {
    const { answer, steps } = matched(noise(), { width: 90, height: 90 })
    expect(answer).toEqual({ kind: 'picture', why: 'tooManyParts' })
    expect(steps).toEqual(['patches'])
  })

  it('keeps shaded art a picture, as it has too many parts', () => {
    // Soft lights of four colours over a dark ground, each fading into the next.
    const light = (x: number, y: number, radius: number, color: string): ShapeLayer =>
      graphic(
        { kind: 'ellipse' },
        { x: x - radius, y: y - radius, width: 2 * radius, height: 2 * radius },
        {
          fill: {
            type: 'radial',
            center: { x: 0.5, y: 0.5 },
            radius: 0.5,
            stops: [
              { offset: 0, color: `${color}FF` },
              { offset: 1, color: `${color}00` },
            ],
          },
        },
      )
    const { answer, steps } = matched([
      rectangle({ x: 0, y: 0, width: WIDTH, height: HEIGHT }, '#1E293BFF'),
      light(60, 50, 70, '#F59E0B'),
      light(140, 90, 80, '#DB2777'),
      light(100, 30, 50, '#22D3EE'),
      light(40, 110, 60, '#84CC16'),
    ])
    expect(answer).toEqual({ kind: 'picture', why: 'tooManyParts' })
    expect(steps).toEqual(['patches'])
  })

  it('keeps a piece whose rebuild looks different a picture, with the rule’s far share', () => {
    // A gradient through every hue, which no fill of a graphic the matcher makes draws.
    const hues = ['#FF0000FF', '#FFFF00FF', '#00FF00FF', '#00FFFFFF', '#0000FFFF', '#FF00FFFF', '#FF0000FF']
    const rainbow: Paint = {
      type: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 1, y: 1 },
      stops: hues.map((color, i) => ({ offset: i / 6, color })),
    }
    const { answer } = matched(
      [graphic({ kind: 'rect', cornerRadius: 0 }, { x: 10, y: 10, width: 180, height: 100 }, { fill: rainbow })],
      { height: 120 },
    )
    expect(answer).toMatchObject({ kind: 'picture', why: 'looksDifferent' })
    expect(answer.scores?.far).toBeGreaterThan(0.5)
  })

  it('rebuilds nothing of what other layers hide: a hidden badge on a panel leaves the panel whole', () => {
    expect(rebuilt([panel, badge]).map((layer) => layer.name)).toEqual(['Blue rounded rectangle', 'Black rectangle'])
    const { answer } = matched([panel, badge], { around: { hidden: hides(badgeBox) } })
    const [only, ...others] = graphicsOf(answer)
    expect(others).toEqual([])
    if (!only) throw new Error('no graphic')
    expect(only.props.shape.kind).toBe('rect')
    expectBox(only, panelBox)
    expect(flatFill(only)).toEqual({ type: 'solid', color: BLUE })
  })

  it('rebuilds a disc half under a hidden block as one graphic that draws the disc where it shows', () => {
    const block = { x: 100, y: 0, width: 100, height: HEIGHT }
    const hidden = hides(block)
    const { piece, answer } = matched(
      [ellipse({ x: 40, y: 20, width: 100, height: 100 }, RED), rectangle(block, INK)],
      { around: { hidden } },
    )
    const [only, ...others] = graphicsOf(answer)
    expect(others).toEqual([])
    if (!only) throw new Error('no graphic')
    expect(flatFill(only)).toEqual({ type: 'solid', color: RED })
    // Where nothing hides the piece, the graphic draws what the piece shows.
    const drawn = drawGraphics(ck, [only], WIDTH, HEIGHT)
    const shown = new Uint8Array(drawn.pixels)
    hidden.forEach((covered, i) => {
      if (covered) shown.set(piece.pixels.subarray(i * 4, i * 4 + 4), i * 4)
    })
    expect(looksSame('shape', piece, { width: WIDTH, height: HEIGHT, pixels: shown }).scores.far).toBe(0)
  })

  it('judges a see-through piece over the colour behind it', () => {
    // Over the grey a piece is judged on when nothing is known, the dot shows and the rebuild misses it.
    expect(matched(glass).answer).toMatchObject({ kind: 'picture', why: 'looksDifferent' })
    expect(matched(glass, { around: { behind: [0, 0, 0] } }).answer).toMatchObject({
      kind: 'picture',
      why: 'looksDifferent',
    })
    const { answer } = matched(glass, { around: { behind: [255, 255, 255] } })
    const [only, ...others] = graphicsOf(answer)
    expect(others).toEqual([])
    expect(only?.props.shape.kind).toBe('rect')
    expect(only && flatFill(only).opacity).toBeCloseTo(0.5, 1)
  })

  it('binds a fill near a colour of the brand kit to it', () => {
    // ΔE00 3 from the kit's primary.
    const layer = rebuiltAsOne([rectangle(panelBox, '#1D6BEBFF', 12)], { colors: { primary: BLUE, accent: CORAL } })
    expect(layer.bindings).toEqual({ fill: 'brand:primary' })
    expect(layer.props.fills).toEqual([{ type: 'solid', color: BLUE }])
    expect(rebuiltAsOne([rectangle(panelBox, '#1D6BEBFF', 12)]).bindings).toBeUndefined()
  })

  it('tells its steps in order, the last two again when the shapes are traced for a second try', () => {
    expect(SHAPE_STEPS).toEqual(['patches', 'graphics', 'judging'])
    expect(matched([panel]).steps).toEqual(['patches', 'graphics', 'judging'])
    expect(matched(glass).steps).toEqual(['patches', 'graphics', 'judging', 'graphics', 'judging'])
  })

  it('gives the rule’s far share with its layers, and with a picture that was judged', () => {
    const { answer } = matched([panel])
    expect(answer.scores).toEqual({ far: 0 })
    expect(matched(glass).answer.scores?.far).toBeLessThan(0.015)
  })
})

describe('gradientOf', () => {
  /** The one patch of a rectangle with this fill, with the picture it was cut from. */
  const patchOf = (fill: Paint) => {
    const picture = toFloatPicture(
      drawGraphics(
        ck,
        [graphic({ kind: 'rect', cornerRadius: 0 }, { x: 10, y: 10, width: 220, height: 100 }, { fill })],
        240,
        120,
      ),
    )
    const split = splitPatches(picture)
    const [patch] = split?.patches ?? []
    if (!split || !patch) throw new Error('no patch')
    return { picture, split, patch }
  }

  it('reads a patch that shades from one colour to another as a linear gradient between them', () => {
    const { picture, split, patch } = patchOf(LINEAR)
    const gradient = gradientOf(patch, picture, split.patchOf)
    expect(gradient?.type).toBe('linear')
    // It runs across the patch, in the picture's pixels.
    expect((gradient?.to[0] ?? NaN) - (gradient?.from[0] ?? NaN)).toBeGreaterThan(180)
    expect(Math.abs((gradient?.to[1] ?? NaN) - (gradient?.from[1] ?? NaN))).toBeLessThan(5)
  })

  it('reads no gradient in a patch of one colour', () => {
    const { picture, split, patch } = patchOf({ type: 'solid', color: BLUE })
    expect(gradientOf(patch, picture, split.patchOf)).toBeNull()
  })
})
