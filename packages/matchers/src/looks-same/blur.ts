// Gaussian blurs of a picture's channels, as the looks-the-same rule and its SSIM window use them: separable, each
// pass summing its taps from the first to the last, the picture's edges clamped.

/** An RGB picture blurred by a Gaussian of σ (radius 3σ), its edges clamped. */
export function blurRgb(rgb: Float32Array, width: number, height: number, sigma: number): Float32Array {
  const taps = normalisedGaussian(Math.ceil(3 * sigma), sigma)
  return blurAlong(blurAlong(rgb, width, height, 3, taps, 'x'), width, height, 3, taps, 'y')
}

/** The taps of a Gaussian of σ from -radius to radius, summing to 1. */
export function normalisedGaussian(radius: number, sigma: number): Float64Array {
  const taps = Array.from({ length: 2 * radius + 1 }, (_, i) => Math.exp(-((i - radius) ** 2) / (2 * sigma * sigma)))
  let sum = 0
  for (const tap of taps) sum += tap
  return Float64Array.from(taps, (tap) => tap / sum)
}

/**
 * One pass of a separable blur along x or y, each of a picture's channels on its own, its edges
 * clamped. Each output value sums its taps from the first to the last.
 */
export function blurAlong(
  from: Float32Array,
  width: number,
  height: number,
  channels: number,
  taps: Float64Array,
  along: 'x' | 'y',
): Float32Array {
  const out = new Float32Array(from.length)
  const count = taps.length
  const radius = (count - 1) / 2
  const length = along === 'x' ? width : height
  // For each place along the axis, the place each tap reads, clamped to the picture.
  const reads = new Int32Array(length * count)
  for (let at = 0; at < length; at++)
    for (let t = 0; t < count; t++) reads[at * count + t] = Math.min(length - 1, Math.max(0, at + t - radius))
  // How far apart in `from` two neighbours along the axis are.
  const step = along === 'x' ? channels : width * channels
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const first = (along === 'x' ? x : y) * count
      const start = along === 'x' ? y * width * channels : x * channels
      const o = (y * width + x) * channels
      for (let c = 0; c < channels; c++) {
        const channelStart = start + c
        let v = 0
        for (let t = 0; t < count; t++) v += (taps[t] ?? 0) * (from[channelStart + (reads[first + t] ?? 0) * step] ?? 0)
        out[o + c] = v
      }
    }
  return out
}
