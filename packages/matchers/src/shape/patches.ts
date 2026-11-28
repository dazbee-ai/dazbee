// Patches: a piece cut into the areas of one flat colour it is drawn with, each with its sub-pixel outlines. The
// soft fringe of a shadow or glow (`fringe.ts`) is no part of a patch.
//
// 1. Flat colours (`palette.ts`). A pixel is flat when its neighbours have its colour; the flat pixels' colours,
//    counted in bins of 5 bits a channel, give the piece's colours (bins closer than a ΔE00 are one colour). A pixel
//    no colour explains, alone or mixed with a neighbour's (a thin line has no flat pixel), is counted again, and the
//    colour farthest from the ones found is added, a few times over. What still stays unexplained is shading or
//    texture.
// 2. Every covered pixel takes its nearest colour, and joined pixels of one colour are an area. Specks join the
//    area they border most, and areas that meet with no edge between them (the bands of one gradient) are one patch.
// 3. An edge pixel between two patches is a mix of their colours: how far its colour lies towards its own patch's
//    is its share of it, so a patch's outline crosses the pixel where the edge really is (marching squares at one
//    half, `outlines.ts`). A piece's own see-through edge mixes by alpha in the same way.

import { ciede2000, type Lab, srgbToLab } from '../looks-same/colour.ts'
import { FRINGE, fringeOf } from './fringe.ts'
import { type Loop, outlines } from './outlines.ts'
import { add, binDistances, BINS, coloursOf, farthestColours, histogram, labAt, PALETTE } from './palette.ts'
import type { FloatPicture } from './parts/float-picture.ts'

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
  /** A colour needs this share of the covered pixels, and at least `leastPixels`, to count. */
  leastShare: 0.00002,
  leastPixels: 3,
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
  /** More areas than this and the cut stops: the picture is no flat drawing. */
  mostAreas: 1000,
  /** More bins of colour filled than this and the picture is no flat drawing either. */
  mostBins: 1200,
} as const

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
    bin[i] = (((data[i * 4] ?? 0) >> 3) << 10) | (((data[i * 4 + 1] ?? 0) >> 3) << 5) | ((data[i * 4 + 2] ?? 0) >> 3)
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
      add(all, bin[i] ?? 0, data, i)
      if (hidden?.[i]) continue
      if ((data[i * 4 + 3] ?? 0) * norm < FRINGE.solid) {
        fading[i] = 1
        continue
      }
      add(strong, bin[i] ?? 0, data, i)
      strongCount++
      if (isFlat(data, seen, width, height, x, y)) {
        add(flat, bin[i] ?? 0, data, i)
        isFlatPixel[i] = 1
        flatCount++
      }
    }
  const least = Math.max(PATCHES.leastPixels, PATCHES.leastShare * covered)
  const binLab = new Float32Array(BINS * 3)
  const used: number[] = []
  for (let b = 0; b < BINS; b++) {
    const count = all.count[b] ?? 0
    if (!count) continue
    used.push(b)
    const lab = srgbToLab(
      (all.sums[b * 3] ?? 0) / count,
      (all.sums[b * 3 + 1] ?? 0) / count,
      (all.sums[b * 3 + 2] ?? 0) / count,
    )
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
  const within = PALETTE.explained ** 2
  let unexplained = 0
  for (let round = 0; round < 3; round++) {
    const colours = palette.length
    const distances = binDistances(palette, used, binLab)
    used.forEach((b, row) => {
      rowOf[b] = row
      let best = 0
      for (let c = 1; c < colours; c++)
        if ((distances[row * colours + c] ?? 0) < (distances[row * colours + best] ?? 0)) best = c
      binLabel[b] = best
    })
    // A flat pixel has its nearest colour. An edge pixel has the colour of a neighbour that explains it, as that
    // colour or as its mix with another neighbour's, so a mix of two colours never takes a third that lies between
    // them; a fading pixel has the colour of its most solid neighbour, which it fades from.
    label.fill(-1)
    for (let i = 0; i < n; i++) if (isFlatPixel[i]) label[i] = binLabel[bin[i] ?? 0] ?? 0
    const candidates = new Int16Array(8)
    for (let sweep = 0; sweep < 6; sweep++) {
      let changed = false
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++) {
          const i = y * width + x
          if (!seen[i] || (label[i] ?? 0) >= 0) continue
          let count = 0
          let solid = -1
          let solidAlpha = -1
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const xx = x + dx
              const yy = y + dy
              if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
              const j = yy * width + xx
              const l = label[j] ?? 0
              if (l < 0) continue
              if ((data[j * 4 + 3] ?? 0) > solidAlpha) {
                solidAlpha = data[j * 4 + 3] ?? 0
                solid = l
              }
              if (!candidates.subarray(0, count).includes(l)) candidates[count++] = l
            }
          if (count === 0) continue
          const b = bin[i] ?? 0
          // A fading pixel has the colour of its most solid neighbour, which it fades from, when it is that colour.
          if (fading[i] && !hidden?.[i] && (distances[(rowOf[b] ?? 0) * colours + solid] ?? 0) <= within) {
            label[i] = solid
            changed = true
            continue
          }
          let best = candidates[0] ?? 0
          let bestDistance = Infinity
          for (let k = 0; k < count; k++) {
            const d = distances[(rowOf[b] ?? 0) * colours + (candidates[k] ?? 0)] ?? 0
            if (d < bestDistance) {
              bestDistance = d
              best = candidates[k] ?? 0
            }
          }
          let explained = bestDistance <= within
          if (!explained) {
            const nearest = palette[best]
            const p = labAt(binLab, b)
            for (let k = 0; nearest && k < count && !explained; k++) {
              const other = palette[candidates[k] ?? 0]
              explained = candidates[k] !== best && !!other && toSegment2(p, nearest.lab, other.lab) <= within
            }
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
      if (!seen[i] || (label[i] ?? 0) >= 0) continue
      const b = bin[i] ?? 0
      if (hidden?.[i]) {
        if ((distances[(rowOf[b] ?? 0) * colours + (binLabel[b] ?? 0)] ?? 0) <= within) label[i] = binLabel[b] ?? 0
        continue
      }
      label[i] = binLabel[b] ?? 0
      if ((distances[(rowOf[b] ?? 0) * colours + (label[i] ?? 0)] ?? 0) <= within) continue
      add(left, b, data, i)
      unexplained++
    }
    if (unexplained < least || palette.length >= PALETTE.mostColours || round === 2) break
    const more = farthestColours(
      left,
      binLab,
      (b) => distances[(rowOf[b] ?? 0) * colours + (binLabel[b] ?? 0)] ?? 0,
      least,
    )
    if (more.length === 0) break
    palette = [...palette, ...more].slice(0, PALETTE.mostColours)
  }

  // What other layers hide, and no colour explains, takes the colour nearest to it, spreading in from around.
  if (hidden) {
    const queue = new Int32Array(n)
    let end = 0
    for (let i = 0; i < n; i++) if ((label[i] ?? 0) >= 0) queue[end++] = i
    for (let start = 0; start < end; start++) {
      const i = queue[start] ?? 0
      const x = i % width
      for (const j of [x > 0 ? i - 1 : -1, x < width - 1 ? i + 1 : -1, i - width, i + width]) {
        if (j < 0 || j >= n || !seen[j] || (label[j] ?? 0) >= 0) continue
        label[j] = label[i] ?? 0
        queue[end++] = j
      }
    }
    for (let i = 0; i < n; i++) if (seen[i] && (label[i] ?? 0) < 0) label[i] = 0
  }

  // 2. Areas of one colour, 4-connected.
  const parent = new Int32Array(n)
  for (let i = 0; i < n; i++) parent[i] = i
  const find = (i: number): number => {
    let root = i
    while (parent[root] !== root) root = parent[root] ?? 0
    while (parent[i] !== root) {
      const next = parent[i] ?? 0
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
      size[root] = (size[root] ?? 0) + 1
      if (!fading[i]) solid[root] = (solid[root] ?? 0) + 1
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
    const a = rootOf[i] ?? 0
    const b = rootOf[j] ?? 0
    const step = Math.max(
      Math.abs((data[i * 4] ?? 0) - (data[j * 4] ?? 0)),
      Math.abs((data[i * 4 + 1] ?? 0) - (data[j * 4 + 1] ?? 0)),
      Math.abs((data[i * 4 + 2] ?? 0) - (data[j * 4 + 2] ?? 0)),
    )
    if (hidden && (hidden[i] || hidden[j])) return
    if (a === b) {
      if (fading[i] || fading[j]) return
      grainPairs[a] = (grainPairs[a] ?? 0) + 1
      grainStep[a] = (grainStep[a] ?? 0) + step
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
      const smallColour = palette[label[small] ?? 0]
      const otherColour = palette[label[other] ?? 0]
      if (!smallColour || !otherColour) continue
      const fringe = solid[small] === 0 && (solid[other] ?? 0) > 0
      const shade =
        (size[small] ?? 0) < shadeSize &&
        (size[other] ?? 0) >= (size[small] ?? 0) &&
        ciede2000(smallColour.lab, otherColour.lab) < PATCHES.shade
      if (!fringe && !shade && ((size[small] ?? 0) >= speck || (size[other] ?? 0) < (size[small] ?? 0))) continue
      const best = most.get(small)
      if (!best || pairs > best.pairs) most.set(small, { into: other, pairs })
    }
  for (const [small, { into }] of most) parent[find(small)] = find(into)
  // Areas that meet with no edge are one patch: the step across their border is small, or no more than the grain
  // of the grainier of the two.
  const grain = (root: number) => ((grainPairs[root] ?? 0) >= 8 ? (grainStep[root] ?? 0) / (grainPairs[root] ?? 0) : 0)
  for (const { a, b, pairs, step } of borders.values()) {
    if (pairs < 6) continue
    const one = palette[label[a] ?? 0]
    const other = palette[label[b] ?? 0]
    if (!one || !other) continue
    const apart = Math.sqrt(distance2(one.rgb, other.rgb))
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
      let id = idOf[root] ?? 0
      if (id < 0) {
        id = idOf[root] = patches.length
        patches.push({
          id,
          colour: label[root] ?? 0,
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
      const r = patches[id]
      if (!r) continue
      r.area++
      if (x < r.box.x0) r.box.x0 = x
      if (x > r.box.x1) r.box.x1 = x
      if (y > r.box.y1) r.box.y1 = y
    }
  // 3. Each edge pixel's mix with the neighbour it differs from most.
  const near = new Int32Array(n).fill(-1)
  const mix = new Float32Array(n).fill(1)
  const rgbOf = (c: number): readonly number[] => palette[c]?.rgb ?? []
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (hidden?.[i]) continue
      const own = patchOf[i] ?? 0
      const alpha = Math.min(1, (data[i * 4 + 3] ?? 0) * norm)
      let pick = -1
      let far = -1
      for (let k = 0; k < 4; k++) {
        const xx = x + (k === 0 ? -1 : k === 1 ? 1 : 0)
        const yy = y + (k === 2 ? -1 : k === 3 ? 1 : 0)
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
        const j = yy * width + xx
        const other = patchOf[j] ?? 0
        if (other === own) continue
        // A see-through neighbour, or a see-through pixel's covered one, comes first: alpha is the mix.
        const d = own < 0 || other < 0 ? Infinity : distance2(rgbOf(label[i] ?? 0), rgbOf(label[j] ?? 0))
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
        const under = Math.min(1, (data[pick * 4 + 3] ?? 0) * norm)
        mix[i] = alpha >= FRINGE.solid ? 1 : Math.max(0, Math.min(1, (alpha - under) / Math.max(1e-3, 1 - under)))
      } else if ((patchOf[pick] ?? 0) < 0) mix[i] = alpha
      else
        mix[i] = Math.max(0.5, towards(data, i, rgbOf(label[pick] ?? 0), rgbOf(label[i] ?? 0))) * Math.max(alpha, 0.5)
    }
  // A patch's colour and alpha: the mean of its inner pixels when it has enough, else of its most solid ones.
  const fullest = new Float32Array(patches.length)
  for (let i = 0; i < n; i++) {
    const id = patchOf[i] ?? 0
    if (id >= 0 && !hidden?.[i] && (data[i * 4 + 3] ?? 0) > (fullest[id] ?? 0)) fullest[id] = data[i * 4 + 3] ?? 0
  }
  for (let i = 0; i < n; i++) {
    const id = patchOf[i] ?? 0
    const s = sums[id]
    if (id < 0 || !s || hidden?.[i]) continue
    for (const from of [
      (near[i] ?? 0) < 0 ? 0 : -1,
      (data[i * 4 + 3] ?? 0) >= FRINGE.solid * (fullest[id] ?? 0) ? 8 : -1,
    ]) {
      if (from < 0) continue
      for (let c = 0; c < 3; c++) {
        s[from + c] = (s[from + c] ?? 0) + (data[i * 4 + c] ?? 0)
        s[from + 3 + c] = (s[from + 3 + c] ?? 0) + (data[i * 4 + c] ?? 0) ** 2
      }
      s[from + 6] = (s[from + 6] ?? 0) + (data[i * 4 + 3] ?? 0)
      s[from + 7] = (s[from + 7] ?? 0) + 1
    }
  }
  for (const r of patches) {
    const s = sums[r.id]
    if (!s) continue
    const from = (s[7] ?? 0) >= Math.max(4, 0.1 * r.area) ? 0 : 8
    const count = (s[from + 7] ?? 0) || 1
    r.rgb = [(s[from] ?? 0) / count, (s[from + 1] ?? 0) / count, (s[from + 2] ?? 0) / count]
    r.alpha = (s[from + 7] ?? 0) ? Math.min(1, (s[from + 6] ?? 0) / count) : 1
    let variance = 0
    for (let c = 0; c < 3; c++) variance += Math.max(0, (s[from + 3 + c] ?? 0) / count - (r.rgb[c] ?? 0) ** 2)
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
  for (let i = 0; i < n; i++) {
    const level = Math.round((data[i * 4 + 3] ?? 0) * 256)
    counts[level] = (counts[level] ?? 0) + 1
  }
  let above = 0
  let top = 256
  for (; top > 0; top--) {
    above += counts[top] ?? 0
    if (above >= n * 0.005) break
  }
  const cut = Math.max(0.08, Math.min(0.5, (0.5 * top) / 256))
  let covered = 0
  for (let i = 0; i < n; i++) if ((data[i * 4 + 3] ?? 0) >= cut) covered++
  return { cut, covered }
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
    for (let c = 0; c < 3; c++)
      if (Math.abs((data[i * 4 + c] ?? 0) - (data[j * 4 + c] ?? 0)) > PATCHES.flat) return false
  }
  return neighbours >= 2
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
  return ((a[0] ?? 0) - (b[0] ?? 0)) ** 2 + ((a[1] ?? 0) - (b[1] ?? 0)) ** 2 + ((a[2] ?? 0) - (b[2] ?? 0)) ** 2
}

/** How far pixel i's colour lies from colour `from` (0) towards colour `to` (1), clamped. */
function towards(data: Float32Array, i: number, from: readonly number[], to: readonly number[]): number {
  let dot = 0
  let length = 0
  for (let c = 0; c < 3; c++) {
    const d = (to[c] ?? 0) - (from[c] ?? 0)
    dot += ((data[i * 4 + c] ?? 0) - (from[c] ?? 0)) * d
    length += d * d
  }
  return length < 1e-6 ? 1 : Math.max(0, Math.min(1, dot / length))
}
