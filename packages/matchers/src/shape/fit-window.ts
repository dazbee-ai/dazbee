// Fitting windows: the part of a whole-piece coverage mask round one part's box, in fitting pixels,
// with where it lies in the piece, which shapes are fitted and judged against.

import type { PixelBox } from './colour-split.ts'

/** A coverage mask at the fitting scale, `scale` fitting pixels to a piece pixel, around one part. */
export interface FitWindow {
  width: number
  height: number
  mask: Float32Array
  scale: number
  /** The window's size and offset in piece pixels: the mask is this part of the piece. */
  pieceWidth: number
  pieceHeight: number
  offsetX: number
  offsetY: number
  /** Pixels the parts over this one cover: its shape may reach under them at no cost. */
  free?: Float32Array
}

/** The window of a whole-piece mask round a box (fitting pixels), padded, with what lies above it when given. */
export function windowOf(
  full: Float32Array,
  fullWidth: number,
  fullHeight: number,
  scale: number,
  box: PixelBox,
  pad: number,
  freeFull?: Float32Array,
): FitWindow {
  const x0 = Math.max(0, box.x0 - pad)
  const y0 = Math.max(0, box.y0 - pad)
  const x1 = Math.min(fullWidth - 1, box.x1 + pad)
  const y1 = Math.min(fullHeight - 1, box.y1 + pad)
  const width = x1 - x0 + 1
  const height = y1 - y0 + 1
  const cut = (from: Float32Array) => {
    const out = new Float32Array(width * height)
    for (let y = 0; y < height; y++)
      out.set(from.subarray((y + y0) * fullWidth + x0, (y + y0) * fullWidth + x0 + width), y * width)
    return out
  }
  return {
    width,
    height,
    mask: cut(full),
    scale,
    pieceWidth: width / scale,
    pieceHeight: height / scale,
    offsetX: x0 / scale,
    offsetY: y0 / scale,
    ...(freeFull ? { free: cut(freeFull) } : {}),
  }
}
