// The shape matcher's colours: an sRGB colour before rounding, and the #RRGGBBAA strings a design stores.

/** An sRGB colour, 0 to 255 a channel, not rounded. */
export type SrgbFloat = [number, number, number]

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
