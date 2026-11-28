// Patches: a piece cut into the areas of one flat colour it is drawn with, each with its sub-pixel outlines. The
// soft fringe of a shadow or glow (`fringe.ts`) is no part of a patch.
//
// 1. Every covered pixel takes one of the piece's flat colours (`labels.ts`, `palette.ts`).
// 2. Joined pixels of one colour are an area; specks join the area they border most, and areas that meet with no
//    edge between them are one (`areas.ts`). Each area left is a patch.
// 3. An edge pixel between two patches is a mix of their colours: how far its colour lies towards its own patch's
//    is its share of it, so a patch's outline crosses the pixel where the edge really is (marching squares at one
//    half, `outlines.ts`). A piece's own see-through edge mixes by alpha in the same way.

import { joinedAreas } from './areas.ts'
import { FRINGE, fringeOf } from './fringe.ts'
import { type Labels, pixelColours } from './labels.ts'
import { INNER, type Loop, outlines, OVER_GROUND } from './outlines.ts'
import { distance2 } from './palette.ts'
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
  /** Whether more patches than asked for hold an outline: the tracing stopped there, so not every patch has its outlines. */
  tooMany: boolean
  /** Whether any edge pixel was read as mixed with the colour behind the piece. */
  rim: boolean
}

/** What a cut is made with besides the picture and what is hidden of it. */
export interface CutOptions {
  /** The most patches the caller takes, each with an outline of at least `outline` pixels. */
  most?: { patches: number; outline: number }
  /** The colour behind the piece: edge pixels mixed with it are edges, no patches of their own. */
  behind?: readonly [number, number, number]
}

/**
 * Cuts a picture into patches of one flat colour each, or null when it has too many colours or areas to be a flat
 * drawing; a picture that covers next to nothing has no patch. A pixel marked in `hidden` (other layers cover it
 * in the frame) adds no colour to the picture's colours: it takes one of them when its own colour is one, and else
 * the patch nearest to it that shows, so what a layer hides and the picture's colours don't explain is filled in
 * from around it. With `most`, the patches' outlines are traced only until more of them than that hold one.
 */
export function splitPatches(
  picture: FloatPicture,
  hidden?: Uint8Array,
  { most, behind }: CutOptions = {},
): Split | null {
  const { width, height, data } = picture
  const n = width * height
  const { cut, covered } = coverageCut(picture)
  // A picture that covers next to nothing has no patch.
  if (covered < 4)
    return {
      width,
      height,
      patchOf: new Int32Array(n).fill(-1),
      patches: [],
      unexplained: 0,
      tooMany: false,
      rim: false,
    }
  const norm = 1 / (2 * cut)
  const fringe = fringeOf(picture, cut, norm)
  const seen = new Uint8Array(n)
  for (let i = 0; i < n; i++) if ((data[i * 4 + 3] ?? 0) >= cut && !fringe[i]) seen[i] = 1
  const colours = pixelColours(picture, seen, norm, covered, hidden, behind)
  if (!colours) return null
  const find = joinedAreas(picture, seen, colours, covered, hidden)
  if (!find) return null
  const { patches, patchOf } = numbered(seen, find, colours.label, width, height)
  const { near, mix } = edgeMixes(picture, patchOf, colours, fringe, norm, hidden, behind)
  const rim = colours.rim?.includes(1) ?? false
  colour(patches, patchOf, near, data, colours, hidden)
  const unexplained = colours.unexplained / covered
  let outlined = 0
  for (const r of patches) {
    outlines(r, patchOf, near, mix, width, height)
    if (most && r.outline >= most.outline && ++outlined > most.patches) {
      return { width, height, patchOf, patches, unexplained, tooMany: true, rim }
    }
  }
  return { width, height, patchOf, patches, unexplained, tooMany: false, rim }
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

/** The patches of the areas, numbered by where they first appear, and each pixel's patch. */
function numbered(
  seen: Uint8Array,
  find: (i: number) => number,
  label: Int16Array,
  width: number,
  height: number,
): { patches: Patch[]; patchOf: Int32Array } {
  const n = width * height
  const idOf = new Int32Array(n).fill(-1)
  const patchOf = new Int32Array(n).fill(-1)
  const patches: Patch[] = []
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
      }
      patchOf[i] = id
      const r = patches[id]
      if (!r) continue
      r.area++
      if (x < r.box.x0) r.box.x0 = x
      if (x > r.box.x1) r.box.x1 = x
      if (y > r.box.y1) r.box.y1 = y
    }
  return { patches, patchOf }
}

/**
 * Each edge pixel's mix with the neighbour it differs from most: `near` is that neighbour, `INNER` for a pixel
 * with none and `OVER_GROUND` for one with none that is mixed with what is behind the piece, and `mix` the pixel's
 * share of its own patch.
 */
function edgeMixes(
  { width, height, data }: FloatPicture,
  patchOf: Int32Array,
  { palette, label, rim }: Labels,
  fringe: Uint8Array,
  norm: number,
  hidden?: Uint8Array,
  behind?: readonly [number, number, number],
): { near: Int32Array; mix: Float32Array } {
  const n = width * height
  const near = new Int32Array(n).fill(INNER)
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
      // A pixel mixed with what is behind the piece is covered by its share of its patch's colour.
      const share = behind && rim?.[i] ? towards(data, i, behind, rgbOf(label[i] ?? 0)) : 1
      if (pick < 0) {
        if (share < 1) {
          near[i] = OVER_GROUND
          mix[i] = alpha * share
        }
        continue
      }
      near[i] = pick
      // A fringe is none of the patch beside it, and the patch's edge pixel is covered by what it has over the fringe.
      if (own < 0) mix[i] = fringe[i] ? 1 : 1 - alpha
      else if (fringe[pick]) {
        const under = Math.min(1, (data[pick * 4 + 3] ?? 0) * norm)
        mix[i] = alpha >= FRINGE.solid ? 1 : Math.max(0, Math.min(1, (alpha - under) / Math.max(1e-3, 1 - under)))
      } else if ((patchOf[pick] ?? 0) < 0) mix[i] = alpha * share
      else
        mix[i] = Math.max(0.5, towards(data, i, rgbOf(label[pick] ?? 0), rgbOf(label[i] ?? 0))) * Math.max(alpha, 0.5)
    }
  return { near, mix }
}

/**
 * Gives each patch its colour and alpha: the mean of its inner pixels that show when it has enough, else of its
 * most solid ones, and the colour it was cut by when other layers hide all of it.
 */
function colour(
  patches: Patch[],
  patchOf: Int32Array,
  near: Int32Array,
  data: Float32Array,
  { palette, rim }: Labels,
  hidden?: Uint8Array,
) {
  const n = patchOf.length
  // red, green, blue, their squares, alpha and count over the inner pixels; then over the most solid ones.
  const sums = patches.map(() => new Float64Array(16))
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
      near[i] === INNER ? 0 : -1,
      !rim?.[i] && (data[i * 4 + 3] ?? 0) >= FRINGE.solid * (fullest[id] ?? 0) ? 8 : -1,
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
    // A patch other layers hide all of has the colour it was cut by: it is drawn under them as the piece holds it.
    const cut = palette[r.colour]
    if (!s[15] && cut) {
      r.rgb = [cut.rgb[0], cut.rgb[1], cut.rgb[2]]
      continue
    }
    const from = (s[7] ?? 0) >= Math.max(4, 0.1 * r.area) ? 0 : 8
    const count = (s[from + 7] ?? 0) || 1
    r.rgb = [(s[from] ?? 0) / count, (s[from + 1] ?? 0) / count, (s[from + 2] ?? 0) / count]
    r.alpha = (s[from + 7] ?? 0) ? Math.min(1, (s[from + 6] ?? 0) / count) : 1
    let variance = 0
    for (let c = 0; c < 3; c++) variance += Math.max(0, (s[from + 3 + c] ?? 0) / count - (r.rgb[c] ?? 0) ** 2)
    r.spread = Math.sqrt(variance / 3)
  }
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
