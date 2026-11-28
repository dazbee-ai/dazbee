// A patch's gradient: whether a patch's colour changes across it as a gradient's does, read from its inner pixels,
// and the linear or radial gradient fitted to them (`fit/gradient.ts`).

import { ciede2000, srgbToLab } from '../looks-same/colour.ts'
import { fitGradient, type GradientFit, type InnerPixel } from './fit/gradient.ts'
import type { FloatPicture } from './parts/float-picture.ts'
import type { Patch } from './patches.ts'

/** The settings of the reading. */
export const PATCH_GRADIENT = {
  /** A patch is tried as a gradient when its colour spreads by this much (root mean square, of 255) and it holds this many pixels; about `samples` of them are read, and the gradient must be closer than the one colour by this mean ΔE00. */
  spread: 3,
  pixels: 200,
  samples: 4000,
  gain: 0.75,
  /** And a plane and a bowl over its pixels must explain this share of its change of colour. */
  explains: 0.3,
} as const

/**
 * A patch's fill as a gradient, when its colour changes across it as a gradient's does and one is clearly closer
 * to its inner pixels than its one colour is; null when not. A patch too even or too small is not read, and
 * neither is one whose colour's change is grain: where a plane and a bowl over its pixels (the least-squares fit
 * of each channel on x, y and x² + y²) explain too little of the change.
 */
export function gradientOf(
  patch: Patch,
  picture: FloatPicture,
  patchOf: Int32Array,
  hidden?: Uint8Array,
): GradientFit | null {
  if (patch.spread < PATCH_GRADIENT.spread || patch.area < PATCH_GRADIENT.pixels) return null
  const { width, data } = picture
  const step = Math.max(1, Math.floor(Math.sqrt(patch.area / PATCH_GRADIENT.samples)))
  const pixels: InnerPixel[] = []
  for (let y = patch.box.y0 + (step >> 1); y <= patch.box.y1; y += step)
    for (let x = patch.box.x0 + (step >> 1); x <= patch.box.x1; x += step) {
      const i = y * width + x
      if (patchOf[i] !== patch.id || hidden?.[i]) continue
      // An inner pixel: its neighbours are the patch's too, so it is no mix with another colour.
      if (patchOf[i - 1] !== patch.id || patchOf[i + 1] !== patch.id) continue
      if (patchOf[i - width] !== patch.id || patchOf[i + width] !== patch.id) continue
      pixels.push({ x: x + 0.5, y: y + 0.5, rgb: [data[i * 4] ?? 0, data[i * 4 + 1] ?? 0, data[i * 4 + 2] ?? 0] })
    }
  if (pixels.length < 30 || explainedBySurface(pixels, patch) < PATCH_GRADIENT.explains) return null
  const flat = srgbToLab(...patch.rgb)
  let error = 0
  for (const p of pixels) error += ciede2000(flat, srgbToLab(...p.rgb))
  const gradient = fitGradient(pixels, 1)
  return gradient && gradient.error <= error / pixels.length - PATCH_GRADIENT.gain ? gradient : null
}

/**
 * The share of the pixels' change of colour that a plane and a bowl explain: each channel fitted by least squares
 * on 1, x, y and x² + y², with x and y from the patch's box's centre in units of its longer side.
 */
function explainedBySurface(pixels: readonly InnerPixel[], patch: Patch): number {
  const cx = (patch.box.x0 + patch.box.x1 + 1) / 2
  const cy = (patch.box.y0 + patch.box.y1 + 1) / 2
  const unit = Math.max(patch.box.x1 - patch.box.x0 + 1, patch.box.y1 - patch.box.y0 + 1)
  // The normal equations: A (4 × 4, symmetric) and one right side a channel, of four numbers each.
  const a = new Float64Array(16)
  const b = new Float64Array(12)
  const mean = [0, 0, 0]
  const basis = new Float64Array(4)
  for (const p of pixels) {
    const x = (p.x - cx) / unit
    const y = (p.y - cy) / unit
    basis[0] = 1
    basis[1] = x
    basis[2] = y
    basis[3] = x * x + y * y
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) a[r * 4 + c] = (a[r * 4 + c] ?? 0) + (basis[r] ?? 0) * (basis[c] ?? 0)
      for (let k = 0; k < 3; k++) b[k * 4 + r] = (b[k * 4 + r] ?? 0) + (basis[r] ?? 0) * (p.rgb[k] ?? 0)
    }
    for (let k = 0; k < 3; k++) mean[k] = (mean[k] ?? 0) + (p.rgb[k] ?? 0)
  }
  let total = 0
  let explained = 0
  for (let k = 0; k < 3; k++) {
    const m = (mean[k] ?? 0) / pixels.length
    const right = b.subarray(k * 4, k * 4 + 4)
    const weights = solved(a, right)
    if (!weights) return 0
    // The squares the fit explains are its weights times the right side, less the mean's.
    let fitted = 0
    for (let r = 0; r < 4; r++) fitted += (weights[r] ?? 0) * (right[r] ?? 0)
    let squares = 0
    for (const p of pixels) squares += (p.rgb[k] ?? 0) ** 2
    total += squares - pixels.length * m * m
    explained += fitted - pixels.length * m * m
  }
  return total > 1e-9 ? Math.max(0, explained / total) : 0
}

/** The solution of a 4 × 4 system by elimination with pivoting, or null when it has none. */
function solved(matrix: Float64Array, right: Float64Array): Float64Array | null {
  const m = Float64Array.from(matrix)
  const x = Float64Array.from(right)
  for (let col = 0; col < 4; col++) {
    let pivot = col
    for (let row = col + 1; row < 4; row++)
      if (Math.abs(m[row * 4 + col] ?? 0) > Math.abs(m[pivot * 4 + col] ?? 0)) pivot = row
    if (Math.abs(m[pivot * 4 + col] ?? 0) < 1e-12) return null
    if (pivot !== col) {
      for (let c = 0; c < 4; c++) [m[col * 4 + c], m[pivot * 4 + c]] = [m[pivot * 4 + c] ?? 0, m[col * 4 + c] ?? 0]
      ;[x[col], x[pivot]] = [x[pivot] ?? 0, x[col] ?? 0]
    }
    for (let row = col + 1; row < 4; row++) {
      const factor = (m[row * 4 + col] ?? 0) / (m[col * 4 + col] ?? 0)
      for (let c = col; c < 4; c++) m[row * 4 + c] = (m[row * 4 + c] ?? 0) - factor * (m[col * 4 + c] ?? 0)
      x[row] = (x[row] ?? 0) - factor * (x[col] ?? 0)
    }
  }
  for (let row = 3; row >= 0; row--) {
    for (let c = row + 1; c < 4; c++) x[row] = (x[row] ?? 0) - (m[row * 4 + c] ?? 0) * (x[c] ?? 0)
    x[row] = (x[row] ?? 0) / (m[row * 4 + row] ?? 0)
  }
  return x
}
