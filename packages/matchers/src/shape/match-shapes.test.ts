import { describe, expect, it } from 'vitest'

import type { Pixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type MatchAnswer, MatchJob, type Paint, type Shape } from '@dazbee/schema'

import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { firstPassOf } from './first-pass.ts'
import { matchShapes, matchShapesOf } from './match-shapes.ts'
import { photoScore } from './photo-guard.ts'
import { graphic, pngBase64, prototypeAnswer, prototypePieces } from './test-pieces.ts'

const ck = await loadCanvasKit()
const NAVY: Paint = { type: 'solid', color: '#1E3A8AFF' }
const CORAL: Paint = { type: 'solid', color: '#F2765AFF' }
const PROTOTYPE = prototypePieces(ck)

/** A piece's pixels matched twice: the two answers are one, and the first is returned. */
const matched = (piece: Pixels, colors: Record<string, `#${string}`> = {}): MatchAnswer => {
  const answer = matchShapesOf(ck, piece, colors)
  expect(matchShapesOf(ck, piece, colors)).toEqual(answer)
  return answer
}

/** The shape kinds of an answer's graphics, back to front. */
const kindsOf = (answer: MatchAnswer): string[] => {
  if (answer.kind !== 'layers') throw new Error(`a picture: ${answer.why}, far ${answer.scores?.far}`)
  return answer.layers.map((layer) => (layer.type === 'graphic' ? layer.props.shape.kind : layer.type))
}

/** A free shape of 14 corners at varied reach, in a box round its centre. */
const blob = (cx: number, cy: number, r: number, seed: number, color: `#${string}`): ShapeLayer => {
  const corners = Array.from({ length: 14 }, (_, i) => {
    const a = (i / 14) * 2 * Math.PI
    const reach = 0.7 + 0.3 * Math.abs(Math.sin(seed * (i + 1) * 1.7))
    return `${(50 + 50 * reach * Math.cos(a)).toFixed(2)} ${(50 + 50 * reach * Math.sin(a)).toFixed(2)}`
  })
  const shape: Shape = {
    kind: 'path',
    d: `M${corners.join(' L')} Z`,
    fillRule: 'nonzero',
    drawnIn: { width: 100, height: 100 },
  }
  return graphic(shape, { x: cx - r, y: cy - r, width: 2 * r, height: 2 * r }, { fill: { type: 'solid', color } })
}

describe('matchShapes', () => {
  it('rebuilds the piece of a job’s picture under its rect', () => {
    const star = graphic(
      { kind: 'star', points: 16, innerRadius: 0.8, cornerRadius: 0 },
      { x: 220, y: 20, width: 120, height: 120 },
      { fill: CORAL },
    )
    const job = MatchJob.parse({
      picture: pngBase64(ck, drawGraphics(ck, [star], 380, 160)),
      pieces: [{ kind: 'shape', rect: { x: 200, y: 0, width: 160, height: 160 } }],
      kit: { colors: {}, fonts: {}, textStyles: [] },
    })
    const piece = job.pieces[0]
    if (!piece) throw new Error('no piece')
    const answer = matchShapes(ck, job, piece)
    expect(matchShapes(ck, job, piece)).toEqual(answer)
    expect(kindsOf(answer)).toEqual(['star'])
  })
})

describe('matchShapesOf', () => {
  it('keeps the first pass’s answer when it looks the same in at most two graphics', () => {
    const piece = drawGraphics(
      ck,
      [
        graphic({ kind: 'rect', cornerRadius: 16 }, { x: 10, y: 10, width: 180, height: 100 }, { fill: NAVY }),
        graphic({ kind: 'ellipse' }, { x: 140, y: 30, width: 40, height: 40 }, { fill: CORAL }),
      ],
      200,
      120,
    )
    const answer = matched(piece)
    expect(kindsOf(answer)).toEqual(['rect', 'ellipse'])
    expect(answer).toEqual(firstPassOf(ck, piece, {}))
  })

  it('takes the full pass’s answer when the first pass’s doesn’t look the same', () => {
    const piece = drawGraphics(
      ck,
      [
        graphic(
          { kind: 'polygon', sides: 6, cornerRadius: 0 },
          { x: 20, y: 20, width: 120, height: 120 },
          { fill: NAVY },
        ),
      ],
      160,
      160,
    )
    expect(firstPassOf(ck, piece, {})).toMatchObject({ kind: 'picture', why: 'looksDifferent' })
    expect(kindsOf(matched(piece))).toEqual(['polygon'])
  })

  it('keeps a painted scene of five free shapes a picture, as a photo, when the first pass makes no graphics either', () => {
    const piece = drawGraphics(
      ck,
      [
        blob(50, 50, 45, 1, '#2E9E4FFF'),
        blob(110, 50, 45, 2, '#F47B20FF'),
        blob(50, 110, 45, 3, '#2563EBFF'),
        blob(110, 110, 45, 4, '#D61F8CFF'),
        blob(80, 80, 30, 5, '#FBD72BFF'),
      ],
      160,
      160,
    )
    expect(firstPassOf(ck, piece, {}).kind).toBe('picture')
    expect(matched(piece)).toMatchObject({ kind: 'picture', why: 'photo' })
  })

  it('keeps an empty piece a picture', () => {
    expect(matched(drawGraphics(ck, [], 80, 80))).toEqual({ kind: 'picture', why: 'looksDifferent' })
  })

  it.each(PROTOTYPE)('gives the shape baseline’s answer for $id, a $degradation $family', (piece) => {
    const answer = matched(piece.pixels, piece.kit)
    expect(answer).toEqual(prototypeAnswer(piece.ladder))
    if (answer.kind === 'layers')
      expect(photoScore(ck, piece.pixels, answer.layers)).toBeCloseTo(piece.ladder.photoScore ?? NaN, 9)
  })

  it('is checked against the baseline on every step of the ladder', () => {
    const layersOf = (answer: { decision: string; layers: unknown[] }) =>
      answer.decision === 'shapes' ? answer.layers.length : 0
    const steps = new Set(
      PROTOTYPE.map(({ firstPass, ladder }) => {
        if (ladder.decision === 'picture') return 'both pictures'
        if (JSON.stringify(ladder.layers) === JSON.stringify(firstPass.layers)) {
          return layersOf(firstPass) <= 2
            ? 'first pass, two graphics or fewer'
            : 'first pass, as few graphics as the full pass'
        }
        return firstPass.decision === 'shapes' ? 'full pass, fewer graphics' : 'full pass, first a picture'
      }),
    )
    expect([...steps].sort()).toEqual([
      'both pictures',
      'first pass, as few graphics as the full pass',
      'first pass, two graphics or fewer',
      'full pass, fewer graphics',
      'full pass, first a picture',
    ])
  })
})
