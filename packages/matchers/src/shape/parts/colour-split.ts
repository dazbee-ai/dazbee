// The colour split: a piece cut into parts of one colour each. k-means in CIE L*a*b* over the
// piece's opaque pixels from seeded starts, colours closer than a ΔE00 merged, every covered pixel
// labelled with its nearest colour, one 3×3 majority vote, specks folded into their neighbours, and
// the labels cut into connected parts. Each part has a soft coverage mask: inside, the piece's alpha
// over the part's; at an edge with another colour, how far the pixel's colour lies towards the part's.

import { ciede2000, type Lab, srgbToLab } from '../../looks-same/colour.ts'
import { labToSrgb, type SrgbFloat } from './colour.ts'
import { colourRuns } from './colour-runs.ts'
import type { FloatPicture } from './float-picture.ts'

/** A part's box in pixels, its first and last column and row. */
export interface PixelBox {
  x0: number
  y0: number
  x1: number
  y1: number
}

/** One connected run of one colour in the piece. */
export interface Part {
  id: number
  /** The colour cluster it was labelled with. */
  label: number
  /** Its colour, the median of its inner pixels. */
  lab: Lab
  rgb: SrgbFloat
  /** The median alpha of its inner pixels: under 1 for a see-through panel. */
  alpha: number
  /** How many pixels are labelled with it. */
  area: number
  /** Soft coverage, 0 to 1 a pixel, over the whole piece. */
  mask: Float32Array
  box: PixelBox
  /** The mean ΔE00 of its inner pixels to its colour: high for a texture or a gradient. */
  spread: number
  touchesEdge: boolean
}

/** A piece split by colour: its parts, and each pixel's colour cluster (-1 where uncovered). */
export interface ColourSplit {
  parts: Part[]
  labels: Int32Array
  /** Set when the split stopped at too many parts: how many it found. */
  tooMany?: number
}

/** How finely a piece is split. */
export interface SplitOptions {
  /** Clusters closer than this ΔE00 are one colour. */
  mergeDeltaE: number
  /** The most colours tried before merging. */
  k: number
  /** Specks under this many pixels are folded into a neighbour. */
  minArea: number
  /** The alpha from which a pixel is covered. */
  cut: number
  /** More parts than this and the split stops: the piece is too detailed to rebuild. */
  maxParts: number
}

/** Pixels sampled for k-means, about. */
const SAMPLE = 6000
/** How far, in pixels, a faint edge pixel outside every part looks for the part it fades from. */
const FADE_REACH = 3

/** Splits a picture into parts of one colour each. */
export function splitColours(picture: FloatPicture, options: SplitOptions): ColourSplit {
  const { width, height, data } = picture
  const n = width * height
  const lab = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const [l, a, b] = srgbToLab(data[i * 4] ?? 0, data[i * 4 + 1] ?? 0, data[i * 4 + 2] ?? 0)
    lab[i * 3] = l
    lab[i * 3 + 1] = a
    lab[i * 3 + 2] = b
  }
  const centres = cluster(picture, lab, options)
  const labels = new Int32Array(n).fill(-1)
  for (let i = 0; i < n; i++) {
    if ((data[i * 4 + 3] ?? 0) < options.cut) continue
    let best = 0
    let bestDistance = Infinity
    for (let c = 0; c < centres.length; c++) {
      const d = distance2(lab, i, centres[c] ?? [0, 0, 0])
      if (d < bestDistance) {
        bestDistance = d
        best = c
      }
    }
    labels[i] = best
  }
  const runs = colourRuns(labels, width, height, options.minArea)
  if (runs.list.length > options.maxParts) return { parts: [], labels, tooMany: runs.list.length }
  const near = nearestRun(runs.of, picture, FADE_REACH)
  const parts = runs.list.map((run, id) => partOf(picture, lab, labels, runs.of, near, id, run.label, centres))
  return { parts, labels }
}

/**
 * The cluster colours: k-means++ starts from a fixed generator over a sample of the opaque pixels,
 * ten Lloyd steps, then near-empty clusters dropped and the nearest pair merged while it is under
 * the merge ΔE00, three Lloyd steps after each change.
 */
function cluster(picture: FloatPicture, lab: Float32Array, options: SplitOptions): Lab[] {
  const { width, height, data } = picture
  const n = width * height
  const pool: number[] = []
  for (let i = 0; i < n; i++) if ((data[i * 4 + 3] ?? 0) > 0.9) pool.push(i)
  if (pool.length < 50) for (let i = 0; i < n; i++) if ((data[i * 4 + 3] ?? 0) >= options.cut) pool.push(i)
  if (pool.length === 0) return [[50, 0, 0]]
  const step = Math.max(1, Math.floor(pool.length / SAMPLE))
  const sample = pool.filter((_, j) => j % step === 0)
  let seed = 12345
  const random = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const at = (i: number): Lab => [lab[i * 3] ?? 0, lab[i * 3 + 1] ?? 0, lab[i * 3 + 2] ?? 0]
  let centres: Lab[] = [at(sample[Math.floor(random() * sample.length)] ?? 0)]
  const d2 = new Float32Array(sample.length).fill(Infinity)
  while (centres.length < options.k) {
    let sum = 0
    const last = centres[centres.length - 1] ?? [0, 0, 0]
    for (let j = 0; j < sample.length; j++) {
      d2[j] = Math.min(d2[j] ?? 0, distance2(lab, sample[j] ?? 0, last))
      sum += d2[j] ?? 0
    }
    if (sum < 1e-6) break
    let r = random() * sum
    let pick = sample.length - 1
    for (let j = 0; j < sample.length; j++)
      if ((r -= d2[j] ?? 0) <= 0) {
        pick = j
        break
      }
    centres.push(at(sample[pick] ?? 0))
  }
  const nearestCentre = (i: number) => {
    let best = 0
    let bestDistance = Infinity
    for (let c = 0; c < centres.length; c++) {
      const d = distance2(lab, i, centres[c] ?? [0, 0, 0])
      if (d < bestDistance) {
        bestDistance = d
        best = c
      }
    }
    return best
  }
  const lloyd = (steps: number) => {
    for (let s = 0; s < steps; s++) {
      const sums = centres.map(() => [0, 0, 0, 0])
      for (const i of sample) {
        const acc = sums[nearestCentre(i)] ?? [0, 0, 0, 0]
        acc[0] = (acc[0] ?? 0) + (lab[i * 3] ?? 0)
        acc[1] = (acc[1] ?? 0) + (lab[i * 3 + 1] ?? 0)
        acc[2] = (acc[2] ?? 0) + (lab[i * 3 + 2] ?? 0)
        acc[3] = (acc[3] ?? 0) + 1
      }
      const next: Lab[] = []
      for (const [l, a, b, count] of sums as [number, number, number, number][])
        if (count > 0) next.push([l / count, a / count, b / count])
      centres = next
    }
  }
  lloyd(10)
  for (;;) {
    const weights = centres.map(() => 0)
    for (const i of sample) {
      const c = nearestCentre(i)
      weights[c] = (weights[c] ?? 0) + 1
    }
    // Clusters holding under 0.2 % of the sample are dropped.
    const kept = centres.filter((_, c) => (weights[c] ?? 0) > sample.length * 0.002)
    if (kept.length < centres.length && kept.length > 0) {
      centres = kept
      lloyd(3)
      continue
    }
    let bi = -1
    let bj = -1
    let bestDistance = Infinity
    for (let i = 0; i < centres.length; i++)
      for (let j = i + 1; j < centres.length; j++) {
        const d = ciede2000(centres[i] ?? [0, 0, 0], centres[j] ?? [0, 0, 0])
        if (d < bestDistance) {
          bestDistance = d
          bi = i
          bj = j
        }
      }
    if (bi < 0 || bestDistance >= options.mergeDeltaE) break
    const wi = weights[bi] ?? 0
    const wj = weights[bj] ?? 0
    const total = wi + wj || 1
    const ci = centres[bi] ?? [0, 0, 0]
    const cj = centres[bj] ?? [0, 0, 0]
    centres[bi] = [
      (ci[0] * wi + cj[0] * wj) / total,
      (ci[1] * wi + cj[1] * wj) / total,
      (ci[2] * wi + cj[2] * wj) / total,
    ]
    centres.splice(bj, 1)
    lloyd(3)
  }
  return centres
}

/** The squared Lab distance from pixel i to a colour. */
function distance2(lab: Float32Array, i: number, c: Lab): number {
  return ((lab[i * 3] ?? 0) - c[0]) ** 2 + ((lab[i * 3 + 1] ?? 0) - c[1]) ** 2 + ((lab[i * 3 + 2] ?? 0) - c[2]) ** 2
}

/** For faint pixels outside every run (an edge's fade), the run within `reach` pixels nearest them. */
function nearestRun(runOf: Int32Array, picture: FloatPicture, reach: number): Int32Array {
  const { width, height, data } = picture
  const n = width * height
  const near = runOf.slice()
  let frontier: number[] = []
  for (let i = 0; i < n; i++) if ((near[i] ?? -1) >= 0) frontier.push(i)
  for (let step = 0; step < reach; step++) {
    const next: number[] = []
    for (const i of frontier) {
      const x = i % width
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (j < 0 || j >= n || (near[j] ?? 0) >= 0 || (data[j * 4 + 3] ?? 0) <= 0.004) continue
        near[j] = near[i] ?? -1
        next.push(j)
      }
    }
    frontier = next
  }
  return near
}

/** One run as a part: its colour, alpha and spread from its inner pixels, and its soft coverage. */
function partOf(
  picture: FloatPicture,
  lab: Float32Array,
  labels: Int32Array,
  runOf: Int32Array,
  near: Int32Array,
  id: number,
  label: number,
  centres: Lab[],
): Part {
  const { width, height, data } = picture
  const n = width * height
  const mask = new Float32Array(n)
  const labAt = (i: number): Lab => [lab[i * 3] ?? 0, lab[i * 3 + 1] ?? 0, lab[i * 3 + 2] ?? 0]
  let area = 0
  let x0 = width
  let y0 = height
  let x1 = -1
  let y1 = -1
  const inner: number[] = []
  let touchesEdge = false
  for (let i = 0; i < n; i++) {
    if (runOf[i] !== id) continue
    area++
    const x = i % width
    const y = (i - x) / width
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
    if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesEdge = true
    const interior =
      x > 0 &&
      y > 0 &&
      x < width - 1 &&
      y < height - 1 &&
      runOf[i - 1] === id &&
      runOf[i + 1] === id &&
      runOf[i - width] === id &&
      runOf[i + width] === id
    if (interior) inner.push(i)
  }
  const all = inner.length >= 8 ? inner : [...Array(n).keys()].filter((i) => runOf[i] === id)
  const every = Math.max(1, Math.floor(all.length / 2000))
  const picked = all.filter((_, j) => j % every === 0)
  const channelMedian = (k: number) => median(picked.map((i) => lab[i * 3 + k] ?? 0))
  const partLab: Lab = [channelMedian(0), channelMedian(1), channelMedian(2)]
  const alpha = median(picked.map((i) => data[i * 4 + 3] ?? 0))
  let spread = 0
  for (const i of picked) spread += ciede2000(partLab, labAt(i))
  spread /= picked.length || 1
  for (let i = 0; i < n; i++) {
    const run = runOf[i] ?? -1
    const own = run === id
    if (run < 0) {
      // A faint edge pixel takes its alpha when this part is the nearest and its colour is near
      // this part's: a faint pixel of another colour (a shadow's edge) is not this part's.
      const dl = Math.hypot(
        (lab[i * 3] ?? 0) - partLab[0],
        (lab[i * 3 + 1] ?? 0) - partLab[1],
        (lab[i * 3 + 2] ?? 0) - partLab[2],
      )
      if (near[i] === id && dl < 12) mask[i] = Math.min(1, (data[i * 4 + 3] ?? 0) / Math.max(alpha, 0.05))
      continue
    }
    const x = i % width
    const y = (i - x) / width
    let nearOwn = own
    let other = -1
    for (const j of [
      x > 0 ? i - 1 : -1,
      x < width - 1 ? i + 1 : -1,
      y > 0 ? i - width : -1,
      y < height - 1 ? i + width : -1,
    ]) {
      if (j < 0) continue
      if (runOf[j] === id) nearOwn = true
      else if ((labels[j] ?? -1) >= 0 && labels[j] !== label) other = labels[j] ?? -1
    }
    if (!nearOwn) continue
    const a = Math.min(1, (data[i * 4 + 3] ?? 0) / Math.max(alpha, 0.05))
    if (own && other < 0) {
      mask[i] = a
      continue
    }
    // At an edge with another colour, the share of the way from that colour to this part's.
    const otherCentre = centres[other]
    if (otherCentre) {
      const t = project(labAt(i), otherCentre, partLab)
      mask[i] = (own ? Math.max(t, 0.5) : Math.min(t, 0.5)) * a
    } else mask[i] = own ? a : 0
  }
  return {
    id,
    label,
    lab: partLab,
    rgb: labToSrgb(partLab),
    alpha,
    area,
    mask,
    box: { x0, y0, x1, y1 },
    spread,
    touchesEdge,
  }
}

/** Where colour p lies between a (0) and b (1), clamped. */
function project(p: Lab, a: Lab, b: Lab): number {
  const d0 = b[0] - a[0]
  const d1 = b[1] - a[1]
  const d2 = b[2] - a[2]
  const length = d0 ** 2 + d1 ** 2 + d2 ** 2
  if (length < 1e-6) return 1
  const t = ((p[0] - a[0]) * d0 + (p[1] - a[1]) * d1 + (p[2] - a[2]) * d2) / length
  return Math.max(0, Math.min(1, t))
}

/** The middle value, the upper of the two for an even count; 0 for none. */
function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = Float64Array.from(values).sort()
  return sorted[sorted.length >> 1] ?? 0
}
