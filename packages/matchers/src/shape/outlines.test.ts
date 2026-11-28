import { describe, expect, it } from 'vitest'

import { holds, type Loop, marchingSquares } from './outlines.ts'

/** A mask of `width` × `height` pixels, each covered as `cover` says, 0 to 1. */
const maskOf = (width: number, height: number, cover: (x: number, y: number) => number): Float32Array =>
  Float32Array.from({ length: width * height }, (_, i) => cover(i % width, Math.floor(i / width)))

/** The most x an outline reaches. */
const rightOf = (loop: Loop | undefined): number => {
  let right = -Infinity
  for (let k = 0; k < (loop?.points.length ?? 0); k += 2) right = Math.max(right, loop?.points[k] ?? 0)
  return right
}

describe('marchingSquares', () => {
  it('gives a block one outer outline of its area, and a hole in it an outline of area below 0', () => {
    const block = maskOf(12, 10, (x, y) => (x >= 2 && x < 10 && y >= 2 && y < 8 ? 1 : 0))
    const [outline, ...others] = marchingSquares(block, 12, 10, 0.5, 0.5)
    expect(others).toEqual([])
    // An outline cuts each corner between the pixel centres, which takes an eighth of a pixel off its area.
    expect(outline?.area).toBeCloseTo(8 * 6 - 0.5, 5)
    const holed = maskOf(12, 10, (x, y) =>
      x >= 2 && x < 10 && y >= 2 && y < 8 && !(x >= 5 && x < 7 && y >= 4 && y < 6) ? 1 : 0,
    )
    const areas = marchingSquares(holed, 12, 10, 0.5, 0.5).map((loop) => loop.area)
    expect(areas).toHaveLength(2)
    expect(Math.max(...areas)).toBeCloseTo(8 * 6 - 0.5, 5)
    expect(Math.min(...areas)).toBeCloseTo(-(2 * 2 - 0.5), 5)
  })

  it('crosses a half-covered edge pixel where its cover ends, within a tenth of a pixel', () => {
    for (const cover of [0.25, 0.5, 0.75]) {
      // Columns 2 to 4 are covered, and column 5 by `cover`: the edge is drawn at 5 + cover.
      const mask = maskOf(9, 7, (x, y) => (y < 2 || y > 4 || x < 2 ? 0 : x < 5 ? 1 : x === 5 ? cover : 0))
      expect(Math.abs(rightOf(marchingSquares(mask, 9, 7, 0.5, 0.5)[0]) - (5 + cover))).toBeLessThan(0.1)
    }
  })

  it('moves the outline by where the mask starts', () => {
    const mask = maskOf(6, 6, (x, y) => (x >= 2 && x < 4 && y >= 2 && y < 4 ? 1 : 0))
    const here = rightOf(marchingSquares(mask, 6, 6, 0.5, 0.5)[0])
    expect(rightOf(marchingSquares(mask, 6, 6, 30.5, 0.5)[0])).toBeCloseTo(here + 30, 5)
  })
})

describe('holds', () => {
  const square = [10, 10, 30, 10, 30, 30, 10, 30]

  it('holds a point inside a closed outline and none outside it', () => {
    expect(holds(square, 20, 20)).toBe(true)
    expect(holds(square, 11, 29)).toBe(true)
    expect(holds(square, 5, 20)).toBe(false)
    expect(holds(square, 20, 31)).toBe(false)
  })

  it('holds a point whichever way round the outline runs', () => {
    const reversed = [10, 30, 30, 30, 30, 10, 10, 10]
    expect(holds(reversed, 20, 20)).toBe(true)
    expect(holds(reversed, 35, 20)).toBe(false)
  })
})
