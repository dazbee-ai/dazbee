// PROTOTYPE. The colour-region split: k-means in CIELAB over the block's opaque pixels, nearby
// colours merged by ΔE00, every covered pixel labelled, specks folded into their neighbours, and the
// labels cut into connected regions. Each region carries a soft coverage mask: the block's alpha
// times how far each edge pixel's colour lies towards the region's colour from its neighbour's.
import { deltaE00, type Lab, labToRgb, rgbToLab } from './colour.ts'
import type { Img } from './pixels.ts'

export interface Region {
  id: number
  label: number
  /** The region's colour, the median of its inner pixels. */
  lab: Lab
  rgb: [number, number, number]
  /** Median alpha of its inner pixels: below 1 for a see-through panel. */
  alpha: number
  /** Pixels labelled with it. */
  area: number
  /** Soft coverage 0..1 over the whole picture. */
  mask: Float32Array
  /** Coverage with its see-through-free holes filled: what a stacked shape under the others draws. */
  filled: Float32Array
  /** Coverage with every hole filled: the outer outline. */
  outer: Float32Array
  /** How much of the filled outline is see-through hole (outline icons, rings): 0 for a solid shape. */
  holeShare: number
  bbox: { x0: number; y0: number; x1: number; y1: number }
  /** Mean ΔE of its inner pixels to its colour: high for texture or a gradient. */
  spread: number
  touchesEdge: boolean
  /** For a group of marks of one colour: how many there are. */
  marks?: number
}

export interface Split {
  regions: Region[]
  labels: Int32Array
  /** The cluster colours, by label. */
  centres: Lab[]
  /** Mean ΔE of every covered pixel to its cluster colour. */
  residual: number
  /** Set when the split stopped: how many regions it found. */
  tooMany?: number
}

export interface SplitOptions {
  /** Clusters closer than this ΔE00 are one colour. */
  mergeDeltaE: number
  /** The most colours tried before merging. */
  k: number
  /** Specks under this many pixels are folded into a neighbour. */
  minArea: number
  /** Alpha at or above which a pixel is part of the content. */
  cut: number
  /** More regions than this and the split stops: the block is too detailed to rebuild. */
  maxRegions: number
}

/** Splits the picture into regions of one colour each. */
export function splitRegions(img: Img, opt: SplitOptions): Split {
  const n = img.w * img.h
  const lab = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const [L, a, b] = rgbToLab(img.d[i * 4]!, img.d[i * 4 + 1]!, img.d[i * 4 + 2]!)
    lab[i * 3] = L
    lab[i * 3 + 1] = a
    lab[i * 3 + 2] = b
  }
  const centres = cluster(img, lab, opt)
  const labels = new Int32Array(n).fill(-1)
  let resSum = 0
  let resN = 0
  for (let i = 0; i < n; i++) {
    if (img.d[i * 4 + 3]! < opt.cut) continue
    let best = 0
    let bd = Infinity
    for (let c = 0; c < centres.length; c++) {
      const d = dist2(lab, i, centres[c]!)
      if (d < bd) {
        bd = d
        best = c
      }
    }
    labels[i] = best
    if (img.d[i * 4 + 3]! > 0.9) {
      resSum += Math.sqrt(bd)
      resN++
    }
  }
  majority(labels, img.w, img.h)
  const comps = components(labels, img.w, img.h)
  absorbSpecks(labels, comps, img.w, img.h, opt.minArea)
  const comps2 = components(labels, img.w, img.h)
  if (comps2.list.length > opt.maxRegions)
    return { regions: [], labels, centres, residual: resN ? resSum / resN : 0, tooMany: comps2.list.length }
  const near = nearestComponent(comps2.of, img, 3)
  const regions = comps2.list.map((c, id) => regionOf(img, lab, labels, comps2.of, near, id, c.label, centres))
  return { regions, labels, centres, residual: resN ? resSum / resN : 0 }
}

/** k-means++ seeded from a fixed generator, Lloyd steps, then nearest pairs merged under the ΔE. */
function cluster(img: Img, lab: Float32Array, opt: SplitOptions): Lab[] {
  const n = img.w * img.h
  const pool: number[] = []
  for (let i = 0; i < n; i++) if (img.d[i * 4 + 3]! > 0.9) pool.push(i)
  if (pool.length < 50) for (let i = 0; i < n; i++) if (img.d[i * 4 + 3]! >= opt.cut) pool.push(i)
  if (pool.length === 0) return [[50, 0, 0]]
  const step = Math.max(1, Math.floor(pool.length / 6000))
  const sample = pool.filter((_, j) => j % step === 0)
  let seed = 12345
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const at = (i: number): Lab => [lab[i * 3]!, lab[i * 3 + 1]!, lab[i * 3 + 2]!]
  let centres: Lab[] = [at(sample[Math.floor(rand() * sample.length)]!)]
  const d2 = new Float32Array(sample.length).fill(Infinity)
  while (centres.length < opt.k) {
    let sum = 0
    const last = centres[centres.length - 1]!
    for (let j = 0; j < sample.length; j++) {
      d2[j] = Math.min(d2[j]!, dist2(lab, sample[j]!, last))
      sum += d2[j]!
    }
    if (sum < 1e-6) break
    let r = rand() * sum
    let pick = sample.length - 1
    for (let j = 0; j < sample.length; j++)
      if ((r -= d2[j]!) <= 0) {
        pick = j
        break
      }
    centres.push(at(sample[pick]!))
  }
  const lloyd = (iters: number) => {
    for (let it = 0; it < iters; it++) {
      const acc = centres.map(() => [0, 0, 0, 0])
      for (const i of sample) {
        let best = 0
        let bd = Infinity
        for (let c = 0; c < centres.length; c++) {
          const d = dist2(lab, i, centres[c]!)
          if (d < bd) {
            bd = d
            best = c
          }
        }
        const a = acc[best]!
        a[0]! += lab[i * 3]!
        a[1]! += lab[i * 3 + 1]!
        a[2]! += lab[i * 3 + 2]!
        a[3]! += 1
      }
      const next: Lab[] = []
      acc.forEach((a, c) => {
        if (a[3]! > 0) next.push([a[0]! / a[3]!, a[1]! / a[3]!, a[2]! / a[3]!])
        else void c
      })
      centres = next
    }
    return centres.map(() => 0)
  }
  lloyd(10)
  // Weights after Lloyd, for merging.
  const weights = () => {
    const w = centres.map(() => 0)
    for (const i of sample) {
      let best = 0
      let bd = Infinity
      for (let c = 0; c < centres.length; c++) {
        const d = dist2(lab, i, centres[c]!)
        if (d < bd) {
          bd = d
          best = c
        }
      }
      w[best]!++
    }
    return w
  }
  for (;;) {
    const w = weights()
    // Drop empty or near-empty clusters (under 0.2 % of the sample).
    const keep = centres.filter((_, c) => w[c]! > sample.length * 0.002)
    if (keep.length < centres.length && keep.length > 0) {
      centres = keep
      lloyd(3)
      continue
    }
    let bi = -1
    let bj = -1
    let bd = Infinity
    for (let i = 0; i < centres.length; i++)
      for (let j = i + 1; j < centres.length; j++) {
        const d = deltaE00(centres[i]!, centres[j]!)
        if (d < bd) {
          bd = d
          bi = i
          bj = j
        }
      }
    if (bi < 0 || bd >= opt.mergeDeltaE) break
    const wi = w[bi]!
    const wj = w[bj]!
    const t = wi + wj || 1
    const ci = centres[bi]!
    const cj = centres[bj]!
    centres[bi] = [(ci[0] * wi + cj[0] * wj) / t, (ci[1] * wi + cj[1] * wj) / t, (ci[2] * wi + cj[2] * wj) / t]
    centres.splice(bj, 1)
    lloyd(3)
  }
  return centres
}

const dist2 = (lab: Float32Array, i: number, c: Lab) =>
  (lab[i * 3]! - c[0]) ** 2 + (lab[i * 3 + 1]! - c[1]) ** 2 + (lab[i * 3 + 2]! - c[2]) ** 2

/** One pass of 3×3 majority vote over covered pixels: noise and edge blends join their neighbours. */
function majority(labels: Int32Array, w: number, h: number) {
  const src = labels.slice()
  const count = new Map<number, number>()
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (src[i]! < 0) continue
      count.clear()
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
          const l = src[yy * w + xx]!
          if (l >= 0) count.set(l, (count.get(l) ?? 0) + 1)
        }
      let best = src[i]!
      let bc = count.get(best) ?? 0
      for (const [l, c] of count)
        if (c > bc + 1) {
          best = l
          bc = c
        }
      labels[i] = best
    }
}

interface Comp {
  label: number
  area: number
}

/** 4-connected components of equal labels. */
export function components(labels: Int32Array, w: number, h: number) {
  const of = new Int32Array(w * h).fill(-1)
  const list: Comp[] = []
  const stack: number[] = []
  for (let s = 0; s < w * h; s++) {
    if (labels[s]! < 0 || of[s]! >= 0) continue
    const id = list.length
    const label = labels[s]!
    let area = 0
    of[s] = id
    stack.push(s)
    while (stack.length) {
      const i = stack.pop()!
      area++
      const x = i % w
      const y = (i - x) / w
      const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]
      for (const j of nb)
        if (j >= 0 && of[j]! < 0 && labels[j] === label) {
          of[j] = id
          stack.push(j)
        }
    }
    list.push({ label, area })
  }
  return { of, list }
}

/** Components smaller than minArea take the label they share the most border with. */
function absorbSpecks(labels: Int32Array, comps: ReturnType<typeof components>, w: number, h: number, minArea: number) {
  const small = new Set(comps.list.flatMap((c, id) => (c.area < minArea ? [id] : [])))
  if (small.size === 0) return
  const border = new Map<number, Map<number, number>>()
  for (let i = 0; i < w * h; i++) {
    const c = comps.of[i]!
    if (c < 0 || !small.has(c)) continue
    const x = i % w
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]
    for (const j of nb) {
      if (j < 0 || j >= w * h) continue
      const cj = comps.of[j]!
      if (cj < 0 || cj === c || small.has(cj)) continue
      const m = border.get(c) ?? new Map<number, number>()
      m.set(comps.list[cj]!.label, (m.get(comps.list[cj]!.label) ?? 0) + 1)
      border.set(c, m)
    }
  }
  for (let i = 0; i < w * h; i++) {
    const c = comps.of[i]!
    if (c < 0 || !small.has(c)) continue
    const m = border.get(c)
    if (!m) continue
    let best = -1
    let bc = -1
    for (const [l, n] of m)
      if (n > bc) {
        bc = n
        best = l
      }
    labels[i] = best
  }
}

/** For faint pixels outside every region (an edge's fade), the region within `reach` pixels nearest them. */
function nearestComponent(compOf: Int32Array, img: Img, reach: number): Int32Array {
  const { w, h } = img
  const near = compOf.slice()
  let frontier: number[] = []
  for (let i = 0; i < w * h; i++) if (near[i]! >= 0) frontier.push(i)
  for (let step = 0; step < reach; step++) {
    const next: number[] = []
    for (const i of frontier) {
      const x = i % w
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= w * h || near[j]! >= 0 || img.d[j * 4 + 3]! <= 0.004) continue
        near[j] = near[i]!
        next.push(j)
      }
    }
    frontier = next
  }
  return near
}

function regionOf(
  img: Img,
  lab: Float32Array,
  labels: Int32Array,
  compOf: Int32Array,
  near: Int32Array,
  id: number,
  label: number,
  centres: Lab[],
): Region {
  const { w, h } = img
  const n = w * h
  const mask = new Float32Array(n)
  let area = 0
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1
  const inner: number[] = []
  let touchesEdge = false
  for (let i = 0; i < n; i++) {
    if (compOf[i] !== id) continue
    area++
    const x = i % w
    const y = (i - x) / w
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touchesEdge = true
    const interior =
      x > 0 &&
      y > 0 &&
      x < w - 1 &&
      y < h - 1 &&
      compOf[i - 1] === id &&
      compOf[i + 1] === id &&
      compOf[i - w] === id &&
      compOf[i + w] === id
    if (interior) inner.push(i)
  }
  const all = inner.length >= 8 ? inner : [...Array(n).keys()].filter((i) => compOf[i] === id)
  const every = Math.max(1, Math.floor(all.length / 2000))
  const pick = all.filter((_, j) => j % every === 0)
  const med = (k: number) => median(pick.map((i) => lab[i * 3 + k]!))
  const regionLab: Lab = [med(0), med(1), med(2)]
  const rgb = labToRgb(regionLab)
  const alpha = median(pick.map((i) => img.d[i * 4 + 3]!))
  let spread = 0
  for (const i of pick) spread += deltaE00(regionLab, [lab[i * 3]!, lab[i * 3 + 1]!, lab[i * 3 + 2]!])
  spread /= pick.length || 1
  // Soft coverage: inside, the pixel's alpha over the region's; at an edge with another region, the
  // share of the way from the neighbour's colour to this one.
  for (let i = 0; i < n; i++) {
    const own = compOf[i] === id
    if (compOf[i]! < 0) {
      // A faint edge pixel: its alpha, when this region is the nearest.
      // A faint pixel of another colour (a shadow's edge) is not this region's.
      const dl = Math.hypot(lab[i * 3]! - regionLab[0], lab[i * 3 + 1]! - regionLab[1], lab[i * 3 + 2]! - regionLab[2])
      if (near[i] === id && dl < 12) mask[i] = Math.min(1, img.d[i * 4 + 3]! / Math.max(alpha, 0.05))
      continue
    }
    const x = i % w
    const y = (i - x) / w
    let nearOwn = own
    let other = -1
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
      if (j < 0) continue
      if (compOf[j] === id) nearOwn = true
      else if (labels[j]! >= 0 && labels[j] !== label) other = labels[j]!
    }
    if (!nearOwn) continue
    const a = Math.min(1, img.d[i * 4 + 3]! / Math.max(alpha, 0.05))
    if (own && other < 0) {
      mask[i] = a
      continue
    }
    const pl: Lab = [lab[i * 3]!, lab[i * 3 + 1]!, lab[i * 3 + 2]!]
    if (other >= 0 || !own) {
      const o = other >= 0 ? centres[other]! : null
      if (o) {
        const t = project(pl, o, regionLab)
        mask[i] = (own ? Math.max(t, 0.5) : Math.min(t, 0.5)) * a
      } else mask[i] = own ? a : 0
    } else mask[i] = a
  }
  const filled = fillHoles(mask, img, w, h, x0, y0, x1, y1)
  let filledSum = 0
  let maskSum = 0
  let holeTransparent = 0
  for (let i = 0; i < n; i++) {
    filledSum += filled.f[i]!
    maskSum += mask[i]!
    holeTransparent += filled.transparentHole[i]!
  }
  void filledSum
  return {
    id,
    label,
    lab: regionLab,
    rgb,
    alpha,
    area,
    mask,
    filled: filled.f,
    outer: filled.o,
    holeShare: holeTransparent / Math.max(1, maskSum + holeTransparent),
    bbox: { x0, y0, x1, y1 },
    spread,
    touchesEdge,
  }
}

/** Where p lies between colours a (0) and b (1), clamped. */
function project(p: Lab, a: Lab, b: Lab) {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const len = d[0]! ** 2 + d[1]! ** 2 + d[2]! ** 2
  if (len < 1e-6) return 1
  const t = ((p[0] - a[0]) * d[0]! + (p[1] - a[1]) * d[1]! + (p[2] - a[2]) * d[2]!) / len
  return Math.max(0, Math.min(1, t))
}

/**
 * The mask with its enclosed holes filled where the picture is covered there (others lie on top);
 * holes that are see-through stay holes, and are counted.
 */
function fillHoles(mask: Float32Array, img: Img, w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  const n = w * h
  const f = mask.slice()
  const o = mask.slice()
  const transparentHole = new Float32Array(n)
  // Flood the outside (below half coverage) from the bbox border, within the bbox grown by one.
  const bx0 = Math.max(0, x0 - 1),
    by0 = Math.max(0, y0 - 1),
    bx1 = Math.min(w - 1, x1 + 1),
    by1 = Math.min(h - 1, y1 + 1)
  const outside = new Uint8Array(n)
  const stack: number[] = []
  const inBox = (x: number, y: number) => x >= bx0 && x <= bx1 && y >= by0 && y <= by1
  for (let y = by0; y <= by1; y++)
    for (let x = bx0; x <= bx1; x++) {
      if (x !== bx0 && x !== bx1 && y !== by0 && y !== by1) continue
      const i = y * w + x
      if (mask[i]! < 0.5 && !outside[i]) {
        outside[i] = 1
        stack.push(i)
      }
    }
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w
    const y = (i - x) / w
    for (const [xx, yy] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ] as const) {
      if (!inBox(xx, yy)) continue
      const j = yy * w + xx
      if (!outside[j] && mask[j]! < 0.5) {
        outside[j] = 1
        stack.push(j)
      }
    }
  }
  // Each hole: a 4-connected run of not-outside pixels under half coverage.
  const seen = new Uint8Array(n)
  for (let y = by0; y <= by1; y++)
    for (let x = bx0; x <= bx1; x++) {
      const s = y * w + x
      if (outside[s] || seen[s] || mask[s]! >= 0.5) continue
      const hole: number[] = []
      seen[s] = 1
      stack.push(s)
      let alpha = 0
      while (stack.length) {
        const i = stack.pop()!
        hole.push(i)
        alpha += img.d[i * 4 + 3]!
        const xi = i % w
        const yi = (i - xi) / w
        for (const [xx, yy] of [
          [xi - 1, yi],
          [xi + 1, yi],
          [xi, yi - 1],
          [xi, yi + 1],
        ] as const) {
          if (!inBox(xx, yy)) continue
          const j = yy * w + xx
          if (!outside[j] && !seen[j] && mask[j]! < 0.5) {
            seen[j] = 1
            stack.push(j)
          }
        }
      }
      const covered = alpha / hole.length >= 0.5
      for (const i of hole) {
        o[i] = 1
        if (covered) f[i] = 1
        else transparentHole[i] = 1 - mask[i]!
      }
    }
  // Edge pixels of a filled hole are full too.
  return { f, o, transparentHole }
}

function median(v: number[]) {
  if (v.length === 0) return 0
  const s = Float64Array.from(v).sort()
  return s[s.length >> 1]!
}
