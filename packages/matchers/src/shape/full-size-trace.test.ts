import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import type { Paint } from '@dazbee/schema'

import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { fullPassOf } from './full-pass.ts'

const ck = await loadCanvasKit()
const NAVY: Paint = { type: 'solid', color: '#1E3A8AFF' }

/**
 * An AI-like pill: a `width` × `height` pill whose edge is pushed in and out by up to `off` pixels,
 * three waves round it, as an image model draws a pill that is no perfect one.
 */
const aiPill = (width: number, height: number, off: number): ShapeLayer => {
  const r = height / 2
  const straight = width - height
  const length = 2 * straight + Math.PI * height
  const points: string[] = []
  const count = Math.round(length / 2)
  for (let i = 0; i < count; i++) {
    const s = (i / count) * length
    let x: number
    let y: number
    let nx = 0
    let ny: number
    if (s < straight) [x, y, ny] = [r + s, 0, -1]
    else if (s < straight + Math.PI * r) {
      const a = -Math.PI / 2 + (s - straight) / r
      ;[x, y, nx, ny] = [width - r + r * Math.cos(a), r + r * Math.sin(a), Math.cos(a), Math.sin(a)]
    } else if (s < 2 * straight + Math.PI * r) [x, y, ny] = [width - r - (s - straight - Math.PI * r), height, 1]
    else {
      const a = Math.PI / 2 + (s - 2 * straight - Math.PI * r) / r
      ;[x, y, nx, ny] = [r + r * Math.cos(a), r + r * Math.sin(a), Math.cos(a), Math.sin(a)]
    }
    const push = off * Math.sin((2 * Math.PI * 3 * s) / length)
    points.push(`${(x + nx * push).toFixed(2)} ${(y + ny * push).toFixed(2)}`)
  }
  return {
    type: 'graphic',
    name: 'pill',
    props: {
      x: 10,
      y: 10,
      width,
      height,
      rotation: 0,
      shape: { kind: 'path', d: `M${points.join(' L')} Z`, fillRule: 'nonzero', drawnIn: { width, height } },
      fills: [NAVY],
      strokes: [],
    },
  }
}

describe('tracedAtFullSize', () => {
  it.each([
    ['split again at its full size', 300, 80],
    ['small enough to be fitted at its own size', 180, 56],
  ])('rebuilds an AI-like pill a pixel and a half off a perfect one as one path, %s', (_, width, height) => {
    const piece = drawGraphics(ck, [aiPill(width, height, 1.6)], width + 20, height + 20)
    const answer = fullPassOf(ck, piece, {})
    expect(fullPassOf(ck, piece, {})).toEqual(answer)
    if (answer.kind !== 'layers') throw new Error(`a picture: ${answer.why}, far ${answer.scores?.far}`)
    expect(answer.layers).toHaveLength(1)
    const layer = answer.layers[0]
    if (layer?.type !== 'graphic') throw new Error(`a ${layer?.type}`)
    expect(layer.props.shape).toMatchObject({ kind: 'path', fillRule: 'evenodd' })
    expect(layer.props.fills).toEqual([NAVY])
    expect(layer.props.width).toBeCloseTo(width, -1)
  })
})
