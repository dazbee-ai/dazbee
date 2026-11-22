// The colour guard of the text rule: how far apart the colours of a piece's ink and its rebuild's
// are, read on the ink both share, so a rebuild in the right letters but the wrong colour is caught.

import type { Pixels } from '@dazbee/renderer'

import { ciede2000, srgbToLab } from './colour.ts'

/** Below this many pixels of shared ink 1 px in, the guard reads all the shared ink instead. */
const MIN_CORE = 20

/**
 * ΔE00 between the median colours of the piece's ink and the rebuild's, read on the same pixels: the
 * ink both share 1 px in (pixels whose 3×3 neighbourhood is ink in both), or all the ink both share
 * when that holds fewer than 20 pixels. 0 when they share no ink. Both pictures are the same size;
 * `pieceInk` (0 to 1 a pixel) gives the piece's ink when its alpha covers everything, as a flat crop's
 * does.
 */
export function inkColourDistance(piece: Pixels, rebuild: Pixels, pieceInk?: Float32Array): number {
  const { width, height } = piece
  const shared = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const pieceHas = pieceInk ? (pieceInk[i] ?? 0) > 0.5 : (piece.pixels[i * 4 + 3] ?? 0) > 127
    shared[i] = pieceHas && (rebuild.pixels[i * 4 + 3] ?? 0) > 127 ? 1 : 0
  }
  const core = oneIn(shared, width, height)
  const read = core.count >= MIN_CORE ? core.mask : shared
  const a = medianColour(piece, read)
  const b = medianColour(rebuild, read)
  if (!a || !b) return 0
  return ciede2000(srgbToLab(a[0], a[1], a[2]), srgbToLab(b[0], b[1], b[2]))
}

/** The pixels of a mask whose 3×3 neighbourhood is all in it, and how many there are. */
function oneIn(mask: Uint8Array, width: number, height: number): { mask: Uint8Array; count: number } {
  const inner = new Uint8Array(width * height)
  let count = 0
  for (let y = 1; y < height - 1; y++)
    for (let x = 1; x < width - 1; x++) {
      let all = 1
      for (let dy = -1; dy <= 1 && all; dy++)
        for (let dx = -1; dx <= 1 && all; dx++) all = mask[(y + dy) * width + x + dx] ?? 0
      if (all) {
        inner[y * width + x] = 1
        count++
      }
    }
  return { mask: inner, count }
}

/**
 * Each channel's median over the pixels a mask holds (the upper one of an even count), or null when
 * it holds none.
 */
function medianColour(picture: Pixels, mask: Uint8Array): [number, number, number] | null {
  // Each channel's counts of its 256 values, one channel after another.
  const counts = new Uint32Array(3 * 256)
  let n = 0
  for (let i = 0; i < mask.length; i++)
    if (mask[i]) {
      n++
      for (let c = 0; c < 3; c++) {
        const at = c * 256 + (picture.pixels[i * 4 + c] ?? 0)
        counts[at] = (counts[at] ?? 0) + 1
      }
    }
  if (n === 0) return null
  const rank = Math.floor(n / 2)
  const median = (c: number) => {
    let below = 0
    for (let v = 0; v < 256; v++) {
      below += counts[c * 256 + v] ?? 0
      if (below > rank) return v
    }
    return 255
  }
  return [median(0), median(1), median(2)]
}
