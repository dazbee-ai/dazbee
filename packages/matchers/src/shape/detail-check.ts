// The detail check: whether a rebuild shows anything a person would see as different in the piece, however small
// a share of the piece it is. The looks-the-same rule counts the share of far pixels after a wide blur, which
// lets a small part go missing in a large piece, and a small piece's fine detail too. Here both pictures are
// brought to between 192 and 512 px on the long side (a small piece is enlarged, as a person zooms in on it), put
// over a grey that contrasts with the piece and blurred only lightly. A pixel is seen as different when the other
// picture explains its colour nowhere near it: not as the colour of a pixel within one pixel, and not as a mix of
// two colours within two pixels, so an edge a pixel off, or softer or sharper, is the same edge. Pixels seen as
// different that join into a blob three pixels thick are a difference in shape; a rim along an edge is not.
// A soft shadow or glow fades into what is behind it, so its loss reads as a softer edge: ink one picture shows
// where the other is clear, beyond the reach of an edge, is counted on its own as halo.

import type { Pixels } from '@dazbee/renderer'

import { srgbToLab } from '../looks-same/colour.ts'
import { pixelDeltaE } from '../looks-same/rule.ts'
import { type FloatPicture, shrinkFloats, toFloatPicture } from './parts/float-picture.ts'

/** What the detail check read. */
export interface Detail {
  /** The share of the foreground seen as different. */
  seen: number
  /** The pixels of the largest blob seen as different that is three pixels thick somewhere, at the size judged. */
  blob: number
  /** The pixels of all such blobs, as a share of the foreground. */
  blobs: number
  /** The size judged at. */
  width: number
  height: number
  /** Which pixels, at that size, are seen as different. */
  different: Uint8Array
  /**
   * The pixels of the largest blob, three pixels thick somewhere, of halo: ink one picture shows where the other
   * is clear and more than `haloReach` pixels from what it covers.
   */
  halo: number
}

export const DETAIL = {
  /**
   * The long side both pictures are judged at: shrunk to the most, enlarged to the least, at most `mostEnlarged`
   * times. A thin piece is enlarged until its short side is `minShort`, within the same limits.
   */
  maxSide: 512,
  minSide: 192,
  minShort: 12,
  mostEnlarged: 4,
  /** Channels within this of each other, of 255, are the same without a closer look. */
  near: 8,
  /** Colours more than this ΔE00 apart are different. */
  farDeltaE: 10,
  /** A colour within this Lab distance of a mix of two colours is that mix. */
  mix: 8,
  /** Halo is looked for where a picture is clear (alpha under `clear`) and further than this from its cover. */
  haloReach: 2,
  clear: 0.02,
  /** Ink is seen as halo from this ΔE00 from what is behind it, or from this alpha when what is behind is not known. */
  haloDeltaE: 6,
  haloAlpha: 0.1,
} as const

/** Each piece at the size it is judged at, kept while the piece is judged again. */
const piecesSized = new WeakMap<Pixels, FloatPicture>()

/** How many times its size a piece is judged at: under 1 for a large piece, over 1 for a small one. */
export function judgedScale(piece: { width: number; height: number }): number {
  const long = Math.max(piece.width, piece.height)
  const short = Math.min(piece.width, piece.height)
  if (long > DETAIL.maxSide) return DETAIL.maxSide / long
  const enlarged = Math.max(1, DETAIL.minSide / long, DETAIL.minShort / short)
  return Math.min(DETAIL.mostEnlarged, DETAIL.maxSide / long, enlarged)
}

/**
 * Reads how a rebuild differs from its piece in detail. The rebuild is given at the piece's size, or as what draws
 * it a number of times that size, which keeps an enlarged rebuild sharp.
 */
export function detailOf(
  piece: Pixels,
  rebuild: Pixels | ((scale: number) => Pixels),
  behind?: readonly [number, number, number],
): Detail {
  const scale = judgedScale(piece)
  const width = Math.max(1, Math.round(piece.width * scale))
  const height = Math.max(1, Math.round(piece.height * scale))
  const kept = piecesSized.get(piece)
  const a = kept ?? sized(toFloatPicture(piece), width, height)
  if (!kept) piecesSized.set(piece, a)
  const b = sized(toFloatPicture(typeof rebuild === 'function' ? rebuild(scale) : rebuild), width, height)
  const n = width * height
  // The grey both are seen over: dark under a light piece, light under a dark one.
  let luma = 0
  let weight = 0
  for (let i = 0; i < n; i++) {
    const alpha = a.data[i * 4 + 3]!
    luma += alpha * (0.2126 * a.data[i * 4]! + 0.7152 * a.data[i * 4 + 1]! + 0.0722 * a.data[i * 4 + 2]!)
    weight += alpha
  }
  const grey = weight > 0 && luma / weight > 128 ? 48 : 208
  const under = behind ?? [grey, grey, grey]
  const seenA = softened(over(a, under), width, height)
  const seenB = softened(over(b, under), width, height)
  const side = (rgb: Float32Array): Side => ({ rgb, lab: new Float32Array(n * 3).fill(NaN), width, height })
  const sideA = side(seenA)
  const sideB = side(seenB)
  const different = new Uint8Array(n)
  const memo = new Map<number, number>()
  let foreground = 0
  let seen = 0
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (a.data[i * 4 + 3]! <= 0.5 && b.data[i * 4 + 3]! <= 0.5) continue
      foreground++
      if (
        Math.abs(seenA[i * 3]! - seenB[i * 3]!) <= DETAIL.near &&
        Math.abs(seenA[i * 3 + 1]! - seenB[i * 3 + 1]!) <= DETAIL.near &&
        Math.abs(seenA[i * 3 + 2]! - seenB[i * 3 + 2]!) <= DETAIL.near
      )
        continue
      if (explained(sideA, sideB, x, y, memo) && explained(sideB, sideA, x, y, memo)) continue
      different[i] = 1
      seen++
    }
  const coverA = coverNear(a, DETAIL.haloReach)
  const coverB = coverNear(b, DETAIL.haloReach)
  const flat = new Float32Array(under)
  const halo = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    const alphaA = a.data[i * 4 + 3]!
    const alphaB = b.data[i * 4 + 3]!
    const inkOfA = alphaB < DETAIL.clear && !coverB[i] && alphaA >= DETAIL.clear
    if (!inkOfA && !(alphaA < DETAIL.clear && !coverA[i] && alphaB >= DETAIL.clear)) continue
    const ink = behind
      ? pixelDeltaE((inkOfA ? seenA : seenB).subarray(i * 3, i * 3 + 3), flat, 0, memo) >= DETAIL.haloDeltaE
      : (inkOfA ? alphaA : alphaB) >= DETAIL.haloAlpha
    if (ink) halo[i] = 1
  }
  const { largest, total } = thickBlobs(different, width, height)
  return {
    seen: foreground ? seen / foreground : 0,
    blob: largest,
    blobs: foreground ? total / foreground : 0,
    width,
    height,
    different,
    halo: thickBlobs(halo, width, height).largest,
  }
}

/** Where a picture's cover (alpha of a half or more) lies within `reach` pixels, each way. */
function coverNear({ width, height, data }: FloatPicture, reach: number): Uint8Array {
  const along = new Uint8Array(width * height)
  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      for (let d = -reach; d <= reach; d++) {
        const xx = x + d
        if (xx >= 0 && xx < width && data[(y * width + xx) * 4 + 3]! >= 0.5) {
          along[y * width + x] = 1
          break
        }
      }
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      for (let d = -reach; d <= reach; d++) {
        const yy = y + d
        if (yy >= 0 && yy < height && along[yy * width + x]) {
          out[y * width + x] = 1
          break
        }
      }
    }
  return out
}

/** A picture as the check reads it: its RGB, and its Lab where it has been asked for. */
interface Side {
  rgb: Float32Array
  lab: Float32Array
  width: number
  height: number
}

/** Where pixel i of a side is in its Lab, worked out once. */
function labOf(side: Side, i: number): number {
  if (Number.isNaN(side.lab[i * 3]!)) {
    side.lab.set(srgbToLab(side.rgb[i * 3]!, side.rgb[i * 3 + 1]!, side.rgb[i * 3 + 2]!), i * 3)
  }
  return i * 3
}

/**
 * Whether side `to` explains the colour of the pixel of `from` at (x, y): a pixel within one pixel has it, or it
 * is a mix of two colours `to` has within two pixels.
 */
function explained(from: Side, to: Side, x: number, y: number, memo: Map<number, number>): boolean {
  const { width, height } = from
  const i = y * width + x
  const one = from.rgb.subarray(i * 3, i * 3 + 3)
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx
      const yy = y + dy
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
      const j = yy * width + xx
      if (pixelDeltaE(one, to.rgb.subarray(j * 3, j * 3 + 3), 0, memo) <= DETAIL.farDeltaE) return true
    }
  const p = labOf(from, i)
  const pl = from.lab[p]!
  const pa = from.lab[p + 1]!
  const pb = from.lab[p + 2]!
  const around: number[] = []
  for (let dy = -2; dy <= 2; dy++)
    for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx
      const yy = y + dy
      if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
      around.push(labOf(to, yy * width + xx))
    }
  const lab = to.lab
  const within = DETAIL.mix ** 2
  for (let s = 0; s < around.length; s++) {
    const a = around[s]!
    const al = lab[a]!
    const aa = lab[a + 1]!
    const ab = lab[a + 2]!
    for (let t = s + 1; t < around.length; t++) {
      const b = around[t]!
      const dl = lab[b]! - al
      const da = lab[b + 1]! - aa
      const db = lab[b + 2]! - ab
      const length = dl * dl + da * da + db * db
      // Two colours that are nearly one are no mix to lie on.
      if (length < within) continue
      const k = Math.max(0, Math.min(1, ((pl - al) * dl + (pa - aa) * da + (pb - ab) * db) / length))
      if ((pl - al - k * dl) ** 2 + (pa - aa - k * da) ** 2 + (pb - ab - k * db) ** 2 <= within) return true
    }
  }
  return false
}

/** A picture at a size: shrunk by area, or enlarged with a bicubic curve on its colour times its alpha. */
function sized(picture: FloatPicture, width: number, height: number): FloatPicture {
  if (width <= picture.width && height <= picture.height) return shrinkFloats(picture, width, height)
  const { width: w, height: h, data: src } = picture
  const pre = new Float32Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const alpha = src[i * 4 + 3]!
    for (let c = 0; c < 3; c++) pre[i * 4 + c] = src[i * 4 + c]! * alpha
    pre[i * 4 + 3] = alpha
  }
  const cubic = (t: number) => {
    const u = Math.abs(t)
    return u < 1 ? 1.5 * u ** 3 - 2.5 * u * u + 1 : u < 2 ? -0.5 * u ** 3 + 2.5 * u * u - 4 * u + 2 : 0
  }
  const along = new Float32Array(width * h * 4)
  for (let x = 0; x < width; x++) {
    const at = ((x + 0.5) * w) / width - 0.5
    const first = Math.floor(at) - 1
    for (let y = 0; y < h; y++)
      for (let c = 0; c < 4; c++) {
        let v = 0
        for (let k = 0; k < 4; k++)
          v += cubic(at - (first + k)) * pre[(y * w + Math.max(0, Math.min(w - 1, first + k))) * 4 + c]!
        along[(y * width + x) * 4 + c] = v
      }
  }
  const data = new Float32Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const at = ((y + 0.5) * h) / height - 0.5
    const first = Math.floor(at) - 1
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      const out = [0, 0, 0, 0]
      for (let k = 0; k < 4; k++) {
        const weight = cubic(at - (first + k))
        const from = (Math.max(0, Math.min(h - 1, first + k)) * width + x) * 4
        for (let c = 0; c < 4; c++) out[c] = out[c]! + weight * along[from + c]!
      }
      const alpha = Math.max(0, Math.min(1, out[3]!))
      for (let c = 0; c < 3; c++) data[o + c] = alpha > 1e-4 ? Math.max(0, Math.min(255, out[c]! / alpha)) : 0
      data[o + 3] = alpha
    }
  }
  return { width, height, data }
}

/** A picture's RGB, 0 to 255, over a flat colour. */
function over({ width, height, data }: FloatPicture, under: readonly number[]): Float32Array {
  const rgb = new Float32Array(width * height * 3)
  for (let i = 0; i < width * height; i++) {
    const alpha = data[i * 4 + 3]!
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = data[i * 4 + c]! * alpha + under[c]! * (1 - alpha)
  }
  return rgb
}

/** An RGB picture blurred by the taps 1 2 1 each way, its edges clamped. */
function softened(rgb: Float32Array, width: number, height: number): Float32Array {
  const along = new Float32Array(rgb.length)
  const out = new Float32Array(rgb.length)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const l = y * width + Math.max(0, x - 1)
      const r = y * width + Math.min(width - 1, x + 1)
      const i = y * width + x
      for (let c = 0; c < 3; c++) along[i * 3 + c] = (rgb[l * 3 + c]! + 2 * rgb[i * 3 + c]! + rgb[r * 3 + c]!) / 4
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const u = Math.max(0, y - 1) * width + x
      const d = Math.min(height - 1, y + 1) * width + x
      const i = y * width + x
      for (let c = 0; c < 3; c++) out[i * 3 + c] = (along[u * 3 + c]! + 2 * along[i * 3 + c]! + along[d * 3 + c]!) / 4
    }
  return out
}

/** The blobs (8-connected) of a mask that hold a `core` × `core` square: the largest one's pixels and all of theirs. */
function thickBlobs(mask: Uint8Array, width: number, height: number, core = 3): { largest: number; total: number } {
  // Where a core × core square of the mask starts.
  const starts = new Uint8Array(mask.length)
  const run = new Uint16Array(mask.length)
  for (let y = 0; y < height; y++)
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x
      run[i] = mask[i] ? Math.min(core, (x + 1 < width ? run[i + 1]! : 0) + 1) : 0
    }
  const down = new Uint16Array(mask.length)
  for (let y = height - 1; y >= 0; y--)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      down[i] = run[i]! >= core ? Math.min(core, (y + 1 < height ? down[i + width]! : 0) + 1) : 0
      if (down[i]! >= core) starts[i] = 1
    }
  const done = new Uint8Array(mask.length)
  const stack: number[] = []
  let largest = 0
  let total = 0
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || done[s]) continue
    let size = 0
    let thick = false
    done[s] = 1
    stack.push(s)
    while (stack.length) {
      const i = stack.pop()!
      size++
      if (starts[i]) thick = true
      const x = i % width
      const y = (i - x) / width
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          const yy = y + dy
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue
          const j = yy * width + xx
          if (mask[j] && !done[j]) {
            done[j] = 1
            stack.push(j)
          }
        }
    }
    if (!thick) continue
    total += size
    if (size > largest) largest = size
  }
  return { largest, total }
}
