import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import { type GraphicProps, type MatchAnswer, MatchJob, type Paint, UnplacedLayer } from '@dazbee/schema'

import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { firstPass, firstPassOf } from './first-pass.ts'
import { graphic, pngBase64, prototypePieces } from './test-pieces.ts'

const ck = await loadCanvasKit()
const NAVY: Paint = { type: 'solid', color: '#1E3A8AFF' }
const CORAL: Paint = { type: 'solid', color: '#F2765AFF' }
const W = 240
const H = 160

/** A piece of graphics drawn by Dazbee, rebuilt twice: the two answers are one, and the first is returned. */
const rebuilt = (layers: readonly ShapeLayer[], width = W, height = H): MatchAnswer => {
  const piece = drawGraphics(ck, layers, width, height)
  const answer = firstPassOf(ck, piece, {})
  expect(firstPassOf(ck, piece, {})).toEqual(answer)
  return answer
}

/** The props of an answer's graphics, back to front; fails a picture's answer. */
const graphicsOf = (answer: MatchAnswer): GraphicProps[] => {
  if (answer.kind !== 'layers') throw new Error(`a picture: ${answer.why}, far ${answer.scores?.far}`)
  return answer.layers.map((layer) => {
    if (layer.type !== 'graphic') throw new Error(`a ${layer.type}`)
    return layer.props
  })
}

/** The answer's one graphic. */
const onlyGraphic = (answer: MatchAnswer): GraphicProps => {
  const graphics = graphicsOf(answer)
  expect(graphics).toHaveLength(1)
  return graphics[0] as GraphicProps
}

const PROTOTYPE = prototypePieces(ck)

describe('firstPass', () => {
  it('rebuilds the piece of a job’s picture under its rect', () => {
    const picture = drawGraphics(
      ck,
      [graphic({ kind: 'ellipse' }, { x: 300, y: 50, width: 100, height: 100 }, { fill: CORAL })],
      480,
      200,
    )
    const job = MatchJob.parse({
      picture: pngBase64(ck, picture),
      pieces: [{ kind: 'shape', rect: { x: 280.4, y: 30, width: 140, height: 140 } }],
      kit: { colors: {}, fonts: {}, textStyles: [] },
    })
    const piece = job.pieces[0]
    if (!piece) throw new Error('no piece')
    const answer = firstPass(ck, job, piece)
    expect(firstPass(ck, job, piece)).toEqual(answer)
    const ellipse = onlyGraphic(answer)
    expect(ellipse.shape.kind).toBe('ellipse')
    // The piece starts at the rect's first whole pixel, 280.
    expect(ellipse.x).toBeCloseTo(20, 0)
    expect(ellipse.width).toBeCloseTo(100, 0)
  })
})

describe('firstPassOf', () => {
  it('rebuilds a rectangle as a rectangle', () => {
    const rect = onlyGraphic(
      rebuilt([graphic({ kind: 'rect', cornerRadius: 0 }, { x: 40, y: 30, width: 160, height: 90 }, { fill: NAVY })]),
    )
    expect(rect.shape).toEqual({ kind: 'rect', cornerRadius: 0 })
    expect(rect.fills).toEqual([{ type: 'solid', color: '#1E3A8AFF' }])
    expect(rect).toMatchObject({ x: expect.closeTo(40, 0), y: expect.closeTo(30, 0), rotation: 0 })
    expect(rect.width).toBeCloseTo(160, 0)
    expect(rect.height).toBeCloseTo(90, 0)
  })

  it('rebuilds a rounded rectangle with its radius', () => {
    const rect = onlyGraphic(
      rebuilt([graphic({ kind: 'rect', cornerRadius: 18 }, { x: 40, y: 30, width: 160, height: 100 }, { fill: NAVY })]),
    )
    expect(rect.shape.kind).toBe('rect')
    expect(rect.shape.kind === 'rect' && rect.shape.cornerRadius).toBeCloseTo(18, -0.5)
  })

  it('rebuilds a pill as a rectangle rounded to half its height', () => {
    const pill = onlyGraphic(
      rebuilt([graphic({ kind: 'rect', cornerRadius: 30 }, { x: 30, y: 50, width: 180, height: 60 }, { fill: CORAL })]),
    )
    expect(pill.shape.kind).toBe('rect')
    expect(pill.shape.kind === 'rect' && pill.shape.cornerRadius).toBeCloseTo(pill.height / 2, 5)
  })

  it('rebuilds circles and ellipses as ellipses', () => {
    const circle = onlyGraphic(
      rebuilt([graphic({ kind: 'ellipse' }, { x: 70, y: 30, width: 100, height: 100 }, { fill: CORAL })]),
    )
    expect(circle.shape.kind).toBe('ellipse')
    expect(circle.width).toBeCloseTo(circle.height, 0)
    const ellipse = onlyGraphic(
      rebuilt([graphic({ kind: 'ellipse' }, { x: 30, y: 40, width: 180, height: 80 }, { fill: NAVY })]),
    )
    expect(ellipse.shape.kind).toBe('ellipse')
    expect(ellipse.width).toBeCloseTo(180, 0)
  })

  it('rebuilds a turned line as a line, and a level one as the thin rectangle it draws the same as', () => {
    const turned = onlyGraphic(
      rebuilt([
        graphic(
          { kind: 'line', start: 'none', end: 'none' },
          { x: 30, y: 78, width: 180, height: 4, rotation: 15 },
          { stroke: { paint: NAVY, width: 4, align: 'center', cap: 'round' } },
        ),
      ]),
    )
    expect(turned.shape.kind).toBe('line')
    expect(turned.rotation).toBeCloseTo(15, 0)
    expect(turned.strokes[0]?.width).toBeCloseTo(4, 0)
    // A level line with square ends covers just what a rectangle does, and a rectangle is as simple.
    const level = onlyGraphic(
      rebuilt([
        graphic(
          { kind: 'line', start: 'none', end: 'none' },
          { x: 30, y: 77, width: 180, height: 6 },
          { stroke: { paint: NAVY, width: 6, align: 'center' } },
        ),
      ]),
    )
    expect(level.shape).toEqual({ kind: 'rect', cornerRadius: 0 })
    expect(level.height).toBeCloseTo(6, 0)
  })

  it('rebuilds a ring and a rectangle frame as their shapes with a stroke inside', () => {
    const ring = onlyGraphic(
      rebuilt([
        graphic(
          { kind: 'ellipse' },
          { x: 60, y: 20, width: 120, height: 120 },
          { stroke: { paint: CORAL, width: 12, align: 'inside' } },
        ),
      ]),
    )
    expect(ring.shape.kind).toBe('ellipse')
    expect(ring.fills).toEqual([])
    expect(ring.strokes[0]).toMatchObject({ align: 'inside', width: expect.closeTo(12, -0.5) })
    const frame = onlyGraphic(
      rebuilt([
        graphic(
          { kind: 'rect', cornerRadius: 0 },
          { x: 30, y: 30, width: 180, height: 100 },
          { stroke: { paint: NAVY, width: 6, align: 'inside' } },
        ),
      ]),
    )
    expect(frame.shape.kind).toBe('rect')
    expect(frame.fills).toEqual([])
    expect(frame.strokes[0]).toMatchObject({ align: 'inside', width: expect.closeTo(6, -0.5) })
  })

  it('rebuilds a thin ring round another colour as a stroke over that colour’s shape', () => {
    const [ring, disc] = graphicsOf(
      rebuilt([
        graphic({ kind: 'ellipse' }, { x: 60, y: 20, width: 120, height: 120 }, { fill: CORAL }),
        graphic(
          { kind: 'ellipse' },
          { x: 60, y: 20, width: 120, height: 120 },
          { stroke: { paint: NAVY, width: 8, align: 'inside' } },
        ),
      ]),
    )
    expect(ring?.fills).toEqual([])
    expect(ring?.strokes[0]).toMatchObject({ align: 'inside', width: expect.closeTo(8, -0.5) })
    expect(ring?.width).toBeCloseTo(120, -0.5)
    expect(disc?.shape.kind).toBe('ellipse')
    expect(disc?.fills).toEqual([CORAL])
  })

  it('rebuilds a turned panel turned', () => {
    const panel = onlyGraphic(
      rebuilt([
        graphic(
          { kind: 'rect', cornerRadius: 0 },
          { x: 60, y: 40, width: 120, height: 80, rotation: 25 },
          { fill: NAVY },
        ),
      ]),
    )
    expect(panel.shape.kind).toBe('rect')
    expect(panel.rotation).toBeCloseTo(25, 0)
  })

  it('rebuilds a see-through panel with its fill’s opacity', () => {
    const panel = onlyGraphic(
      rebuilt([
        graphic(
          { kind: 'rect', cornerRadius: 0 },
          { x: 40, y: 30, width: 160, height: 100 },
          { fill: { ...NAVY, opacity: 0.6 } },
        ),
      ]),
    )
    expect(panel.shape.kind).toBe('rect')
    expect(panel.fills[0]?.opacity).toBeCloseTo(0.6, 1)
  })

  it('rebuilds a rectangle almost half under a circle whole, under the circle', () => {
    const [rect, circle] = graphicsOf(
      rebuilt(
        [
          graphic({ kind: 'rect', cornerRadius: 0 }, { x: 20, y: 20, width: 200, height: 130 }, { fill: NAVY }),
          graphic({ kind: 'ellipse' }, { x: 60, y: 25, width: 120, height: 120 }, { fill: CORAL }),
        ],
        W,
        170,
      ),
    )
    expect(rect?.shape.kind).toBe('rect')
    expect(rect?.width).toBeCloseTo(200, 0)
    expect(rect?.height).toBeCloseTo(130, 0)
    expect(circle?.shape.kind).toBe('ellipse')
    expect(circle?.fills).toEqual([CORAL])
  })

  it('rebuilds a rectangle whose corner is under a circle whole, under the circle', () => {
    const [rect, circle] = graphicsOf(
      rebuilt(
        [
          graphic({ kind: 'rect', cornerRadius: 0 }, { x: 20, y: 20, width: 150, height: 90 }, { fill: NAVY }),
          graphic({ kind: 'ellipse' }, { x: 110, y: 60, width: 100, height: 100 }, { fill: CORAL }),
        ],
        W,
        180,
      ),
    )
    expect(rect?.width).toBeCloseTo(150, 0)
    expect(rect?.height).toBeCloseTo(90, 0)
    expect(circle?.shape.kind).toBe('ellipse')
  })

  it('binds a fill near a kit colour to it', () => {
    const piece = drawGraphics(
      ck,
      [
        graphic(
          { kind: 'rect', cornerRadius: 12 },
          { x: 20, y: 20, width: 160, height: 80 },
          { fill: { type: 'solid', color: '#1D6BEBFF' } },
        ),
      ],
      200,
      120,
    )
    const kit = { primary: '#2563EBFF' } as const
    const answer = firstPassOf(ck, piece, kit)
    expect(firstPassOf(ck, piece, kit)).toEqual(answer)
    const [panel] = graphicsOf(answer)
    expect(panel?.fills).toEqual([{ type: 'solid', color: '#2563EBFF' }])
    expect(answer.kind === 'layers' && answer.layers[0]?.bindings).toEqual({ fill: 'brand:primary' })
  })

  it('keeps a piece with nothing to draw a picture', () => {
    expect(rebuilt([])).toEqual({ kind: 'picture', why: 'looksDifferent' })
  })

  it.each(PROTOTYPE)('gives the prototype’s first-pass answer for $id, a $degradation $family', (piece) => {
    const answer = firstPassOf(ck, piece.pixels, piece.kit)
    expect(firstPassOf(ck, piece.pixels, piece.kit)).toEqual(answer)
    const { decision, why, fitted, layers } = piece.firstPass
    const scores = fitted ? { ssim: fitted.ssim, inkMissed: fitted.inkMissed, far: fitted.far } : undefined
    if (decision === 'shapes') {
      expect(answer).toEqual({
        kind: 'layers',
        layers: layers.map((layer) => UnplacedLayer.parse(layer)),
        scores,
        approximate: false,
      })
    } else {
      expect(answer).toEqual({
        kind: 'picture',
        why: why.startsWith('looks different') ? 'looksDifferent' : 'tooManyParts',
        ...(scores ? { scores } : {}),
      })
    }
  })

  it('is checked against the prototype on pieces it rebuilds and pieces it keeps pictures, some bound to the kit', () => {
    const answers = PROTOTYPE.map((piece) => piece.firstPass)
    expect(answers.filter((a) => a.decision === 'shapes').length).toBeGreaterThanOrEqual(8)
    expect(answers.filter((a) => a.why.startsWith('looks different')).length).toBeGreaterThanOrEqual(2)
    expect(answers.filter((a) => a.why.startsWith('too')).length).toBeGreaterThanOrEqual(2)
    expect(answers.filter((a) => JSON.stringify(a.layers).includes('"brand:')).length).toBeGreaterThanOrEqual(3)
  })
})
