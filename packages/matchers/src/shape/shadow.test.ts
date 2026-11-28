import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import type { DropShadow } from '@dazbee/schema'

import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { hexRgb } from './parts/colour.ts'
import { type FloatPicture, shrinkFloats, toFloatPicture } from './parts/float-picture.ts'
import { shadowOf } from './shadow.ts'
import { ellipse, rectangle, shadowed } from './test-pieces.ts'

const ck = await loadCanvasKit()
const WIDTH = 220
const HEIGHT = 140

const pill = rectangle({ x: 40, y: 40, width: 140, height: 48 }, '#16A34AFF', 24)

/** Graphics drawn on a 220 × 140 piece, as floats. */
const drawn = (layers: ShapeLayer[]): FloatPicture => toFloatPicture(drawGraphics(ck, layers, WIDTH, HEIGHT))

/** The shadow fitted to a graphic drawn with one, against the graphic drawn without; fitted twice, the same both times. */
const fitted = (layer: ShapeLayer, shadow: Omit<DropShadow, 'type' | 'spread'>): DropShadow | null => {
  const once = shadowOf(drawn([shadowed(layer, shadow)]), drawn([layer]), 1)
  expect(shadowOf(drawn([shadowed(layer, shadow)]), drawn([layer]), 1)).toEqual(once)
  return once
}

/** Expects a fitted shadow's colour to be a drawn one's: each channel within 8 of 255, its alpha within 0.08. */
const expectColour = (fit: DropShadow | null, color: string) => {
  const [red, green, blue] = hexRgb(fit?.color ?? '')
  const [wantRed, wantGreen, wantBlue] = hexRgb(color)
  expect(Math.abs(red - wantRed)).toBeLessThanOrEqual(8)
  expect(Math.abs(green - wantGreen)).toBeLessThanOrEqual(8)
  expect(Math.abs(blue - wantBlue)).toBeLessThanOrEqual(8)
  const alpha = (hex: string) => parseInt(hex.slice(7, 9), 16) / 255
  expect(Math.abs(alpha(fit?.color ?? '') - alpha(color))).toBeLessThan(0.08)
}

describe('shadowOf', () => {
  it('fits a drop shadow’s offset, blur and colour close to what was drawn', () => {
    const shadow = { x: 4, y: 8, blur: 16, color: '#00000066' }
    const fit = fitted(pill, shadow)
    expect(fit).toMatchObject({ type: 'dropShadow', spread: 0 })
    expect(Math.abs((fit?.x ?? NaN) - 4)).toBeLessThan(1.5)
    expect(Math.abs((fit?.y ?? NaN) - 8)).toBeLessThan(1.5)
    expect(Math.abs((fit?.blur ?? NaN) - 16)).toBeLessThan(4)
    expectColour(fit, shadow.color)
  })

  it('fits a coloured shadow thrown up and to the left', () => {
    const shadow = { x: -6, y: -6, blur: 10, color: '#1E3A8A80' }
    const fit = fitted(pill, shadow)
    expect(Math.abs((fit?.x ?? NaN) + 6)).toBeLessThan(1.5)
    expect(Math.abs((fit?.y ?? NaN) + 6)).toBeLessThan(1.5)
    expect(Math.abs((fit?.blur ?? NaN) - 10)).toBeLessThan(4)
    expectColour(fit, shadow.color)
  })

  it('fits a glow with no offset in its colour', () => {
    const glow = { x: 0, y: 0, blur: 18, color: '#F59E0BCC' }
    const fit = fitted(pill, glow)
    expect(Math.abs(fit?.x ?? NaN)).toBeLessThan(0.5)
    expect(Math.abs(fit?.y ?? NaN)).toBeLessThan(0.5)
    expect(Math.abs((fit?.blur ?? NaN) - 18)).toBeLessThan(4)
    expectColour(fit, glow.color)
  })

  it('gives the shadow in the piece’s pixels when it is fitted at a smaller size', () => {
    const shadow = { x: 4, y: 8, blur: 16, color: '#00000066' }
    const half = (layers: ShapeLayer[]) => shrinkFloats(drawn(layers), WIDTH / 2, HEIGHT / 2)
    const fit = shadowOf(half([shadowed(pill, shadow)]), half([pill]), 0.5)
    expect(Math.abs((fit?.x ?? NaN) - 4)).toBeLessThan(1.5)
    expect(Math.abs((fit?.y ?? NaN) - 8)).toBeLessThan(1.5)
    expect(Math.abs((fit?.blur ?? NaN) - 16)).toBeLessThan(4)
  })

  it('gives null for a piece with no fringe', () => {
    expect(shadowOf(drawn([pill]), drawn([pill]), 1)).toBeNull()
  })

  it('gives null where what the graphics leave uncovered is no shadow of theirs', () => {
    // A disc beside the pill, which the graphics miss: sharp, and far from where a shadow of the pill would lie.
    const disc = ellipse({ x: 10, y: 100, width: 30, height: 30 }, '#111827FF')
    expect(shadowOf(drawn([pill, disc]), drawn([pill]), 1)).toBeNull()
  })
})
