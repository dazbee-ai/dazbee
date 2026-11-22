import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import type { GraphicProps, MatchAnswer, Paint, Shape } from '@dazbee/schema'

import { drawGraphics } from './draw-layers.ts'
import { fullPassOf } from './full-pass.ts'
import { graphic } from './test-pieces.ts'

const ck = await loadCanvasKit()
const CORAL: Paint = { type: 'solid', color: '#F2765AFF' }

/**
 * A dashed outline drawn by Dazbee 10 px in from the piece's edges, rebuilt twice: the two answers
 * are one, and the first is returned.
 */
const rebuilt = (
  shape: Shape,
  size: { width: number; height: number },
  stroke: { width: number; dashes: [number, number] },
): MatchAnswer => {
  const outline = graphic(
    shape,
    { x: 10, y: 10, ...size },
    { stroke: { paint: CORAL, width: stroke.width, align: 'inside', dashes: stroke.dashes, dashOffset: 0 } },
  )
  const piece = drawGraphics(ck, [outline], size.width + 20, size.height + 20)
  const answer = fullPassOf(ck, piece, {})
  expect(fullPassOf(ck, piece, {})).toEqual(answer)
  return answer
}

/** The answer's one graphic; fails a picture's answer and an answer of more graphics. */
const onlyGraphic = (answer: MatchAnswer): GraphicProps => {
  if (answer.kind !== 'layers') throw new Error(`a picture: ${answer.why}, far ${answer.scores?.far}`)
  expect(answer.layers).toHaveLength(1)
  const layer = answer.layers[0]
  if (layer?.type !== 'graphic') throw new Error(`a ${layer?.type}`)
  return layer.props
}

describe('dashed strokes', () => {
  it.each([
    ['rectangle', { kind: 'rect', cornerRadius: 0 }, { width: 200, height: 110 }, { width: 4, dashes: [12, 6] }],
    ['ellipse', { kind: 'ellipse' }, { width: 200, height: 120 }, { width: 4, dashes: [10, 6] }],
    [
      'polygon',
      { kind: 'polygon', sides: 6, cornerRadius: 0 },
      { width: 220, height: 220 },
      { width: 4, dashes: [4, 27] },
    ],
  ] as const)('rebuilds a dashed %s as one shape with one dashed stroke', (_, shape, size, stroke) => {
    const answer = rebuilt(shape, size, { width: stroke.width, dashes: [...stroke.dashes] })
    const props = onlyGraphic(answer)
    expect(props.shape).toMatchObject(shape.kind === 'polygon' ? { kind: 'polygon', sides: 6 } : { kind: shape.kind })
    expect(props.fills).toEqual([])
    expect(props.strokes).toEqual([
      expect.objectContaining({
        paint: expect.objectContaining({ type: 'solid', color: CORAL.color }),
        width: expect.closeTo(stroke.width, 0),
        dashes: [expect.any(Number), expect.any(Number)],
      }),
    ])
    expect(answer.kind === 'layers' && answer.layers[0]?.name).toMatch(/^Coral dashed .+ outline$/)
  })
})
