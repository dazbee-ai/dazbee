import { describe, expect, it } from 'vitest'

import type { Pixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type MatchAnswer, MatchJob, type Paint } from '@dazbee/schema'

import { drawGraphics } from './draw-layers.ts'
import { firstPassOf } from './first-pass.ts'
import { matchShapes, matchShapesOf } from './match-shapes.ts'
import { PHOTO_GUARD, photoScore } from './photo-guard.ts'
import { blob, graphic, pngBase64, prototypeAnswer, prototypePieces } from './test-pieces.ts'

const ck = await loadCanvasKit()
const NAVY: Paint = { type: 'solid', color: '#1E3A8AFF' }
const CORAL: Paint = { type: 'solid', color: '#F2765AFF' }
const PROTOTYPE = prototypePieces(ck)
/** The prototype's pieces but its photo, whose two passes take seconds to find too many parts; the first pass's tests check it. */
const LADDERED = PROTOTYPE.filter((piece) => piece.family !== 'photo')

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

/**
 * A grainy, photo-like picture: a flat green ground with 5 % of its pixels specks of many colours,
 * which one flat rectangle looks the same as but leaves unexplained.
 */
const grainy = (): Pixels => {
  const width = 200
  const height = 140
  const pixels = new Uint8Array(width * height * 4)
  let seed = 7
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const ground = [96, 140, 120]
  for (let i = 0; i < width * height; i++) {
    const speck = random() < 0.05
    for (let c = 0; c < 3; c++) {
      const base = ground[c] ?? 0
      pixels[i * 4 + c] = speck ? Math.max(0, Math.min(255, Math.round(base + (random() - 0.5) * 160))) : base
    }
    pixels[i * 4 + 3] = 255
  }
  return { width, height, pixels }
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

  it('keeps a grainy, photo-like picture a picture, as a photo, when the photo guard rejects the first pass’s rectangle', () => {
    const piece = grainy()
    const first = firstPassOf(ck, piece, {})
    if (first.kind !== 'layers') throw new Error(`the first pass made a picture: ${first.why}`)
    expect(kindsOf(first)).toEqual(['rect'])
    expect(photoScore(ck, piece, first.layers)).toBeGreaterThanOrEqual(PHOTO_GUARD.bar)
    expect(matched(piece)).toMatchObject({ kind: 'picture', why: 'photo' })
  })

  it('keeps an empty piece a picture', () => {
    expect(matched(drawGraphics(ck, [], 80, 80))).toEqual({ kind: 'picture', why: 'looksDifferent' })
  })

  it.each(LADDERED)('gives the shape baseline’s answer for $id, a $degradation $family', (piece) => {
    const answer = matched(piece.pixels, piece.kit)
    expect(answer).toEqual(prototypeAnswer(piece.ladder))
    if (answer.kind === 'layers')
      expect(photoScore(ck, piece.pixels, answer.layers)).toBeCloseTo(piece.ladder.photoScore ?? NaN, 9)
  })

  it('is checked against the baseline on every step of the ladder, a drop shadow included', () => {
    const layersOf = (answer: { decision: string; layers: unknown[] }) =>
      answer.decision === 'shapes' ? answer.layers.length : 0
    const steps = new Set(
      LADDERED.map(({ firstPass, ladder }) => {
        if (ladder.decision === 'picture') return 'both pictures'
        if (JSON.stringify(ladder.layers) === JSON.stringify(firstPass.layers)) {
          return layersOf(firstPass) <= 2
            ? 'first pass, two graphics or fewer'
            : 'first pass, as few graphics as the full pass'
        }
        return firstPass.decision === 'shapes' ? 'full pass, fewer graphics' : 'full pass, first a picture'
      }),
    )
    expect(JSON.stringify(LADDERED.map((piece) => piece.ladder))).toContain('"dropShadow"')
    expect([...steps].sort()).toEqual([
      'both pictures',
      'first pass, as few graphics as the full pass',
      'first pass, two graphics or fewer',
      'full pass, fewer graphics',
      'full pass, first a picture',
    ])
  })
})
