import { describe, expect, it } from 'vitest'

import { namedPoints, niceTicks } from './scale.ts'

describe('niceTicks', () => {
  it('steps by 1, 2, 2.5 or 5 times a power of ten, up to at or past the largest value', () => {
    expect(niceTicks(100)).toEqual([0, 25, 50, 75, 100])
    expect(niceTicks(7.3)).toEqual([0, 2, 4, 6, 8])
    expect(niceTicks(0.031)).toEqual([0, 0.01, 0.02, 0.03, 0.04])
    expect(niceTicks(1840)).toEqual([0, 500, 1000, 1500, 2000])
  })

  it('gives 0 and 1 when there is nothing to show', () => {
    expect(niceTicks(0)).toEqual([0, 1])
    expect(niceTicks(Number.NaN)).toEqual([0, 1])
  })
})

describe('namedPoints', () => {
  it('names every point that fits, and always the last', () => {
    expect([...namedPoints(7, 700)].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect([...namedPoints(30, 640)].sort((a, b) => a - b)).toEqual([2, 5, 8, 11, 14, 17, 20, 23, 26, 29])
    expect(namedPoints(1, 10)).toEqual(new Set([0]))
  })
})
