// The shape matcher's colours: CIE L*a*b* back to sRGB, and the #RRGGBBAA strings a design stores.

import type { Lab } from '../../looks-same/colour.ts'

/** An sRGB colour, 0 to 255 a channel, not rounded. */
export type SrgbFloat = [number, number, number]

/** A Lab colour (D65 white) in sRGB, each channel clamped to 0–255 and not rounded. */
export function labToSrgb([l, a, b]: Lab): SrgbFloat {
  const fy = (l + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200
  const x = labCurveInverse(fx) * 0.95047
  const y = labCurveInverse(fy)
  const z = labCurveInverse(fz) * 1.08883
  const red = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z
  const green = -0.969266 * x + 1.8760108 * y + 0.041556 * z
  const blue = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z
  return [encoded(red), encoded(green), encoded(blue)]
}

/** A colour as #RRGGBBAA in capitals, each channel rounded and clamped; alpha 0 to 1. */
export function hexColour(red: number, green: number, blue: number, alpha = 1): string {
  return (
    '#' +
    [red, green, blue, alpha * 255]
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
      .toUpperCase()
  )
}

/** The red, green and blue of a #RRGGBB or #RRGGBBAA colour, 0 to 255. */
export function hexRgb(hex: string): [number, number, number] {
  const channel = (i: number) => parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16)
  return [channel(0), channel(1), channel(2)]
}

/** The inverse of the CIE L*a*b* curve. */
function labCurveInverse(t: number): number {
  return t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27)
}

/** Linear light as an sRGB channel, 0 to 255, clamped. */
function encoded(channel: number): number {
  const v = channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055
  return Math.max(0, Math.min(255, v * 255))
}
