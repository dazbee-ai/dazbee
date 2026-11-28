// The flat colours of a picture: its pixels' colours counted in bins of 5 bits a channel, the colours those bins
// make (the peaks of how densely they are filled, joined where a person can hardly tell them apart), how far each
// filled bin is from each colour, and the colours farthest from the ones found among the pixels none explains.

import { ciede2000, type Lab, srgbToLab } from '../looks-same/colour.ts'

/** Pixels counted by their bin of colour: how many each bin holds, and the sums of their red, green and blue. */
export interface Histogram {
  count: Int32Array
  sums: Float64Array
}

/** One of a picture's colours. */
export interface Colour {
  rgb: [number, number, number]
  lab: Lab
  count: number
  /** The histogram bins that are this colour; none for a colour added from unexplained pixels. */
  bins: number[]
}

/** The settings of the colours. */
export const PALETTE = {
  /** Colours closer than this ΔE00 are one colour. */
  merge: 7,
  /** Two peaks of colour are one when the fullest bin between them holds at least this share of the lower peak. */
  valley: 0.5,
  /** A pixel within this Lab distance of a colour, or of a mix of two, is explained by it. */
  explained: 10,
  /** The most colours a piece is cut into. */
  mostColours: 24,
} as const

/** How many bins of colour there are, of 5 bits a channel. */
export const BINS = 32 * 32 * 32

/** A histogram of no pixels. */
export function histogram(): Histogram {
  return { count: new Int32Array(BINS), sums: new Float64Array(BINS * 3) }
}

/** Counts pixel i of `data` in bin b. */
export function add(h: Histogram, b: number, data: Float32Array, i: number) {
  h.count[b] = (h.count[b] ?? 0) + 1
  h.sums[b * 3] = (h.sums[b * 3] ?? 0) + (data[i * 4] ?? 0)
  h.sums[b * 3 + 1] = (h.sums[b * 3 + 1] ?? 0) + (data[i * 4 + 1] ?? 0)
  h.sums[b * 3 + 2] = (h.sums[b * 3 + 2] ?? 0) + (data[i * 4 + 2] ?? 0)
}

/**
 * A histogram's colours: the peaks of how densely its bins are filled, each with the bins that climb to it. Two
 * peaks with no real valley between them (the fullest bin on their border holds at least a share of the lower
 * peak) are one colour, so an ink that shades from one tone to the next is one colour, and two inks are two however
 * close, as long as few pixels lie between them. Colours holding under `least` pixels are left out.
 */
export function coloursOf(h: Histogram, least: number): Colour[] {
  if (!Number.isFinite(least)) return []
  const filled: number[] = []
  for (let b = 0; b < BINS; b++) if (h.count[b]) filled.push(b)
  // How densely a bin is filled: its pixels twice, and its 26 neighbours' once.
  const density = new Float32Array(BINS)
  const around = (b: number, each: (neighbour: number) => void) => {
    const r = b >> 10
    const g = (b >> 5) & 31
    const u = b & 31
    for (let dr = -1; dr <= 1; dr++)
      for (let dg = -1; dg <= 1; dg++)
        for (let du = -1; du <= 1; du++) {
          if (!dr && !dg && !du) continue
          const rr = r + dr
          const gg = g + dg
          const uu = u + du
          if (rr < 0 || gg < 0 || uu < 0 || rr > 31 || gg > 31 || uu > 31) continue
          each((rr << 10) | (gg << 5) | uu)
        }
  }
  for (const b of filled) {
    density[b] = (density[b] ?? 0) + 2 * (h.count[b] ?? 0)
    around(b, (neighbour) => (density[neighbour] = (density[neighbour] ?? 0) + (h.count[b] ?? 0)))
  }
  filled.sort((x, y) => (density[y] ?? 0) - (density[x] ?? 0))
  const peakOf = new Int32Array(BINS).fill(-1)
  const joined: number[] = []
  const height: number[] = []
  const find = (c: number): number => {
    while (joined[c] !== c) c = joined[c] = joined[joined[c] ?? 0] ?? 0
    return c
  }
  for (const b of filled) {
    // The bins are taken from the densest down, so a neighbour with a peak already is uphill of this one.
    let up = -1
    let upDensity = -1
    around(b, (neighbour) => {
      if ((peakOf[neighbour] ?? 0) >= 0 && (density[neighbour] ?? 0) > upDensity) {
        upDensity = density[neighbour] ?? 0
        up = find(peakOf[neighbour] ?? 0)
      }
    })
    if (up < 0) {
      peakOf[b] = joined.length
      joined.push(joined.length)
      height.push(density[b] ?? 0)
      continue
    }
    peakOf[b] = up
    around(b, (neighbour) => {
      if ((peakOf[neighbour] ?? 0) < 0) return
      const other = find(peakOf[neighbour] ?? 0)
      const mine = find(up)
      if (other === mine) return
      if ((density[b] ?? 0) < PALETTE.valley * Math.min(height[other] ?? 0, height[mine] ?? 0)) return
      const [keep, drop] = (height[other] ?? 0) > (height[mine] ?? 0) ? [other, mine] : [mine, other]
      joined[drop] = keep
    })
  }
  const sums = new Map<number, { rgb: [number, number, number]; count: number; bins: number[] }>()
  for (const b of filled) {
    const peak = find(peakOf[b] ?? 0)
    let sum = sums.get(peak)
    if (!sum) sums.set(peak, (sum = { rgb: [0, 0, 0], count: 0, bins: [] }))
    sum.count += h.count[b] ?? 0
    sum.bins.push(b)
    for (let c = 0; c < 3; c++) sum.rgb[c] = (sum.rgb[c] ?? 0) + (h.sums[b * 3 + c] ?? 0)
  }
  const colours: Colour[] = [...sums.values()]
    .filter((sum) => sum.count >= least)
    .sort((x, y) => y.count - x.count)
    .slice(0, PALETTE.mostColours)
    .map(({ rgb, count, bins }) => {
      const mean: [number, number, number] = [rgb[0] / count, rgb[1] / count, rgb[2] / count]
      return { rgb: mean, lab: srgbToLab(...mean), count, bins }
    })
  // Two colours a person can hardly tell apart are one: the nearest pair is joined while it is within the merge ΔE00.
  for (;;) {
    let first = -1
    let second = -1
    let nearestPair: number = PALETTE.merge
    for (let i = 0; i < colours.length; i++)
      for (let j = i + 1; j < colours.length; j++) {
        const one = colours[i]
        const other = colours[j]
        if (!one || !other) continue
        const d = ciede2000(one.lab, other.lab)
        if (d < nearestPair) {
          nearestPair = d
          first = i
          second = j
        }
      }
    const a = colours[first]
    const b = colours[second]
    if (first < 0 || !a || !b) break
    const count = a.count + b.count
    const mean: [number, number, number] = [
      (a.rgb[0] * a.count + b.rgb[0] * b.count) / count,
      (a.rgb[1] * a.count + b.rgb[1] * b.count) / count,
      (a.rgb[2] * a.count + b.rgb[2] * b.count) / count,
    ]
    colours[first] = { rgb: mean, lab: srgbToLab(...mean), count, bins: [...a.bins, ...b.bins] }
    colours.splice(second, 1)
  }
  return colours
}

/**
 * How far each filled bin is from each colour, squared in Lab: from the nearest of the colour's own bins, or from
 * the colour itself when it has none. One row a bin of `used`, one column a colour.
 */
export function binDistances(palette: readonly Colour[], used: readonly number[], binLab: Float32Array): Float32Array {
  const distances = new Float32Array(used.length * palette.length)
  let members = 0
  for (const colour of palette) members += colour.bins.length || 1
  // Many bins and many bins of colours are a photo's; the colours themselves are then near enough.
  const exact = used.length * members <= 20_000_000
  used.forEach((b, row) => {
    palette.forEach((colour, column) => {
      let nearestSquared = lab2(binLab, b, colour.lab)
      if (exact && colour.bins.length) {
        nearestSquared = Infinity
        for (const own of colour.bins) {
          const d =
            ((binLab[b * 3] ?? 0) - (binLab[own * 3] ?? 0)) ** 2 +
            ((binLab[b * 3 + 1] ?? 0) - (binLab[own * 3 + 1] ?? 0)) ** 2 +
            ((binLab[b * 3 + 2] ?? 0) - (binLab[own * 3 + 2] ?? 0)) ** 2
          if (d < nearestSquared) nearestSquared = d
        }
      }
      distances[row * palette.length + column] = nearestSquared
    })
  })
  return distances
}

/**
 * Of the unexplained pixels' bins, the colours farthest from the ones found: the bin farthest from every colour
 * whose neighbourhood holds `least` pixels is one, then the farthest from it and them, up to four.
 */
export function farthestColours(
  h: Histogram,
  binLab: Float32Array,
  toPalette: (bin: number) => number,
  least: number,
): Colour[] {
  const bins: number[] = []
  for (let b = 0; b < BINS; b++) if (h.count[b]) bins.push(b)
  const found: Colour[] = []
  const taken = new Uint8Array(BINS)
  for (let pick = 0; pick < 4; pick++) {
    let best = -1
    let bestDistance = PALETTE.explained ** 2
    for (const b of bins) {
      if (taken[b]) continue
      let d = toPalette(b)
      for (const colour of found) d = Math.min(d, lab2(binLab, b, colour.lab))
      if (d <= bestDistance) continue
      // Its neighbourhood must hold enough pixels to be a colour of the drawing.
      let mass = 0
      const lab = labAt(binLab, b)
      for (const other of bins) if (lab2(binLab, other, lab) <= PALETTE.explained ** 2) mass += h.count[other] ?? 0
      if (mass < least) continue
      bestDistance = d
      best = b
    }
    if (best < 0) break
    const lab = labAt(binLab, best)
    // The colour is the mean of the bins nearest the farthest one: its core, not its mixes.
    const sums = [0, 0, 0]
    let count = 0
    for (const other of bins) {
      const d = lab2(binLab, other, lab)
      if (d <= PALETTE.explained ** 2) taken[other] = 1
      if (d > (PALETTE.explained / 2) ** 2) continue
      count += h.count[other] ?? 0
      for (let c = 0; c < 3; c++) sums[c] = (sums[c] ?? 0) + (h.sums[other * 3 + c] ?? 0)
    }
    const rgb: [number, number, number] = [(sums[0] ?? 0) / count, (sums[1] ?? 0) / count, (sums[2] ?? 0) / count]
    found.push({ rgb, lab: srgbToLab(...rgb), count, bins: [] })
  }
  return found
}

export function labAt(binLab: Float32Array, b: number): Lab {
  return [binLab[b * 3] ?? 0, binLab[b * 3 + 1] ?? 0, binLab[b * 3 + 2] ?? 0]
}

function lab2(binLab: Float32Array, b: number, lab: Lab): number {
  return (
    ((binLab[b * 3] ?? 0) - lab[0]) ** 2 +
    ((binLab[b * 3 + 1] ?? 0) - lab[1]) ** 2 +
    ((binLab[b * 3 + 2] ?? 0) - lab[2]) ** 2
  )
}
