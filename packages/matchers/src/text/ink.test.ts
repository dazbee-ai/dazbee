import { describe, expect, it } from 'vitest'

import { type Box, type Ink, inkBox } from './ink.ts'

/** Ink 12 × 9 the same every time: a pixel in about four is inked, each somewhere from 0 to 1. */
function speckled(): Ink {
  const width = 12
  const height = 9
  const data = new Float32Array(width * height)
  // A linear congruential generator, so the ink is the same in every runtime.
  let seed = 5
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
    data[i] = seed >>> 30 === 0 ? ((seed >>> 8) & 255) / 255 : 0
  }
  return { width, height, data }
}

/** The box round the pixels above `threshold` within `within`, each pixel read; null when there are none. */
function boxByEveryPixel(ink: Ink, threshold: number, within: Box): Box | null {
  const inked: { x: number; y: number }[] = []
  for (let y = within.y; y < within.y + within.h; y++)
    for (let x = within.x; x < within.x + within.w; x++)
      if ((ink.data[y * ink.width + x] ?? 0) > threshold) inked.push({ x, y })
  if (inked.length === 0) return null
  const xs = inked.map((p) => p.x)
  const ys = inked.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x + 1, h: Math.max(...ys) - y + 1 }
}

describe('inkBox', () => {
  const ink = speckled()
  const whole = { x: 0, y: 0, w: ink.width, h: ink.height }

  it.each([0, 0.25, 0.5, 0.9])('gives the box round the ink above %s', (threshold) => {
    expect(inkBox(ink, threshold)).toEqual(boxByEveryPixel(ink, threshold, whole))
  })

  it.each([
    { x: 3, y: 2, w: 6, h: 5 },
    { x: 0, y: 4, w: 12, h: 2 },
    { x: 7, y: 0, w: 1, h: 9 },
    { x: 5, y: 5, w: 1, h: 1 },
  ])('gives the box round the ink within $w × $h at $x, $y', (within) => {
    expect(inkBox(ink, 0.25, within)).toEqual(boxByEveryPixel(ink, 0.25, within))
  })

  it('gives null when no pixel is above the threshold, and for a box of no pixels', () => {
    expect(inkBox(ink, 1)).toBeNull()
    expect(inkBox({ width: 4, height: 3, data: new Float32Array(12) }, 0)).toBeNull()
    expect(inkBox(ink, 0, { x: 2, y: 2, w: 0, h: 4 })).toBeNull()
  })

  it('gives a single inked pixel as a box of one', () => {
    const data = new Float32Array(20)
    data[13] = 1
    expect(inkBox({ width: 5, height: 4, data })).toEqual({ x: 3, y: 2, w: 1, h: 1 })
  })
})
