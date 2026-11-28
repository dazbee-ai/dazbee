import { describe, expect, it } from 'vitest'

import { ciede2000, srgbToLab } from '../looks-same/colour.ts'
import {
  add,
  binDistances,
  BINS,
  coloursOf,
  farthestColours,
  type Histogram,
  histogram,
  labAt,
  PALETTE,
} from './palette.ts'

type Rgb = [number, number, number]

const BLUE: Rgb = [37, 99, 235]
/** A blue in the same bin as BLUE. */
const BLUE_TOO: Rgb = [39, 101, 237]
const CORAL: Rgb = [242, 118, 90]
const GREEN: Rgb = [22, 163, 74]
const YELLOW: Rgb = [250, 204, 21]
const INK: Rgb = [17, 24, 39]
const WHITE: Rgb = [255, 255, 255]

/** A grey of one level. */
const grey = (level: number): Rgb => [level, level, level]

/** Ten greys from dark to light, each in the bin next to the one before. */
const TONES = Array.from({ length: 10 }, (_, k) => grey(84 + 8 * k))

/** A colour's bin, of 5 bits a channel. */
const binOf = ([red, green, blue]: Rgb): number => ((red >> 3) << 10) | ((green >> 3) << 5) | (blue >> 3)

/** A picture's data of runs of opaque pixels, each run of one colour: four numbers a pixel. */
const pictureOf = (runs: readonly (readonly [Rgb, number])[]): Float32Array =>
  Float32Array.from(runs.flatMap(([rgb, pixels]) => Array.from({ length: pixels }, () => [...rgb, 1]).flat()))

/** Runs of pixels counted in a histogram, each pixel in its colour's bin. */
const counted = (runs: readonly (readonly [Rgb, number])[]): Histogram => {
  const data = pictureOf(runs)
  const h = histogram()
  for (let i = 0; i < data.length / 4; i++)
    add(h, binOf([data[i * 4] ?? 0, data[i * 4 + 1] ?? 0, data[i * 4 + 2] ?? 0]), data, i)
  return h
}

/** The Lab of each filled bin's mean colour, three numbers a bin. */
const labsOf = (h: Histogram): Float32Array => {
  const binLab = new Float32Array(BINS * 3)
  for (let b = 0; b < BINS; b++) {
    const count = h.count[b] ?? 0
    if (!count) continue
    binLab.set(
      srgbToLab((h.sums[b * 3] ?? 0) / count, (h.sums[b * 3 + 1] ?? 0) / count, (h.sums[b * 3 + 2] ?? 0) / count),
      b * 3,
    )
  }
  return binLab
}

/** How far a bin is from one colour, squared in Lab: what a palette of that colour alone measures. */
const squaredFrom =
  (binLab: Float32Array, rgb: Rgb) =>
  (b: number): number => {
    const [l, a, u] = srgbToLab(...rgb)
    return ((binLab[b * 3] ?? 0) - l) ** 2 + ((binLab[b * 3 + 1] ?? 0) - a) ** 2 + ((binLab[b * 3 + 2] ?? 0) - u) ** 2
  }

describe('histogram', () => {
  it('holds no pixel in any of its bins, of 5 bits a channel', () => {
    const h = histogram()
    expect(BINS).toBe(32 * 32 * 32)
    expect(h.count).toHaveLength(BINS)
    expect(h.sums).toHaveLength(BINS * 3)
    expect(h.count.some((count) => count !== 0)).toBe(false)
    expect(h.sums.some((sum) => sum !== 0)).toBe(false)
  })
})

describe('add', () => {
  it('counts a pixel in its bin and sums its colour there, leaving the other bins as they were', () => {
    const data = pictureOf([
      [BLUE, 1],
      [BLUE_TOO, 1],
    ])
    const h = histogram()
    const b = binOf(BLUE)
    add(h, b, data, 0)
    expect(h.count[b]).toBe(1)
    expect([...h.sums.subarray(b * 3, b * 3 + 3)]).toEqual(BLUE)
    add(h, b, data, 1)
    expect(h.count[b]).toBe(2)
    expect([...h.sums.subarray(b * 3, b * 3 + 3)]).toEqual([76, 200, 472])
    expect(h.count.reduce((sum, count) => sum + count, 0)).toBe(2)
    expect(h.sums.reduce((sum, colour) => sum + colour, 0)).toBe(76 + 200 + 472)
  })
})

describe('coloursOf', () => {
  it('gives two well-separated flat colours as two colours, most pixels first, each with its mean rgb', () => {
    const [first, second, ...others] = coloursOf(
      counted([
        [CORAL, 40],
        [BLUE, 30],
        [BLUE_TOO, 30],
      ]),
      10,
    )
    expect(others).toEqual([])
    expect(first).toEqual({ rgb: [38, 100, 236], lab: srgbToLab(38, 100, 236), count: 60, bins: [binOf(BLUE)] })
    expect(second).toEqual({ rgb: CORAL, lab: srgbToLab(...CORAL), count: 40, bins: [binOf(CORAL)] })
  })

  it('joins two colours a person can hardly tell apart into one, and keeps two a person can tell apart', () => {
    // Two blues two bins apart, with no pixel between them.
    const deep: Rgb = [20, 20, 200]
    const deeper: Rgb = [20, 20, 216]
    expect(ciede2000(srgbToLab(...deep), srgbToLab(...deeper))).toBeLessThan(PALETTE.merge)
    const joined = coloursOf(
      counted([
        [deep, 30],
        [deeper, 10],
      ]),
      5,
    )
    expect(joined).toHaveLength(1)
    expect(joined[0]?.count).toBe(40)
    expect(joined[0]?.rgb).toEqual([20, 20, 204])
    expect(joined[0]?.bins).toEqual([binOf(deep), binOf(deeper)])
    const apart = coloursOf(
      counted([
        [grey(100), 30],
        [[140, 100, 100], 10],
      ]),
      5,
    )
    expect(apart.map((colour) => colour.count)).toEqual([30, 10])
  })

  it('gives a smooth run of tones as one colour, and its two ends alone as two', () => {
    const run = coloursOf(counted(TONES.map((tone) => [tone, 20] as const)), 5)
    expect(run).toHaveLength(1)
    expect(run[0]?.count).toBe(200)
    expect(run[0]?.rgb).toEqual(grey(120))
    expect([...(run[0]?.bins ?? [])].sort((a, b) => a - b)).toEqual(TONES.map(binOf))
    const ends = coloursOf(
      counted([
        [grey(84), 20],
        [grey(156), 20],
      ]),
      5,
    )
    expect(ends.map((colour) => colour.rgb)).toEqual([grey(84), grey(156)])
  })

  it('keeps two colours apart when few pixels lie between them', () => {
    const colours = coloursOf(
      counted([
        [grey(84), 100],
        [grey(92), 100],
        [grey(100), 2],
        [grey(108), 2],
        [grey(116), 100],
        [grey(124), 100],
      ]),
      5,
    )
    expect(colours.map((colour) => colour.count)).toEqual([202, 202])
  })

  it('leaves out a colour holding fewer pixels than the least', () => {
    const h = counted([
      [BLUE, 60],
      [CORAL, 5],
    ])
    expect(coloursOf(h, 6).map((colour) => colour.rgb)).toEqual([BLUE])
    expect(coloursOf(h, 5).map((colour) => colour.rgb)).toEqual([BLUE, CORAL])
  })

  it('gives no colour for an infinite least', () => {
    expect(coloursOf(counted([[BLUE, 60]]), Infinity)).toEqual([])
  })
})

describe('binDistances', () => {
  it('gives 0 for a colour’s own bin and more for a far bin, one row a used bin and one column a colour', () => {
    const navy: Rgb = [30, 60, 160]
    const h = counted([
      [BLUE, 60],
      [CORAL, 40],
    ])
    const binLab = labsOf(
      counted([
        [BLUE, 60],
        [CORAL, 40],
        [navy, 1],
      ]),
    )
    const distances = binDistances(coloursOf(h, 10), [binOf(BLUE), binOf(CORAL), binOf(navy)], binLab)
    expect(distances).toHaveLength(6)
    // The blue bin's row, then the coral bin's: the blue column first.
    expect(distances[0]).toBe(0)
    expect(Math.sqrt(distances[1] ?? 0)).toBeCloseTo(113.8, 1)
    expect(Math.sqrt(distances[2] ?? 0)).toBeCloseTo(113.8, 1)
    expect(distances[3]).toBe(0)
    // Navy is nearer blue than coral, and neither's own.
    expect(distances[4]).toBeGreaterThan(0)
    expect(distances[4] ?? 0).toBeLessThan(distances[5] ?? 0)
  })

  it('measures from the nearest of a colour’s own bins, and from the colour itself when it has none', () => {
    const h = counted(TONES.map((tone) => [tone, 20] as const))
    const binLab = labsOf(h)
    const [run] = coloursOf(h, 5)
    if (!run) throw new Error('no colour')
    const ends = [binOf(grey(84)), binOf(grey(156))]
    expect([...binDistances([run], ends, binLab)]).toEqual([0, 0])
    const [dark, light] = binDistances([{ ...run, bins: [] }], ends, binLab)
    expect(dark).toBeCloseTo((srgbToLab(84, 84, 84)[0] - run.lab[0]) ** 2, 1)
    expect(light).toBeCloseTo((srgbToLab(156, 156, 156)[0] - run.lab[0]) ** 2, 1)
    expect(dark).toBeGreaterThan(PALETTE.explained ** 2)
  })
})

describe('farthestColours', () => {
  it('finds a colour the palette lacks among the unexplained pixels when it holds the least pixels', () => {
    const left = counted([[CORAL, 40]])
    const binLab = labsOf(left)
    expect(farthestColours(left, binLab, squaredFrom(binLab, BLUE), 40)).toEqual([
      { rgb: CORAL, lab: srgbToLab(...CORAL), count: 40, bins: [] },
    ])
    expect(farthestColours(left, binLab, squaredFrom(binLab, BLUE), 41)).toEqual([])
  })

  it('finds none among pixels the palette explains', () => {
    const left = counted([[BLUE_TOO, 40]])
    const binLab = labsOf(left)
    expect(farthestColours(left, binLab, squaredFrom(binLab, BLUE), 40)).toEqual([])
    expect(farthestColours(left, binLab, squaredFrom(binLab, CORAL), 40)).toHaveLength(1)
  })

  it('gives the mean of the colour’s core, leaving out its mixes, which count towards the least', () => {
    // Coral mixed with a little blue: within the explained distance of coral, and outside half of it.
    const mix: Rgb = [232, 117, 97]
    const left = counted([
      [CORAL, 40],
      [mix, 10],
    ])
    const binLab = labsOf(left)
    const [found, ...others] = farthestColours(left, binLab, squaredFrom(binLab, BLUE), 50)
    expect(others).toEqual([])
    expect(found?.rgb).toEqual(CORAL)
    expect(found?.count).toBe(40)
    expect(farthestColours(left, binLab, squaredFrom(binLab, BLUE), 51)).toEqual([])
  })

  it('finds up to four colours, each the farthest from the palette and from the ones found before it', () => {
    const left = counted([CORAL, GREEN, YELLOW, INK, WHITE].map((rgb) => [rgb, 40] as const))
    const binLab = labsOf(left)
    const found = farthestColours(left, binLab, squaredFrom(binLab, BLUE), 40)
    expect(found.map((colour) => colour.rgb)).toEqual([YELLOW, WHITE, INK, GREEN])
  })
})

describe('labAt', () => {
  it('reads a bin’s Lab, three numbers a bin', () => {
    const binLab = new Float32Array(BINS * 3)
    binLab.set([50, 10, -20], 7 * 3)
    expect(labAt(binLab, 7)).toEqual([50, 10, -20])
    expect(labAt(binLab, 8)).toEqual([0, 0, 0])
  })
})
