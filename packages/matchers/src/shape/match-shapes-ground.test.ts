import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import type { Rgb } from '@dazbee/schema'

import { looksSame } from '../looks-same/rule.ts'
import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { matchShapesOf, type ShapeStep } from './match-shapes.ts'
import { decodePng } from './test-pieces.ts'

const ck = await loadCanvasKit()
/**
 * A split piece of an AI draft: a peach badge with a scalloped edge, cut from a dark green ground, whose edge
 * pixels the cut left mixed with that ground.
 */
const badge = decodePng(
  ck,
  readFileSync(join(import.meta.dirname, '..', '..', 'fixtures', 'shape', 'scalloped-badge.png')),
)
const GROUND: Rgb = [24, 55, 34]

describe('a piece whose edge is mixed with its ground', () => {
  it('is cut again without the ground when the first reading looks different, and keeps its scallops', () => {
    const steps: ShapeStep[] = []
    const answer = matchShapesOf(ck, badge, {}, { behind: GROUND }, (step) => steps.push(step))
    if (answer.kind !== 'layers') throw new Error(`a picture: ${answer.why}`)
    const layers = answer.layers as ShapeLayer[]
    expect(layers.map((layer) => layer.props.shape.kind)).toEqual(['path'])
    expect(looksSame('shape', badge, drawGraphics(ck, layers, badge.width, badge.height)).same).toBe(true)
    expect(steps.filter((step) => step === 'patches')).toHaveLength(2)
  })

  it('gives the same rebuild as with nothing known behind it', () => {
    const over = matchShapesOf(ck, badge, {}, { behind: GROUND })
    expect(over).toEqual(matchShapesOf(ck, badge, {}))
  })
})
