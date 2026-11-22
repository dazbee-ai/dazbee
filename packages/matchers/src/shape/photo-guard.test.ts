import { describe, expect, it } from 'vitest'

import type { Pixels } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type MatchAnswer, type Paint, UnplacedLayer } from '@dazbee/schema'

import { drawGraphics } from './draw-layers.ts'
import { hexColour } from './parts/colour.ts'
import { guardedAnswer, PHOTO_GUARD, photoScore } from './photo-guard.ts'
import { graphic, prototypePieces } from './test-pieces.ts'

const ck = await loadCanvasKit()
const NAVY: Paint = { type: 'solid', color: '#1E3A8AFF' }
const SCORES = { ssim: 0.98, inkMissed: 0, far: 0.001 }
const PROTOTYPE = prototypePieces(ck)

/** The photo of synthetic set 2 among the prototype's pieces: a soft, many-coloured cut-out. */
const photo = (): Pixels => {
  const piece = PROTOTYPE.find((p) => p.family === 'photo')
  if (!piece) throw new Error('no photo among the prototype’s pieces')
  return piece.pixels
}

/** A layers answer of one rectangle over the whole piece in its mean colour. */
const flatAnswer = (piece: Pixels): MatchAnswer => {
  const mean = [0, 0, 0]
  const n = piece.width * piece.height
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) mean[c] = (mean[c] ?? 0) + (piece.pixels[i * 4 + c] ?? 0) / n
  const fill: Paint = { type: 'solid', color: hexColour(mean[0] ?? 0, mean[1] ?? 0, mean[2] ?? 0) as `#${string}` }
  const layer = graphic(
    { kind: 'rect', cornerRadius: 0 },
    { x: 0, y: 0, width: piece.width, height: piece.height },
    { fill },
  )
  return { kind: 'layers', layers: [UnplacedLayer.parse(layer)], scores: SCORES, approximate: false }
}

describe('guardedAnswer', () => {
  it('keeps a photo whose graphics leave its shading, texture and colours unexplained a picture, why photo, with the rule’s numbers', () => {
    const piece = photo()
    const answer = guardedAnswer(ck, piece, flatAnswer(piece))
    expect(guardedAnswer(ck, piece, flatAnswer(piece))).toEqual(answer)
    expect(answer).toEqual({ kind: 'picture', why: 'photo', scores: SCORES })
  })

  it('passes graphics that explain their piece', () => {
    const layers = [
      graphic({ kind: 'rect', cornerRadius: 12 }, { x: 10, y: 10, width: 140, height: 80 }, { fill: NAVY }),
    ]
    const piece = drawGraphics(ck, layers, 160, 100)
    const answer: MatchAnswer = {
      kind: 'layers',
      layers: layers.map((l) => UnplacedLayer.parse(l)),
      scores: SCORES,
      approximate: false,
    }
    expect(guardedAnswer(ck, piece, answer)).toBe(answer)
  })

  it('passes a picture’s answer as it is', () => {
    const answer: MatchAnswer = { kind: 'picture', why: 'tooManyParts' }
    expect(guardedAnswer(ck, photo(), answer)).toBe(answer)
  })
})

describe('photoScore', () => {
  it.each(PROTOTYPE.filter((piece) => piece.firstPass.photoScore !== undefined))(
    'gives the prototype’s score of its first-pass graphics for $id, a $degradation $family',
    (piece) => {
      const layers = piece.firstPass.layers.map((layer) => UnplacedLayer.parse(layer))
      const score = photoScore(ck, piece.pixels, layers)
      expect(photoScore(ck, piece.pixels, layers)).toBe(score)
      expect(score).toBeCloseTo(piece.firstPass.photoScore ?? NaN, 9)
    },
  )

  it('scores a flat panel drawn exactly near 0, and a photo under one flat panel over the bar', () => {
    const layers = [graphic({ kind: 'ellipse' }, { x: 10, y: 10, width: 120, height: 80 }, { fill: NAVY })]
    expect(photoScore(ck, drawGraphics(ck, layers, 140, 100), layers)).toBeLessThan(0.1)
    const piece = photo()
    const flat = flatAnswer(piece)
    if (flat.kind !== 'layers') throw new Error('not a layers answer')
    expect(photoScore(ck, piece, flat.layers)).toBeGreaterThanOrEqual(PHOTO_GUARD.bar)
  })
})
