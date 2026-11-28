// The colour of each covered pixel: step 1 of the cut (`patches.ts`). A pixel is flat when its neighbours have its
// colour; the flat pixels' colours give the piece's colours (`palette.ts`). A flat pixel has its nearest colour, an
// edge pixel the colour of a neighbour that explains it, alone or mixed with another neighbour's, and a fading pixel
// the colour of its most solid neighbour. A pixel no colour explains is counted again, and the colours farthest
// from the ones found are added, a few times over; what still stays unexplained is shading or texture. What other
// layers hide adds no colour: it takes one of the piece's when its own colour is one, and else the colour nearest
// to it that shows.

import { type Lab, srgbToLab } from '../looks-same/colour.ts'
import { FRINGE } from './fringe.ts'
import {
  add,
  binDistances,
  BINS,
  type Colour,
  coloursOf,
  farthestColours,
  histogram,
  labAt,
  PALETTE,
} from './palette.ts'
import type { FloatPicture } from './parts/float-picture.ts'

/** A picture's colours, and which of them each pixel has. */
export interface Labels {
  palette: Colour[]
  /** Each seen pixel's colour, as its number in the palette; -1 for a pixel that is not seen. */
  label: Int16Array
  /** 1 for each seen pixel under the alpha of a solid one: the soft edge of the piece, which fades. */
  fading: Uint8Array
  /** How many pixels no colour explains, alone or mixed. */
  unexplained: number
  /**
   * 1 for each pixel at the piece's own edge whose colour is a mix of its colour and what is behind the piece: an
   * edge pixel of its area, covered by its share of that colour. None when what is behind is not known.
   */
  rim: Uint8Array | null
}

/** The settings of the labelling. */
export const LABELS = {
  /** Neighbours within this of each other, of 255 a channel, are of one flat colour. */
  flat: 8,
  /** A colour needs this share of the covered pixels, and at least `leastPixels`, to count. */
  leastShare: 0.00002,
  leastPixels: 3,
  /** More bins of colour filled than this and the picture is no flat drawing either. */
  mostBins: 1200,
} as const

/**
 * The colours of a picture and the colour of each of its `seen` pixels, or null when it fills too many bins of
 * colour to be a flat drawing. `norm` times a pixel's alpha is its share of the piece's full alpha, and `covered`
 * how many pixels the piece covers. A pixel marked in `hidden` adds no colour to the picture's colours.
 */
export function pixelColours(
  picture: FloatPicture,
  seen: Uint8Array,
  norm: number,
  covered: number,
  hidden?: Uint8Array,
  behind?: readonly [number, number, number],
): Labels | null {
  const { width, height, data } = picture
  const n = width * height
  const behindLab = behind ? srgbToLab(...behind) : null
  const outer = behind ? outerEdge(seen, width, height) : null
  const rim = behind ? new Uint8Array(n) : null
  const bin = new Uint16Array(n)
  for (let i = 0; i < n; i++) {
    if (!seen[i]) continue
    bin[i] = (((data[i * 4] ?? 0) >> 3) << 10) | (((data[i * 4 + 1] ?? 0) >> 3) << 5) | ((data[i * 4 + 2] ?? 0) >> 3)
  }

  // The flat colours. A fading pixel (the soft edge of the piece) has no colour to count.
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
  const least = Math.max(LABELS.leastPixels, LABELS.leastShare * covered)
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
  if (used.length > LABELS.mostBins) return null
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
    rim?.fill(0)
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
            // At the piece's own edge, a mix of a neighbour's colour and what is behind the piece is that
            // neighbour's edge, drawn over the ground.
            if (!explained && nearest && behindLab && outer?.[i] && rim) {
              explained = toSegment2(p, nearest.lab, behindLab) <= within
              if (explained) rim[i] = 1
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
  return { palette, label, fading, unexplained, rim }
}

/** 1 for each seen pixel within two pixels of one that is not seen, or of the picture's border: the piece's own edge. */
function outerEdge(seen: Uint8Array, width: number, height: number): Uint8Array {
  let from = new Uint8Array(width * height)
  for (let i = 0; i < from.length; i++) from[i] = seen[i] ? 0 : 1
  const outer = new Uint8Array(width * height)
  for (let step = 0; step < 2; step++) {
    const next = new Uint8Array(width * height)
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (!seen[i] || outer[i]) continue
        let beside = step === 0 && (x === 0 || y === 0 || x === width - 1 || y === height - 1)
        for (let dy = -1; dy <= 1 && !beside; dy++)
          for (let dx = -1; dx <= 1 && !beside; dx++) {
            const xx = x + dx
            const yy = y + dy
            beside = xx >= 0 && yy >= 0 && xx < width && yy < height && from[yy * width + xx] === 1
          }
        if (beside) next[i] = 1
      }
    for (let i = 0; i < outer.length; i++) if (next[i]) outer[i] = 1
    from = next
  }
  return outer
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
      if (Math.abs((data[i * 4 + c] ?? 0) - (data[j * 4 + c] ?? 0)) > LABELS.flat) return false
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
