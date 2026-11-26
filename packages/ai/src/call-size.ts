// The size a picture call of the AI flow asks for: a frame's ratio scaled to about a megapixel within the
// picture model's limits (sides multiples of 16, its pixel range, its longest side, ratio 1:3 to 3:1). The
// picture is then placed in its frame with fit "fill".
import { AI_RATIO_LIMIT, type ImageRatio, isAiSize } from '@dazbee/schema'

/** What sizes a picture model makes: its fewest and most pixels, and its longest side. */
export interface PictureLimits {
  minPixels: number
  maxPixels: number
  maxSide: number
}

/** About how many pixels a call asks for: a 1024 px square's, the size its expected cost is measured at. */
export const CALL_PIXELS = 1024 * 1024

/**
 * Each picture model's limits, as read in its docs (docs/research/ai-flow-image-models.md). Muse Image takes
 * a size only for its ratio, through OpenAI's images API, so it is sent within GPT Image's limits.
 */
const MODEL_LIMITS: Record<string, PictureLimits> = {
  'gpt-image-2.5-sunburst': { minPixels: 655_360, maxPixels: 8_294_400, maxSide: 3840 },
  'muse-image-1.0': { minPixels: 655_360, maxPixels: 8_294_400, maxSide: 3840 },
  'seedream-5.5': { minPixels: 921_600, maxPixels: 4_624_220, maxSide: 3840 },
}

/**
 * The size an AI image's call asks for at each ratio: 1:1, 3:2 and 2:3, the sizes Meta's docs show for Muse Image
 * (dev.meta.ai, the Images API's `size`, as read on 26 Nov 2026). Muse Image takes the size for its ratio only.
 */
export const IMAGE_SIZES: Record<ImageRatio, { width: number; height: number }> = {
  square: { width: 1024, height: 1024 },
  wide: { width: 1536, height: 1024 },
  tall: { width: 1024, height: 1536 },
}

/** What every listed model takes, for a model not listed. */
const ANY_MODEL: PictureLimits = {
  minPixels: Math.max(...Object.values(MODEL_LIMITS).map((limits) => limits.minPixels)),
  maxPixels: Math.min(...Object.values(MODEL_LIMITS).map((limits) => limits.maxPixels)),
  maxSide: Math.min(...Object.values(MODEL_LIMITS).map((limits) => limits.maxSide)),
}

/** The largest term of a ratio a shape names as it is, such as 16:9. */
const SMALL_RATIO = 32

/** How far from the nearest sides the size is looked for, in steps of 16 px, before giving up. */
const MOST_STEPS = 16

/**
 * The size a picture call asks for to fill a frame of `frame`'s size: its ratio, held to 1:3 to 3:1, at about
 * `CALL_PIXELS` within `limits`, with sides multiples of 16. Of the sizes nearest that, the one closest to the
 * ratio, then to the pixel count. Throws when the limits allow none.
 */
export function callSize(
  frame: { width: number; height: number },
  limits: PictureLimits = ANY_MODEL,
): { width: number; height: number } {
  const ratio = Math.min(AI_RATIO_LIMIT, Math.max(1 / AI_RATIO_LIMIT, frame.width / frame.height))
  const pixels = Math.min(limits.maxPixels, Math.max(limits.minPixels, CALL_PIXELS))
  const height = Math.sqrt(pixels / ratio)
  for (let step = 0; step < MOST_STEPS; step++) {
    const heights = [Math.floor(height / 16) - step, Math.ceil(height / 16) + step].map((h) => h * 16)
    const fits = heights
      .map((h) => ({ width: Math.max(16, Math.round((h * ratio) / 16) * 16), height: h }))
      .filter((size) => size.height > 0 && fitsLimits(size, limits))
    const best = fits.sort((a, b) => offBy(a, ratio, pixels) - offBy(b, ratio, pixels))[0]
    if (best) return best
  }
  throw new Error(`no picture size fits ${frame.width} × ${frame.height} within the model's limits`)
}

/**
 * A frame's shape in words, as a prompt names it: "square", or its side and ratio, such as "portrait 4:5" or
 * "landscape 1.91:1".
 */
export function shapeOf({ width, height }: { width: number; height: number }): string {
  const long = Math.max(width, height)
  const short = Math.min(width, height)
  if (long / short < 1.02) return 'square'
  const side = width > height ? 'landscape' : 'portrait'
  const common = gcd(width, height)
  const [a, b] = [width / common, height / common]
  if (a <= SMALL_RATIO && b <= SMALL_RATIO) return `${side} ${a}:${b}`
  const ratio = `${Number((long / short).toFixed(2))}:1`
  return width > height ? `${side} ${ratio}` : `${side} 1:${ratio.slice(0, -2)}`
}

/** The limits of picture model `model`; for a model not listed, what every listed model takes. */
export function pictureLimits(model: string): PictureLimits {
  return MODEL_LIMITS[model] ?? ANY_MODEL
}

/** Whether `size` is within `limits` and the AI's ratios. */
function fitsLimits(size: { width: number; height: number }, limits: PictureLimits): boolean {
  const area = size.width * size.height
  return (
    area >= limits.minPixels &&
    area <= limits.maxPixels &&
    Math.max(size.width, size.height) <= limits.maxSide &&
    isAiSize(size)
  )
}

/** How far `size` is from `ratio`, then (far less) from `pixels`, as one number to sort by. */
function offBy(size: { width: number; height: number }, ratio: number, pixels: number): number {
  return Math.abs(size.width / size.height / ratio - 1) + Math.abs(size.width * size.height - pixels) / pixels / 1000
}

/** The greatest common divisor of two whole numbers. */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}
