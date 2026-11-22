// Colours as people see them: sRGB to CIE L*a*b* under D65, and the CIEDE2000 difference between
// two Lab colours as Sharma, Wu and Dalal (2005) give it.

/** A colour in CIE L*a*b*: lightness, then the a* and b* axes. */
export type Lab = readonly [number, number, number]

const DEGREE = Math.PI / 180
const POW25_7 = 25 ** 7

/** An 8-bit sRGB colour (0–255 a channel) in CIE L*a*b*, D65 white. */
export function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const red = linear(r)
  const green = linear(g)
  const blue = linear(b)
  const x = (0.4124564 * red + 0.3575761 * green + 0.1804375 * blue) / 0.95047
  const y = 0.2126729 * red + 0.7151522 * green + 0.072175 * blue
  const z = (0.0193339 * red + 0.119192 * green + 0.9503041 * blue) / 1.08883
  return [116 * labCurve(y) - 16, 500 * (labCurve(x) - labCurve(y)), 200 * (labCurve(y) - labCurve(z))]
}

/** The CIEDE2000 difference ΔE00 between two Lab colours. */
export function ciede2000([l1, a1, b1]: Lab, [l2, a2, b2]: Lab): number {
  const meanChroma = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2
  const g = 0.5 * (1 - Math.sqrt(meanChroma ** 7 / (meanChroma ** 7 + POW25_7)))
  const a1p = (1 + g) * a1
  const a2p = (1 + g) * a2
  const c1p = Math.hypot(a1p, b1)
  const c2p = Math.hypot(a2p, b2)
  const h1p = hueDegrees(b1, a1p)
  const h2p = hueDegrees(b2, a2p)
  const chromatic = c1p * c2p !== 0

  const dLp = l2 - l1
  const dCp = c2p - c1p
  let dhp = 0
  if (chromatic) {
    dhp = h2p - h1p
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(c1p * c2p) * Math.sin((dhp / 2) * DEGREE)

  const meanL = (l1 + l2) / 2
  const meanCp = (c1p + c2p) / 2
  let meanHp = h1p + h2p
  if (chromatic) {
    if (Math.abs(h1p - h2p) <= 180) meanHp = (h1p + h2p) / 2
    else meanHp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2
  }
  const t =
    1 -
    0.17 * Math.cos((meanHp - 30) * DEGREE) +
    0.24 * Math.cos(2 * meanHp * DEGREE) +
    0.32 * Math.cos((3 * meanHp + 6) * DEGREE) -
    0.2 * Math.cos((4 * meanHp - 63) * DEGREE)
  const dTheta = 30 * Math.exp(-(((meanHp - 275) / 25) ** 2))
  const rc = 2 * Math.sqrt(meanCp ** 7 / (meanCp ** 7 + POW25_7))
  const sl = 1 + (0.015 * (meanL - 50) ** 2) / Math.sqrt(20 + (meanL - 50) ** 2)
  const sc = 1 + 0.045 * meanCp
  const sh = 1 + 0.015 * meanCp * t
  const rt = -Math.sin(2 * dTheta * DEGREE) * rc
  return Math.sqrt((dLp / sl) ** 2 + (dCp / sc) ** 2 + (dHp / sh) ** 2 + rt * (dCp / sc) * (dHp / sh))
}

/** An 8-bit sRGB channel as linear light, 0 to 1. */
function linear(channel: number): number {
  const v = channel / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

/** The CIE L*a*b* curve of a share of white. */
function labCurve(t: number): number {
  return t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116
}

/** The hue angle of (a, b) in degrees, 0 to 360; 0 for a grey. */
function hueDegrees(b: number, a: number): number {
  if (a === 0 && b === 0) return 0
  const h = Math.atan2(b, a) / DEGREE
  return h < 0 ? h + 360 : h
}
