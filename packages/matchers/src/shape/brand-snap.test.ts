import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import type { Color, MatchKit } from '@dazbee/schema'

import { ciede2000, srgbToLab } from '../looks-same/colour.ts'
import { type Snapped, snapToBrand } from './brand-snap.ts'
import { hexRgb } from './colour.ts'
import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { graphic } from './test-pieces.ts'

const ck = await loadCanvasKit()
const KIT: MatchKit['colors'] = { primary: '#2563EBFF', accent: '#F2765AFF' }
/** ΔE00 3 from the kit's primary. */
const NEAR: Color = '#1D6BEBFF'
/** ΔE00 9 from the kit's primary. */
const FAR: Color = '#554CEBFF'

const deltaE = (a: Color, b: Color) => ciede2000(srgbToLab(...hexRgb(a)), srgbToLab(...hexRgb(b)))

const panel = (color: Color): ShapeLayer =>
  graphic(
    { kind: 'rect', cornerRadius: 12 },
    { x: 20, y: 20, width: 160, height: 80 },
    { fill: { type: 'solid', color } },
  )

const ring = (color: Color): ShapeLayer =>
  graphic(
    { kind: 'ellipse' },
    { x: 50, y: 10, width: 100, height: 100 },
    { stroke: { paint: { type: 'solid', color }, width: 10, align: 'inside' } },
  )

/** The graphics snapped against the piece they draw, twice: the two answers are one, and the first is returned. */
const snapped = (layers: ShapeLayer[], kit: MatchKit['colors'] = KIT): Snapped => {
  const piece = drawGraphics(ck, layers, 200, 120)
  const once = snapToBrand(ck, piece, layers, kit)
  expect(snapToBrand(ck, piece, layers, kit)).toEqual(once)
  return once
}

describe('snapToBrand', () => {
  it('snaps a fill 3 ΔE00 off a kit colour to it and binds it', () => {
    expect(deltaE(NEAR, KIT.primary ?? '')).toBeCloseTo(3, 1)
    const { layers, variables } = snapped([panel(NEAR)])
    expect(layers[0]?.bindings).toEqual({ fill: 'brand:primary' })
    expect(layers[0]?.props.fills).toEqual([{ type: 'solid', color: '#2563EBFF' }])
    expect(variables).toEqual({ 'brand:primary': '#2563EBFF', 'brand:accent': '#F2765AFF' })
  })

  it('leaves a fill 9 ΔE00 off every kit colour as it is', () => {
    expect(deltaE(FAR, KIT.primary ?? '')).toBeCloseTo(9, 1)
    const layer = panel(FAR)
    const { layers } = snapped([layer])
    expect(layers).toEqual([layer])
  })

  it('snaps a stroke’s colour unbound, as a stroke’s colour is not bindable', () => {
    const { layers } = snapped([ring(NEAR)])
    expect(layers[0]?.bindings).toBeUndefined()
    expect(layers[0]?.props.strokes[0]?.paint).toEqual({ type: 'solid', color: '#2563EBFF' })
  })

  it('snaps nothing with an empty kit', () => {
    const layer = panel(NEAR)
    expect(snapped([layer], {})).toEqual({ layers: [layer], variables: {} })
  })
})
