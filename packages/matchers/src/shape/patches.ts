// Patches: a piece cut into the areas of one flat colour it is drawn with, each with its sub-pixel outlines.
//
// 1. Flat colours. A pixel is flat when its neighbours have its colour; the flat pixels' colours, counted in bins of
//    5 bits a channel, give the piece's colours (bins closer than a ΔE00 are one colour). A pixel no colour explains,
//    alone or mixed with a neighbour's (a thin line has no flat pixel), is counted again, and the colour farthest
//    from the ones found is added, a few times over. What still stays unexplained is shading or texture.
// 2. Every covered pixel takes its nearest colour, and joined pixels of one colour are an area. Specks join the
//    area they border most, and areas that meet with no edge between them (the bands of one gradient) are one patch.
// 3. An edge pixel between two patches is a mix of their colours: how far its colour lies towards its own patch's
//    is its share of it, so a patch's outline crosses the pixel where the edge really is (marching squares at one
//    half). A piece's own see-through edge mixes by alpha in the same way.

import { ciede2000, type Lab, srgbToLab } from '../looks-same/colour.ts'
import type { FloatPicture } from './parts/float-picture.ts'

/** A closed outline as x, y pairs in the picture's pixels, and the area it encloses: above 0 for an outer outline, below for a hole. */
export interface Loop {
  points: Float32Array
  area: number
}

/** One patch of the picture. */
export interface Patch {
  id: number
  /** Which of the picture's colours it is: patches of one colour have the same number. */
  colour: number
  /** The mean colour and alpha (0 to 1) of its inner pixels. */
  rgb: [number, number, number]
  alpha: number
  /** How many pixels it holds. */
  area: number
  /** Its first and last column and row. */
  box: { x0: number; y0: number; x1: number; y1: number }
  /** The root mean square distance of its inner pixels' colour from its mean, of 255. */
  spread: number
  /** Its outlines: the outer ones (area above 0) and its holes. */
  loops: Loop[]
  /** The area its outer outlines enclose. */
  outline: number
  /** One of its pixels: the first in reading order. */
  seed: [number, number]
}

/** A picture cut into patches. */
export interface Split {
  width: number
  height: number
  /** Each pixel's patch, -1 where the picture is see-through. */
  patchOf: Int32Array
  patches: Patch[]
  /** The share of the covered pixels that no flat colour explains, alone or mixed. */
  unexplained: number
  /** How many areas the picture had before specks and bands were joined. */
  areas: number
  /** The share of the solid pixels that are flat, and how many colours the picture has. */
  flat: number
  colours: number
  /** How many bins of colour, of 5 bits a channel, its covered pixels fill. */
  bins: number
}

/** The settings of the cut. */
export const PATCHES = {
  /** Neighbours within this of each other, of 255 a channel, are of one flat colour. */
  flat: 8,
  /** A pixel of at least this share of the piece's full alpha is solid; under it, it fades. */
  solid: 0.9,
  /** Colours closer than this ΔE00 are one colour. */
  merge: 7,
  /** Two peaks of colour are one when the fullest bin between them holds at least this share of the lower peak. */
  valley: 0.5,
  /** A pixel within this Lab distance of a colour, or of a mix of two, is explained by it. */
  explained: 10,
  /** A colour needs this share of the covered pixels, and at least `leastPixels`, to count. */
  leastShare: 0.00002,
  leastPixels: 3,
  /** The most colours a piece is cut into. */
  mostColours: 24,
  /** Areas under this share of the covered pixels, and under `speckPixels`, join a neighbour. */
  speckShare: 0.00003,
  speckPixels: 4,
  /** A shade: an area under this share of the covered pixels, and under `shadePixels`, within this ΔE00 of its neighbour. */
  shadeShare: 0.001,
  shadePixels: 24,
  shade: 10,
  /** Two areas meet with no edge when their pixels differ by at most this, of 255, across their border on average. */
  smooth: 3.5,
  /** And by at most this share of how far apart the two areas' colours are: a step between two near colours is an edge. */
  smoothShare: 0.25,
  /** Or when they differ across it by at most this many times the grain inside the grainier of the two. */
  grain: 1.5,
  /** How far a pixel's coverage is pushed from its neighbourhood's mean before the outlines are read. */
  sharpen: 1,
  /** Where a fringe meets pixels that are not covered, its alpha steps down by at most this, of the alpha that covers. */
  fade: 0.1,
  /**
   * A soft pixel is narrow when the alpha is less by `narrowBy`, of the alpha that covers, `narrowReach` pixels to
   * both sides of it; soft pixels of which more than `narrowShare` are narrow are strokes, no fringe.
   */
  narrowBy: 0.08,
  narrowReach: 3,
  narrowShare: 0.2,
  /** More areas than this and the cut stops: the picture is no flat drawing. */
  mostAreas: 1000,
  /** More bins of colour filled than this and the picture is no flat drawing either. */
  mostBins: 1200,
} as const

const BINS = 32 * 32 * 32

/**
 * Cuts a picture into patches of one flat colour each, or null when it has too many areas to be a flat drawing.
 * A pixel marked in `hidden` (other layers cover it in the frame) adds no colour to the picture's colours: it
 * takes one of them when its own colour is one, and else the patch nearest to it that shows, so what a layer
 * hides and the picture's colours don't explain is filled in from around it.
 */
export function splitPatches(picture: FloatPicture, hidden?: Uint8Array): Split | null {
  const { width, height, data } = picture
  const n = width * height
  const { cut, covered } = coverageCut(picture)
  if (covered < 4) return null
  const norm = 1 / (2 * cut)
  const fringe = fringeOf(picture, cut, norm)
  const bin = new Uint16Array(n)
  const seen = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if ((data[i * 4 + 3] ?? 0) < cut || fringe[i]) continue
    seen[i] = 1
    bin[i] = ((data[i * 4]! >> 3) << 10) | ((data[i * 4 + 1]! >> 3) << 5) | (data[i * 4 + 2]! >> 3)
  }

  // 1. The flat colours. A fading pixel (the soft edge of the piece) has no colour to count.
  const fading = new Uint8Array(n)
  const all = histogram()
  const flat = histogram()
  const strong = histogram()
  const isFlatPixel = new Uint8Array(n)
  let flatCount = 0
  let strongCount = 0
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!seen[i]) continue
      add(all, bin[i]!, data, i)
      if (hidden?.[i]) continue
      if (data[i * 4 + 3]! * norm < PATCHES.solid) {
        fading[i] = 1
        continue
      }
      add(strong, bin[i]!, data, i)
      strongCount++
      if (isFlat(data, seen, width, height, x, y)) {
        add(flat, bin[i]!, data, i)
        isFlatPixel[i] = 1
        flatCount++
      }
    }
  const least = Math.max(PATCHES.leastPixels, PATCHES.leastShare * covered)
  const binLab = new Float32Array(BINS * 3)
  const used: number[] = []
  for (let b = 0; b < BINS; b++) {
    const count = all.count[b]!
    if (!count) continue
    used.push(b)
    const lab = srgbToLab(all.sums[b * 3]! / count, all.sums[b * 3 + 1]! / count, all.sums[b * 3 + 2]! / count)
    binLab.set(lab, b * 3)
  }
  // A flat drawing fills few bins of colour; a photo or a painting fills thousands, and is cut no further.
  if (used.length > PATCHES.mostBins) return null
  let palette = coloursOf(flat, flatCount >= Math.max(12, 0.02 * covered) ? least : Infinity)
  if (palette.length === 0) {
    // Thin strokes have no flat pixel: the solid pixels count instead, or every pixel of a piece with none.
    palette = coloursOf(strongCount >= 4 ? strong : all, Math.min(least, Math.max(1, strongCount / 4)))
    if (palette.length === 0) palette = coloursOf(all, 1).slice(0, 1)
    for (let i = 0; i < n; i++) if (seen[i] && !hidden?.[i] && (!fading[i] || strongCount < 4)) isFlatPixel[i] = 1
  }
  const binLabel = new Int16Array(BINS).fill(-1)
  const rowOf = new Int32Array(BINS)
  const label = new Int16Array(n).fill(-1)
  const within = PATCHES.explained ** 2
  let unexplained = 0
  for (let round = 0; round < 3; round++) {
    const colours = palette.length
    const distances = binDistances(palette, used, binLab)
    used.forEach((b, row) => {
      rowOf[b] = row
      let best = 0
      for (let c = 1; c < colours; c++) if (distances[row * colours + c]! < distances[row * colours + best]!) best = c
      binLabel[b] = best
    })
    // A flat pixel has its nearest colour. An edge pixel has the colour of a neighbour that explains it, as that
    // colour or as its mix with another neighbour's, so a mix of two colours never takes a third that lies between
    // them; a fading pixel has the colour of its most solid neighbour, which it fades from.
    label.fill(-1)
    for (let i = 0; i < n; i++) if (isFlatPixel[i]) label[i] = binLabel[bin[i]!]!
    const candidates = new Int16Array(8)
    for (let sweep = 0; sweep < 6; sweep++) {
      let changed = false
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = y * width + x
          if (!seen[i] || label[i]! >= 0) continue
          let count = 0
          let solid = -1
          let solidAlpha = -1
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx
              const yy = y + dy
              if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
              const j = yy * width + xx
              const l = label[j]!
              if (l < 0) continue
              if (data[j * 4 + 3]! > solidAlpha) {
                solidAlpha = data[j * 4 + 3]!
                solid = l
              }
              if (!candidates.subarray(0, count).includes(l)) candidates[count++] = l
            }
          if (count === 0) continue
          const b = bin[i]!
          // A fading pixel has the colour of its most solid neighbour, which it fades from, when it is that colour.
          if (fading[i] && !hidden?.[i] && distances[rowOf[b]! * colours + solid]! <= within) {
            label[i] = solid
            changed = true
            continue
          }
          let best = candidates[0]!
          let bestDistance = Infinity
          for (let k = 0; k < count; k++) {
            const d = distances[rowOf[b]! * colours + candidates[k]!]!
            if (d < bestDistance) {
              bestDistance = d
              best = candidates[k]!
            }
          }
          let explained = bestDistance <= within
          if (!explained) {
            const p = labAt(binLab, b)
            for (let k = 0; k < count && !explained; k++)
              explained =
                candidates[k] !== best && toSegment2(p, palette[best]!.lab, palette[candidates[k]!]!.lab) <= within
          }
          if (explained) {
            label[i] = best
            changed = true
          }
        }
      if (!changed) break
    }
    // The rest take their nearest colour; those far from it are unexplained.
    const left = histogram()
    unexplained = 0
    for (let i = 0; i < n; i++) {
      if (!seen[i] || label[i]! >= 0) continue
      const b = bin[i]!
      if (hidden?.[i]) {
        if (distances[rowOf[b]! * colours + binLabel[b]!]! <= within) label[i] = binLabel[b]!
        continue
      }
      label[i] = binLabel[b]!
      if (distances[rowOf[b]! * colours + label[i]!]! <= within) continue
      add(left, b, data, i)
      unexplained++
    }
    if (unexplained < least || palette.length >= PATCHES.mostColours || round === 2) break
    const more = farthestColours(left, binLab, (b) => distances[rowOf[b]! * colours + binLabel[b]!]!, least)
    if (more.length === 0) break
    palette = [...palette, ...more].slice(0, PATCHES.mostColours)
  }

  // What other layers hide, and no colour explains, takes the colour nearest to it, spreading in from around.
  if (hidden) {
    const queue = new Int32Array(n)
    let end = 0
    for (let i = 0; i < n; i++) if (label[i]! >= 0) queue[end++] = i
    for (let start = 0; start < end; start++) {
      const i = queue[start]!
      const x = i % width
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (j < 0 || j >= n || !seen[j] || label[j]! >= 0) continue
        label[j] = label[i]!
        queue[end++] = j
      }
    }
    for (let i = 0; i < n; i++) if (seen[i] && label[i]! < 0) label[i] = 0
  }

  // 2. Areas of one colour, 4-connected.
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (i: number): number => {
    let root = i
    while (parent[root] !== root) root = parent[root]!
    while (parent[i] !== root) {
      const next = parent[i]!
      parent[i] = root
      i = next
    }
    return root
  }
  const union = (a: number, b: number) => {
    const ra = find(a)
    const rb = find(b)
    if (ra !== rb) parent[rb] = ra
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!seen[i]) continue
      if (x + 1 < width && seen[i + 1] && label[i + 1] === label[i]) union(i, i + 1)
      if (y + 1 < height && seen[i + width] && label[i + width] === label[i]) union(i, i + width)
    }
  const size = new Int32Array(n)
  const solid = new Int32Array(n)
  let areas = 0
  for (let i = 0; i < n; i++)
    if (seen[i]) {
      const root = find(i)
      if (size[root] === 0) areas++
      size[root] = size[root]! + 1
      if (!fading[i]) solid[root] = solid[root]! + 1
    }
  if (areas > PATCHES.mostAreas) return null
  // Borders between areas: how many pairs of solid pixels meet across each, and how much they differ; and the same
  // inside each area, which is its grain.
  const borders = new Map<number, { a: number; b: number; pairs: number; step: number }>()
  const grainPairs = new Float32Array(n)
  const grainStep = new Float32Array(n)
  const rootOf = new Int32Array(n)
  for (let i = 0; i < n; i++) if (seen[i]) rootOf[i] = find(i)
  const meet = (i: number, j: number) => {
    const a = rootOf[i]!
    const b = rootOf[j]!
    const step = Math.max(
      Math.abs(data[i * 4]! - data[j * 4]!),
      Math.abs(data[i * 4 + 1]! - data[j * 4 + 1]!),
      Math.abs(data[i * 4 + 2]! - data[j * 4 + 2]!),
    )
    if (hidden && (hidden[i] || hidden[j])) return
    if (a === b) {
      if (fading[i] || fading[j]) return
      grainPairs[a] = grainPairs[a]! + 1
      grainStep[a] = grainStep[a]! + step
      return
    }
    const key = a < b ? a * n + b : b * n + a
    let border = borders.get(key)
    if (!border) borders.set(key, (border = { a, b, pairs: 0, step: 0 }))
    border.pairs++
    border.step += step
  }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!seen[i]) continue
      if (x + 1 < width && seen[i + 1]) meet(i, i + 1)
      if (y + 1 < height && seen[i + width]) meet(i, i + width)
    }
  // Specks join the area they border most. So does a fringe: an area with no solid pixel, the faded edge of an
  // area that has some. And so does a shade: a small area a person can hardly tell from the area beside it.
  const speck = Math.max(PATCHES.speckPixels, PATCHES.speckShare * covered)
  const shadeSize = Math.max(PATCHES.shadePixels, PATCHES.shadeShare * covered)
  const most = new Map<number, { into: number; pairs: number }>()
  for (const { a, b, pairs } of borders.values())
    for (const [small, other] of [
      [a, b],
      [b, a],
    ] as const) {
      const fringe = solid[small] === 0 && solid[other]! > 0
      const shade =
        size[small]! < shadeSize &&
        size[other]! >= size[small]! &&
        ciede2000(palette[label[small]!]!.lab, palette[label[other]!]!.lab) < PATCHES.shade
      if (!fringe && !shade && (size[small]! >= speck || size[other]! < size[small]!)) continue
      const best = most.get(small)
      if (!best || pairs > best.pairs) most.set(small, { into: other, pairs })
    }
  for (const [small, { into }] of most) parent[find(small)] = find(into)
  // Areas that meet with no edge are one patch: the step across their border is small, or no more than the grain
  // of the grainier of the two.
  const grain = (root: number) => (grainPairs[root]! >= 8 ? grainStep[root]! / grainPairs[root]! : 0)
  for (const { a, b, pairs, step } of borders.values()) {
    if (pairs < 6) continue
    const apart = Math.sqrt(distance2(palette[label[a]!]!.rgb, palette[label[b]!]!.rgb))
    const edge = Math.max(
      Math.min(PATCHES.smooth, PATCHES.smoothShare * apart),
      PATCHES.grain * Math.max(grain(a), grain(b)),
    )
    if (step / pairs <= edge) union(a, b)
  }

  // The patches, numbered by where they first appear.
  const idOf = new Int32Array(n).fill(-1)
  const patchOf = new Int32Array(n).fill(-1)
  const patches: Patch[] = []
  const sums: Float64Array[] = []
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!seen[i]) continue
      const root = find(i)
      let id = idOf[root]!
      if (id < 0) {
        id = idOf[root] = patches.length
        patches.push({
          id,
          colour: label[root]!,
          rgb: [0, 0, 0],
          alpha: 1,
          area: 0,
          box: { x0: x, y0: y, x1: x, y1: y },
          spread: 0,
          loops: [],
          outline: 0,
          seed: [x, y],
        })
        // red, green, blue, their squares, alpha and count over the inner pixels; then over the most solid ones.
        sums.push(new Float64Array(16))
      }
      patchOf[i] = id
      const r = patches[id]!
      r.area++
      if (x < r.box.x0) r.box.x0 = x
      if (x > r.box.x1) r.box.x1 = x
      if (y > r.box.y1) r.box.y1 = y
    }
  // 3. Each edge pixel's mix with the neighbour it differs from most.
  const near = new Int32Array(n).fill(-1)
  const mix = new Float32Array(n).fill(1)
  const rgbOf = (c: number) => palette[c]!.rgb
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (hidden?.[i]) continue
      const own = patchOf[i]!
      const alpha = Math.min(1, data[i * 4 + 3]! * norm)
      let pick = -1
      let far = -1
      for (let k = 0; k < 4; k++) {
        const xx = x + (k === 0 ? -1 : k === 1 ? 1 : 0)
        const yy = y + (k === 2 ? -1 : k === 3 ? 1 : 0)
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
        const j = yy * width + xx
        const other = patchOf[j]!
        if (other === own) continue
        // A see-through neighbour, or a see-through pixel's covered one, comes first: alpha is the mix.
        const d = own < 0 || other < 0 ? Infinity : distance2(rgbOf(label[i]!), rgbOf(label[j]!))
        if (d > far) {
          far = d
          pick = j
        }
      }
      if (pick < 0) continue
      near[i] = pick
      // A fringe is none of the patch beside it, and the patch's edge pixel is covered by what it has over the fringe.
      if (own < 0) mix[i] = fringe[i] ? 1 : 1 - alpha
      else if (fringe[pick]) {
        const under = Math.min(1, data[pick * 4 + 3]! * norm)
        mix[i] = alpha >= PATCHES.solid ? 1 : Math.max(0, Math.min(1, (alpha - under) / Math.max(1e-3, 1 - under)))
      } else if (patchOf[pick]! < 0) mix[i] = alpha
      else mix[i] = Math.max(0.5, towards(data, i, rgbOf(label[pick]!), rgbOf(label[i]!))) * Math.max(alpha, 0.5)
    }
  // A patch's colour and alpha: the mean of its inner pixels when it has enough, else of its most solid ones.
  const fullest = new Float32Array(patches.length)
  for (let i = 0; i < n; i++) {
    const id = patchOf[i]!
    if (id >= 0 && !hidden?.[i] && data[i * 4 + 3]! > fullest[id]!) fullest[id] = data[i * 4 + 3]!
  }
  for (let i = 0; i < n; i++) {
    const id = patchOf[i]!
    if (id < 0 || hidden?.[i]) continue
    const s = sums[id]!
    for (const from of [near[i]! < 0 ? 0 : -1, data[i * 4 + 3]! >= PATCHES.solid * fullest[id]! ? 8 : -1]) {
      if (from < 0) continue
      for (let c = 0; c < 3; c++) {
        s[from + c] = s[from + c]! + data[i * 4 + c]!
        s[from + 3 + c] = s[from + 3 + c]! + data[i * 4 + c]! ** 2
      }
      s[from + 6] = s[from + 6]! + data[i * 4 + 3]!
      s[from + 7] = s[from + 7]! + 1
    }
  }
  for (const r of patches) {
    const s = sums[r.id]!
    const from = s[7]! >= Math.max(4, 0.1 * r.area) ? 0 : 8
    const count = s[from + 7]! || 1
    r.rgb = [s[from]! / count, s[from + 1]! / count, s[from + 2]! / count]
    r.alpha = s[from + 7]! ? Math.min(1, s[from + 6]! / count) : 1
    let variance = 0
    for (let c = 0; c < 3; c++) variance += Math.max(0, s[from + 3 + c]! / count - r.rgb[c]! ** 2)
    r.spread = Math.sqrt(variance / 3)
  }
  for (const r of patches) outlines(r, patchOf, near, mix, width, height)
  return {
    width,
    height,
    patchOf,
    patches,
    unexplained: unexplained / covered,
    areas,
    flat: strongCount ? flatCount / strongCount : 0,
    colours: palette.length,
    bins: used.length,
  }
}

/** The alpha from which a pixel is covered: half the alpha of the piece's most opaque pixels, between 0.08 and 0.5. */
function coverageCut({ width, height, data }: FloatPicture): { cut: number; covered: number } {
  const n = width * height
  const counts = new Int32Array(257)
  for (let i = 0; i < n; i++) counts[Math.round(data[i * 4 + 3]! * 256)]!++
  let above = 0
  let top = 256
  for (; top > 0; top--) {
    above += counts[top]!
    if (above >= n * 0.005) break
  }
  const cut = Math.max(0.08, Math.min(0.5, (0.5 * top) / 256))
  let covered = 0
  for (let i = 0; i < n; i++) if (data[i * 4 + 3]! >= cut) covered++
  return { cut, covered }
}

/**
 * The fringe of a picture: the covered pixels of a soft shadow or glow, which are no part of a shape. Soft pixels
 * (under `solid` of the alpha that covers) with no solid pixel beside them, joined, are a fringe when they fade out:
 * where they meet pixels that are not covered, more often than not the alpha steps down by `fade` at most. A
 * see-through shape ends at an edge instead, and so does a soft edge. A thin faint stroke is no fringe either: its
 * pixels are narrow, with less alpha `narrowReach` pixels to both sides, across or down.
 */
function fringeOf({ width, height, data }: FloatPicture, cut: number, norm: number): Uint8Array {
  const n = width * height
  const fringe = new Uint8Array(n)
  // 1 a soft covered pixel with no solid pixel beside it, 2 one already joined.
  const soft = new Uint8Array(n)
  let any = false
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      const raw = data[i * 4 + 3]!
      if (raw < cut || raw * norm >= PATCHES.solid) continue
      let firm = false
      for (let dy = -1; dy <= 1 && !firm; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
          if (data[(yy * width + xx) * 4 + 3]! * norm >= PATCHES.solid) {
            firm = true
            break
          }
        }
      if (firm) continue
      soft[i] = 1
      any = true
    }
  if (!any) return fringe
  const stack: number[] = []
  const members: number[] = []
  for (let start = 0; start < n; start++) {
    if (soft[start] !== 1) continue
    let fades = 0
    let ends = 0
    let narrow = 0
    members.length = 0
    soft[start] = 2
    stack.push(start)
    while (stack.length) {
      const i = stack.pop()!
      members.push(i)
      const x = i % width
      const y = (i - x) / width
      const alpha = data[i * 4 + 3]!
      const less = (dx: number, dy: number) => {
        const xx = x + dx
        const yy = y + dy
        const other = xx < 0 || yy < 0 || xx >= width || yy >= height ? 0 : data[(yy * width + xx) * 4 + 3]!
        return (alpha - other) * norm >= PATCHES.narrowBy
      }
      const reach = PATCHES.narrowReach
      if ((less(-reach, 0) && less(reach, 0)) || (less(0, -reach) && less(0, reach))) narrow++
      for (let k = 0; k < 4; k++) {
        const xx = x + (k === 0 ? -1 : k === 1 ? 1 : 0)
        const yy = y + (k === 2 ? -1 : k === 3 ? 1 : 0)
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
        const j = yy * width + xx
        if (soft[j] === 1) {
          soft[j] = 2
          stack.push(j)
        } else if (data[j * 4 + 3]! < cut) {
          if ((alpha - data[j * 4 + 3]!) * norm <= PATCHES.fade) fades++
          else ends++
        }
      }
    }
    if (fades > ends && narrow <= PATCHES.narrowShare * members.length) for (const i of members) fringe[i] = 1
  }
  return fringe
}

interface Histogram {
  count: Int32Array
  sums: Float64Array
}
interface Colour {
  rgb: [number, number, number]
  lab: Lab
  count: number
  /** The histogram bins that are this colour; none for a colour added from unexplained pixels. */
  bins: number[]
}

function histogram(): Histogram {
  return { count: new Int32Array(BINS), sums: new Float64Array(BINS * 3) }
}

function add(h: Histogram, b: number, data: Float32Array, i: number) {
  h.count[b]!++
  h.sums[b * 3] = h.sums[b * 3]! + data[i * 4]!
  h.sums[b * 3 + 1] = h.sums[b * 3 + 1]! + data[i * 4 + 1]!
  h.sums[b * 3 + 2] = h.sums[b * 3 + 2]! + data[i * 4 + 2]!
}

/** Whether a covered pixel's covered 4-neighbours all have its colour, and it has at least two. */
function isFlat(data: Float32Array, seen: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  const i = y * width + x
  let neighbours = 0
  for (let k = 0; k < 4; k++) {
    const xx = x + (k === 0 ? -1 : k === 1 ? 1 : 0)
    const yy = y + (k === 2 ? -1 : k === 3 ? 1 : 0)
    if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
    const j = yy * width + xx
    if (!seen[j]) continue
    neighbours++
    for (let c = 0; c < 3; c++) if (Math.abs(data[i * 4 + c]! - data[j * 4 + c]!) > PATCHES.flat) return false
  }
  return neighbours >= 2
}

/**
 * A histogram's colours: the peaks of how densely its bins are filled, each with the bins that climb to it. Two
 * peaks with no real valley between them (the fullest bin on their border holds at least a share of the lower
 * peak) are one colour, so an ink that shades from one tone to the next is one colour, and two inks are two however
 * close, as long as few pixels lie between them. Colours holding under `least` pixels are left out.
 */
function coloursOf(h: Histogram, least: number): Colour[] {
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
    density[b] = density[b]! + 2 * h.count[b]!
    around(b, (neighbour) => (density[neighbour] = density[neighbour]! + h.count[b]!))
  }
  filled.sort((x, y) => density[y]! - density[x]!)
  const peakOf = new Int32Array(BINS).fill(-1)
  const joined: number[] = []
  const height: number[] = []
  const find = (c: number): number => {
    while (joined[c] !== c) c = joined[c] = joined[joined[c]!]!
    return c
  }
  for (const b of filled) {
    // The bins are taken from the densest down, so a neighbour with a peak already is uphill of this one.
    let up = -1
    let upDensity = -1
    around(b, (neighbour) => {
      if (peakOf[neighbour]! >= 0 && density[neighbour]! > upDensity) {
        upDensity = density[neighbour]!
        up = find(peakOf[neighbour]!)
      }
    })
    if (up < 0) {
      peakOf[b] = joined.length
      joined.push(joined.length)
      height.push(density[b]!)
      continue
    }
    peakOf[b] = up
    around(b, (neighbour) => {
      if (peakOf[neighbour]! < 0) return
      const other = find(peakOf[neighbour]!)
      const mine = find(up)
      if (other === mine) return
      if (density[b]! < PATCHES.valley * Math.min(height[other]!, height[mine]!)) return
      const [keep, drop] = height[other]! > height[mine]! ? [other, mine] : [mine, other]
      joined[drop] = keep
    })
  }
  const sums = new Map<number, { rgb: [number, number, number]; count: number; bins: number[] }>()
  for (const b of filled) {
    const peak = find(peakOf[b]!)
    let sum = sums.get(peak)
    if (!sum) sums.set(peak, (sum = { rgb: [0, 0, 0], count: 0, bins: [] }))
    sum.count += h.count[b]!
    sum.bins.push(b)
    for (let c = 0; c < 3; c++) sum.rgb[c] = sum.rgb[c]! + h.sums[b * 3 + c]!
  }
  const colours: Colour[] = [...sums.values()]
    .filter((sum) => sum.count >= least)
    .sort((x, y) => y.count - x.count)
    .slice(0, PATCHES.mostColours)
    .map(({ rgb, count, bins }) => {
      const mean: [number, number, number] = [rgb[0] / count, rgb[1] / count, rgb[2] / count]
      return { rgb: mean, lab: srgbToLab(...mean), count, bins }
    })
  // Two colours a person can hardly tell apart are one: the nearest pair is joined while it is within the merge ΔE00.
  for (;;) {
    let first = -1
    let second = -1
    let nearestPair: number = PATCHES.merge
    for (let i = 0; i < colours.length; i++)
      for (let j = i + 1; j < colours.length; j++) {
        const d = ciede2000(colours[i]!.lab, colours[j]!.lab)
        if (d < nearestPair) {
          nearestPair = d
          first = i
          second = j
        }
      }
    if (first < 0) break
    const a = colours[first]!
    const b = colours[second]!
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
function binDistances(palette: readonly Colour[], used: readonly number[], binLab: Float32Array): Float32Array {
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
            (binLab[b * 3]! - binLab[own * 3]!) ** 2 +
            (binLab[b * 3 + 1]! - binLab[own * 3 + 1]!) ** 2 +
            (binLab[b * 3 + 2]! - binLab[own * 3 + 2]!) ** 2
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
function farthestColours(
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
    let bestDistance = PATCHES.explained ** 2
    for (const b of bins) {
      if (taken[b]) continue
      let d = toPalette(b)
      for (const colour of found) d = Math.min(d, lab2(binLab, b, colour.lab))
      if (d <= bestDistance) continue
      // Its neighbourhood must hold enough pixels to be a colour of the drawing.
      let mass = 0
      const lab = labAt(binLab, b)
      for (const other of bins) if (lab2(binLab, other, lab) <= PATCHES.explained ** 2) mass += h.count[other]!
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
      if (d <= PATCHES.explained ** 2) taken[other] = 1
      if (d > (PATCHES.explained / 2) ** 2) continue
      count += h.count[other]!
      for (let c = 0; c < 3; c++) sums[c] = sums[c]! + h.sums[other * 3 + c]!
    }
    const rgb: [number, number, number] = [sums[0]! / count, sums[1]! / count, sums[2]! / count]
    found.push({ rgb, lab: srgbToLab(...rgb), count, bins: [] })
  }
  return found
}

function labAt(binLab: Float32Array, b: number): Lab {
  return [binLab[b * 3]!, binLab[b * 3 + 1]!, binLab[b * 3 + 2]!]
}

function lab2(binLab: Float32Array, b: number, lab: Lab): number {
  return (binLab[b * 3]! - lab[0]) ** 2 + (binLab[b * 3 + 1]! - lab[1]) ** 2 + (binLab[b * 3 + 2]! - lab[2]) ** 2
}

/** The squared distance from p to the segment from a to b. */
function toSegment2(p: Lab, a: Lab, b: Lab): number {
  const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]] as const
  const length = d[0] ** 2 + d[1] ** 2 + d[2] ** 2
  const t =
    length < 1e-9
      ? 0
      : Math.max(0, Math.min(1, ((p[0] - a[0]) * d[0] + (p[1] - a[1]) * d[1] + (p[2] - a[2]) * d[2]) / length))
  return (p[0] - a[0] - t * d[0]) ** 2 + (p[1] - a[1] - t * d[1]) ** 2 + (p[2] - a[2] - t * d[2]) ** 2
}

function distance2(a: readonly number[], b: readonly number[]): number {
  return (a[0]! - b[0]!) ** 2 + (a[1]! - b[1]!) ** 2 + (a[2]! - b[2]!) ** 2
}

/** How far pixel i's colour lies from colour `from` (0) towards colour `to` (1), clamped. */
function towards(data: Float32Array, i: number, from: readonly number[], to: readonly number[]): number {
  let dot = 0
  let length = 0
  for (let c = 0; c < 3; c++) {
    const d = to[c]! - from[c]!
    dot += (data[i * 4 + c]! - from[c]!) * d
    length += d * d
  }
  return length < 1e-6 ? 1 : Math.max(0, Math.min(1, dot / length))
}

/**
 * A patch's outlines, by marching squares at one half over its coverage in its box: a pixel of its own counts
 * whole, or by its mix when its mixed neighbour is another patch's; another patch's pixel mixed with one of its
 * own counts by the rest of that mix.
 */
function outlines(r: Patch, patchOf: Int32Array, near: Int32Array, mix: Float32Array, width: number, height: number) {
  // The window: the box and a pixel around it, and a ring of zero around that.
  const x0 = r.box.x0 - 2
  const y0 = r.box.y0 - 2
  const w = r.box.x1 - r.box.x0 + 5
  const h = r.box.y1 - r.box.y0 + 5
  const cover = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++) {
    const yy = y + y0
    if (yy < 0 || yy >= height) continue
    for (let x = 1; x < w - 1; x++) {
      const xx = x + x0
      if (xx < 0 || xx >= width) continue
      const i = yy * width + xx
      const mixed = near[i]!
      if (patchOf[i] === r.id) cover[y * w + x] = mixed < 0 || patchOf[mixed] === r.id ? 1 : mix[i]!
      else if (mixed >= 0 && patchOf[mixed] === r.id) cover[y * w + x] = 1 - mix[i]!
    }
  }
  // A stroke thinner than a pixel never covers a pixel by half. Each pixel is pushed away from the mean of its
  // 3 × 3 neighbourhood, which lifts such a stroke over one half and leaves a straight edge where it is.
  const sharp = new Float32Array(w * h)
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const mean =
        (cover[i - w - 1]! +
          cover[i - w]! +
          cover[i - w + 1]! +
          cover[i - 1]! +
          cover[i]! +
          cover[i + 1]! +
          cover[i + w - 1]! +
          cover[i + w]! +
          cover[i + w + 1]!) /
        9
      sharp[i] = cover[i]! + PATCHES.sharpen * (cover[i]! - mean)
    }
  r.loops = marchingSquares(sharp, w, h, x0 + 0.5, y0 + 0.5)
  r.outline = 0
  for (const loop of r.loops) if (loop.area > 0) r.outline += loop.area
}

/**
 * The closed outlines where a mask with a ring of zero crosses one half, through sub-pixel points on the lines
 * between pixel centres, moved by (`left`, `top`). An outer outline has an area above 0, a hole below.
 */
export function marchingSquares(mask: Float32Array, w: number, h: number, left: number, top: number): Loop[] {
  // Each crossed edge has two ends of outline. Edge ids: across from (x, y) is 2 (y w + x), down is that plus 1.
  const ends = new Int32Array(2 * w * h * 2).fill(-1)
  const link = (a: number, b: number) => {
    ends[a * 2 + (ends[a * 2]! < 0 ? 0 : 1)] = b
    ends[b * 2 + (ends[b * 2]! < 0 ? 0 : 1)] = a
  }
  const crossed: number[] = []
  for (let y = 0; y < h - 1; y++)
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x
      const a = mask[i]!
      const b = mask[i + 1]!
      const c = mask[i + w + 1]!
      const d = mask[i + w]!
      const corners = (a >= 0.5 ? 1 : 0) | (b >= 0.5 ? 2 : 0) | (c >= 0.5 ? 4 : 0) | (d >= 0.5 ? 8 : 0)
      if (corners === 0 || corners === 15) continue
      const topEdge = 2 * i
      const bottom = 2 * (i + w)
      const leftEdge = 2 * i + 1
      const right = 2 * (i + 1) + 1
      crossed.push(i)
      switch (corners) {
        case 1:
        case 14:
          link(leftEdge, topEdge)
          break
        case 2:
        case 13:
          link(topEdge, right)
          break
        case 3:
        case 12:
          link(leftEdge, right)
          break
        case 4:
        case 11:
          link(right, bottom)
          break
        case 6:
        case 9:
          link(topEdge, bottom)
          break
        case 7:
        case 8:
          link(leftEdge, bottom)
          break
        default: {
          // A saddle joins as its centre says. Its four edges would each get two ends from this cell alone, so
          // the links are kept apart from the neighbours' by joining through the cell: handled as two links.
          const centreIn = (a + b + c + d) / 4 >= 0.5
          if ((corners === 5) === centreIn) {
            link(topEdge, right)
            link(leftEdge, bottom)
          } else {
            link(leftEdge, topEdge)
            link(right, bottom)
          }
        }
      }
    }
  const point = (edge: number): [number, number] => {
    const i = edge >> 1
    const x = i % w
    const y = (i - x) / w
    const a = mask[i]!
    const b = edge & 1 ? mask[i + w]! : mask[i + 1]!
    const t = Math.abs(b - a) < 1e-9 ? 0.5 : (0.5 - a) / (b - a)
    return edge & 1 ? [x + left, y + t + top] : [x + t + left, y + top]
  }
  const done = new Uint8Array(2 * w * h)
  const loops: Loop[] = []
  for (const cell of crossed)
    for (const start of [2 * cell, 2 * cell + 1, 2 * (cell + w), 2 * (cell + 1) + 1]) {
      if (done[start] || ends[start * 2]! < 0) continue
      const xy: number[] = []
      let previous = -1
      let current = start
      while (!done[current]) {
        done[current] = 1
        const p = point(current)
        xy.push(p[0], p[1])
        const a = ends[current * 2]!
        const b = ends[current * 2 + 1]!
        const next = a !== previous && a >= 0 && !done[a] ? a : b
        if (next < 0 || done[next]) break
        previous = current
        current = next
      }
      if (xy.length < 6) continue
      let area = 0
      for (let k = 0; k < xy.length; k += 2) {
        const m = (k + 2) % xy.length
        area += xy[k]! * xy[m + 1]! - xy[m]! * xy[k + 1]!
      }
      // An outer outline holds the covered pixel of the edge it starts on; a hole doesn't.
      const i = start >> 1
      const other = start & 1 ? i + w : i + 1
      const inside = mask[i]! >= 0.5 ? i : other
      const outer = holds(xy, (inside % w) + left, Math.floor(inside / w) + top)
      loops.push({ points: Float32Array.from(xy), area: (outer ? 1 : -1) * Math.abs(area / 2) })
    }
  return loops
}

/** Whether the closed outline `xy` (x, y pairs) holds the point. */
export function holds(xy: ArrayLike<number>, px: number, py: number): boolean {
  let inside = false
  for (let k = 0, j = xy.length - 2; k < xy.length; j = k, k += 2) {
    const xi = xy[k]!
    const yi = xy[k + 1]!
    const xj = xy[j]!
    const yj = xy[j + 1]!
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
