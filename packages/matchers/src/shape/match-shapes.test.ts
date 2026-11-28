import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import { type MatchAnswer, MatchJob, type Paint } from '@dazbee/schema'

import { looksSame } from '../looks-same/rule.ts'
import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { matchShapes, matchShapesOf, SHAPE_STEPS, type ShapeStep } from './match-shapes.ts'
import { hexRgb } from './parts/colour.ts'
import {
  bandAndDisc,
  type Box,
  expectBox,
  expectColour,
  flatFill,
  type Graphic,
  graphicsIn,
  halftone,
  HEIGHT,
  matched,
  matchedAsOne,
  onlyOne,
  painted,
  rebuilt,
  rebuiltAsOne,
  rimmed,
  WIDTH,
} from './test-matching.ts'
import { ellipse, graphic, hiding, noise, pngBase64, rectangle, shadowed, stroked, SUNSET } from './test-pieces.ts'

const ck = await loadCanvasKit()
const BLUE = '#2563EBFF'
const CORAL = '#F2765AFF'
const GREEN = '#16A34AFF'
const RED = '#DC2626FF'
const INK = '#111827FF'
const NAVY = '#15224AFF'
const WHITE = '#FFFFFFFF'
/** Colours of the pieces painted by hand: red, green, blue and alpha. */
const PAINT_RED = [220, 38, 38, 255] as const
const PAINT_BLUE = [37, 99, 235, 255] as const
const CLEAR = [0, 0, 0, 0] as const

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

/** Expects a graphic to be a rectangle with square corners. */
const expectSquareCorners = (layer: Graphic) => {
  if (layer.props.shape.kind !== 'rect') throw new Error(`a ${layer.props.shape.kind}`)
  expect(layer.props.shape.cornerRadius).toBe(0)
  expect((layer.props.shape.corners ?? []).filter((radius) => radius !== 0)).toEqual([])
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
/** A white card with a navy border inside its edge, and a navy bump 3 px high on the border's top. */
const bumpedCard = [
  stroked({ kind: 'rect', cornerRadius: 0 }, { x: 30, y: 40, width: 240, height: 160 }, NAVY, 10, WHITE),
  rectangle({ x: 120, y: 37, width: 30, height: 3 }, NAVY),
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
    const disc = onlyOne(graphicsIn(answerOf(job(), (step) => steps.push(step))))
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
    expect(graphicsIn(answerOf(job(whole)))).toHaveLength(2)
    const only = onlyOne(graphicsIn(answerOf(job({ ...whole, hidden: bitsOf(hides(badgeBox)) }))))
    expectBox(only, panelBox)
    expectColour(flatFill(only).color, BLUE)
  })

  it('judges a see-through piece over the job’s first background', () => {
    const seen = {
      picture: pngBase64(ck, drawGraphics(ck, glass, WIDTH, HEIGHT)),
      pieces: [{ kind: 'shape' as const, rect: { x: 0, y: 0, width: WIDTH, height: HEIGHT } }],
    }
    expect(answerOf(job(seen))).toMatchObject({ kind: 'picture', why: 'looksDifferent' })
    expect(graphicsIn(answerOf(job({ ...seen, backgrounds: [[255, 255, 255]] })))).toHaveLength(1)
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

  it('rebuilds a rectangle with square corners as one, at any size and turned', () => {
    expectSquareCorners(matchedAsOne(painted(1920, 1080, () => PAINT_BLUE)))
    expectSquareCorners(matchedAsOne(painted(728, 90, () => PAINT_BLUE)))
    const card = { x: 50, y: 50, width: 700, height: 500 }
    expectSquareCorners(rebuiltAsOne([rectangle(card, BLUE)], { width: 800, height: 600 }))
    expectSquareCorners(rebuiltAsOne([rectangle({ x: 44, y: 50, width: 112, height: 40, rotation: 20 }, BLUE)]))
  })

  it('rebuilds a rounded rectangle with its one radius, within a pixel', () => {
    const rounded = [
      { box: { x: 30, y: 40, width: 333, height: 211 }, radius: 16, width: 400, height: 300 },
      { box: { x: 50, y: 50, width: 700, height: 500 }, radius: 32, width: 800, height: 600 },
      { box: { x: 20, y: 30, width: 160, height: 80 }, radius: 40, width: WIDTH, height: HEIGHT },
    ]
    for (const { box, radius, width, height } of rounded) {
      const layer = rebuiltAsOne([rectangle(box, BLUE, radius)], { width, height })
      expectBox(layer, box)
      if (layer.props.shape.kind !== 'rect') throw new Error(`a ${layer.props.shape.kind}`)
      expect(Math.abs(layer.props.shape.cornerRadius - radius)).toBeLessThanOrEqual(1)
      expect(layer.props.shape.corners).toBeUndefined()
    }
  })

  it('rebuilds a pill as a rectangle rounded by half its height', () => {
    const layer = rebuiltAsOne([pill])
    expectBox(layer, pillBox)
    expect(layer.props.shape.kind === 'rect' && Math.abs(layer.props.shape.cornerRadius - 24)).toBeLessThan(1)
    expect(layer.name).toBe('Green pill')
  })

  it('rebuilds each kind of shape as one graphic of its kind, and a gradient as a gradient fill', () => {
    const size = { width: 260, height: 240 }
    const box = { x: 30, y: 20, width: 200, height: 200 }
    const fill = { fill: { type: 'solid' as const, color: BLUE } }
    const tick = 'M10 55 L25 40 L42 57 L78 18 L92 32 L42 88 Z'
    const kinds: [ShapeLayer, string][] = [
      [ellipse(box, RED), 'ellipse'],
      [rectangle({ x: 40, y: 60, width: 180, height: 90, rotation: -30 }, BLUE), 'rect'],
      [rectangle({ x: 20, y: 118, width: 220, height: 4 }, INK), 'line'],
      [stroked({ kind: 'ellipse' }, box, BLUE, 8), 'ellipse'],
      [graphic({ kind: 'polygon', sides: 6, cornerRadius: 0 }, box, fill), 'polygon'],
      [graphic({ kind: 'star', points: 5, innerRadius: 0.382, cornerRadius: 0 }, box, fill), 'star'],
      [
        graphic({ kind: 'path', d: tick, fillRule: 'nonzero', drawnIn: { width: 100, height: 100 } }, box, fill),
        'path',
      ],
    ]
    for (const [layer, kind] of kinds) expect(rebuiltAsOne([layer], size).props.shape.kind).toBe(kind)
    const shaded = rebuiltAsOne([graphic({ kind: 'rect', cornerRadius: 0 }, box, { fill: SUNSET })], size)
    expect(shaded.props.fills.map((paint) => paint.type)).toEqual(['linear'])
  })

  it('rebuilds a pill with a drop shadow as one graphic with the shadow as its effect', () => {
    const shadow = { x: 0, y: 8, blur: 16, color: '#00000066' }
    const layer = rebuiltAsOne([shadowed(pill, shadow)], { width: 220, height: 140 })
    expect(layer.props.shape.kind).toBe('rect')
    expectBox(layer, pillBox)
    expectColour(flatFill(layer).color, GREEN)
    const effect = onlyOne(layer.props.effects)
    if (effect.type !== 'dropShadow') throw new Error(`a ${effect.type} effect`)
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

  it('keeps a picture of noise a picture, as it has too many parts', () => {
    const { answer, steps } = matched(noise(), { width: 90, height: 90 })
    expect(answer).toEqual({ kind: 'picture', why: 'tooManyParts' })
    expect(steps).toEqual(['patches'])
  })

  it('keeps a pattern too fine for the size it is cut at a picture, as it has too many parts', () => {
    expect(matchShapesOf(ck, halftone(), {})).toEqual({ kind: 'picture', why: 'tooManyParts' })
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

  it('keeps a piece with nothing to draw a picture, as no rebuild looks the same', () => {
    const nothing = [
      painted(1, 1, () => PAINT_RED),
      painted(50, 50, () => CLEAR),
      painted(200, 100, () => [220, 38, 38, 20]),
    ]
    for (const piece of nothing)
      expect(matchShapesOf(ck, piece, {})).toEqual({ kind: 'picture', why: 'looksDifferent' })
  })

  it('rebuilds nothing of what other layers hide: a hidden badge on a panel leaves the panel whole', () => {
    expect(rebuilt([panel, badge]).map((layer) => layer.name)).toEqual(['Blue rounded rectangle', 'Black rectangle'])
    const only = onlyOne(graphicsIn(matched([panel, badge], { around: { hidden: hides(badgeBox) } }).answer))
    expect(only.props.shape.kind).toBe('rect')
    expectBox(only, panelBox)
    expect(flatFill(only)).toEqual({ type: 'solid', color: BLUE })
  })

  it('makes no graphic of a shape other layers hide all of', () => {
    const { piece, hidden } = bandAndDisc()
    expect(graphicsIn(matchShapesOf(ck, piece, {}))).toHaveLength(3)
    const shown = graphicsIn(matchShapesOf(ck, piece, {}, { hidden }))
    expect(shown).toHaveLength(2)
    for (const layer of shown) {
      expect(flatFill(layer).color).not.toBe('#000000FF')
      // Neither is the disc, 60 px across: they are the band and the white beside it, as tall as the piece.
      expect(layer.props.width).toBeGreaterThan(90)
      expect(layer.props.height).toBeGreaterThan(190)
    }
  })

  it('rebuilds a disc half under a hidden block as one graphic that draws the disc where it shows', () => {
    const block = { x: 100, y: 0, width: 100, height: HEIGHT }
    const hidden = hides(block)
    const { piece, answer } = matched(
      [ellipse({ x: 40, y: 20, width: 100, height: 100 }, RED), rectangle(block, INK)],
      { around: { hidden } },
    )
    const only = onlyOne(graphicsIn(answer))
    expect(flatFill(only)).toEqual({ type: 'solid', color: RED })
    // Where nothing hides the piece, the graphic draws what the piece shows.
    const drawn = drawGraphics(ck, [only], WIDTH, HEIGHT)
    const shown = new Uint8Array(drawn.pixels)
    hidden.forEach((covered, i) => {
      if (covered) shown.set(piece.pixels.subarray(i * 4, i * 4 + 4), i * 4)
    })
    expect(looksSame('shape', piece, { width: WIDTH, height: HEIGHT, pixels: shown }).scores.far).toBe(0)
  })

  it('rebuilds a small piece with a hidden block on it as what shows around the block', () => {
    const blocked = painted(100, 40, (x, y) => (x >= 55 && x < 80 && y >= 12 && y < 28 ? PAINT_BLUE : PAINT_RED))
    const hidden = hiding({ x: 50, y: 8, width: 35, height: 24 }, 100, 40)
    const only = matchedAsOne(blocked, { hidden })
    expect(only.props.shape.kind).toBe('rect')
    expectBox(only, { x: 0, y: 0, width: 100, height: 40 })
  })

  it('judges a see-through piece over the colour behind it', () => {
    // Over the grey a piece is judged on when nothing is known, the dot shows and the rebuild misses it.
    expect(matched(glass).answer).toMatchObject({ kind: 'picture', why: 'looksDifferent' })
    expect(matched(glass, { around: { behind: [0, 0, 0] } }).answer).toMatchObject({
      kind: 'picture',
      why: 'looksDifferent',
    })
    const only = onlyOne(graphicsIn(matched(glass, { around: { behind: [255, 255, 255] } }).answer))
    expect(only.props.shape.kind).toBe('rect')
    expect(flatFill(only).opacity).toBeCloseTo(0.5, 1)
  })

  it('takes edge rows mixed with the colour behind the piece as the edges of the shape beside them', () => {
    const only = matchedAsOne(rimmed(), { behind: [255, 255, 255] })
    expect(only.props.shape.kind).toBe('rect')
    expect(Math.abs(only.props.width - 200)).toBeLessThanOrEqual(1)
    expect(only.props.height).toBeGreaterThanOrEqual(60)
    expect(only.props.height).toBeLessThanOrEqual(62.5)
    // With nothing known behind it, the rows are shapes of their own, or the block is no rectangle.
    const alone = matchShapesOf(ck, rimmed(), {})
    const kinds = alone.kind === 'layers' ? graphicsIn(alone).map((layer) => layer.props.shape.kind) : []
    expect(kinds).not.toEqual(['rect'])
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

  it('rebuilds a border with a bump on it by tracing it and what it holds, when the shapes look different', () => {
    const { answer, steps } = matched(bumpedCard, { width: 300, height: 240 })
    expect(steps).toEqual(['patches', 'graphics', 'judging', 'graphics', 'judging'])
    expect(answer.kind).toBe('layers')
  })

  it('gives the rule’s far share with its layers, and with a picture that was judged', () => {
    const { answer } = matched([panel])
    expect(answer.scores).toEqual({ far: 0 })
    expect(matched(glass).answer.scores?.far).toBeLessThan(0.015)
  })
})
