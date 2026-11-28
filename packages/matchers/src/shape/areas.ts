// Areas: step 2 of the cut (`patches.ts`). Joined pixels of one colour are an area. Specks join the area they
// border most, and so do the faded edge of an area and a small shade of it; areas that meet with no edge between
// them (the bands of one gradient) are one.

import { ciede2000 } from '../looks-same/colour.ts'
import type { Labels } from './labels.ts'
import { distance2 } from './palette.ts'
import type { FloatPicture } from './parts/float-picture.ts'

/** The settings of the areas. */
export const AREAS = {
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
} as const

/**
 * The areas of a picture's `seen` pixels once specks and bands are joined: what gives the pixel that stands for a
 * pixel's area, or null when the picture has too many areas to be a flat drawing. `covered` is how many pixels the
 * piece covers; borders under `hidden` pixels are not read.
 */
export function joinedAreas(
  picture: FloatPicture,
  seen: Uint8Array,
  { palette, label, fading }: Labels,
  covered: number,
  hidden?: Uint8Array,
): ((i: number) => number) | null {
  const { width, height, data } = picture
  const n = width * height
  // Areas of one colour, 4-connected.
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
  if (areas > AREAS.mostAreas) return null
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
  const speck = Math.max(AREAS.speckPixels, AREAS.speckShare * covered)
  const shadeSize = Math.max(AREAS.shadePixels, AREAS.shadeShare * covered)
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
        ciede2000(smallColour.lab, otherColour.lab) < AREAS.shade
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
    const edge = Math.max(Math.min(AREAS.smooth, AREAS.smoothShare * apart), AREAS.grain * Math.max(grain(a), grain(b)))
    if (step / pairs <= edge) union(a, b)
  }
  return find
}
