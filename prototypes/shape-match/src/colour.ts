// PROTOTYPE. Colour: sRGB to CIELAB (D65), CIEDE2000 as Sharma, Wu and Dalal (2005) state it, and
// the #RRGGBBAA strings the design stores.

export type Lab = [number, number, number]
export type Rgb = [number, number, number]

const LINEAR = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

const toLinear = (v: number) => {
  const i = Math.max(0, Math.min(255, v))
  const lo = Math.floor(i)
  const t = i - lo
  return lo >= 255 ? LINEAR[255]! : LINEAR[lo]! * (1 - t) + LINEAR[lo + 1]! * t
}

const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)

export function rgbToLab(r: number, g: number, b: number): Lab {
  const R = toLinear(r)
  const G = toLinear(g)
  const B = toLinear(b)
  const X = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047
  const Y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B
  const Z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883
  const fx = f(X)
  const fy = f(Y)
  const fz = f(Z)
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}

export function labToRgb([L, a, b]: Lab): Rgb {
  const fy = (L + 16) / 116
  const fx = fy + a / 500
  const fz = fy - b / 200
  const inv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27))
  const X = inv(fx) * 0.95047
  const Y = inv(fy)
  const Z = inv(fz) * 1.08883
  const R = 3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z
  const G = -0.969266 * X + 1.8760108 * Y + 0.041556 * Z
  const B = 0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z
  const enc = (c: number) => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
    return Math.max(0, Math.min(255, v * 255))
  }
  return [enc(R), enc(G), enc(B)]
}

/** CIEDE2000 colour difference (kL = kC = kH = 1). */
export function deltaE00(l1: Lab, l2: Lab): number {
  const [L1, a1, b1] = l1
  const [L2, a2, b2] = l2
  const C1 = Math.hypot(a1, b1)
  const C2 = Math.hypot(a2, b2)
  const Cm = (C1 + C2) / 2
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)))
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const h = (b: number, a: number) => {
    if (a === 0 && b === 0) return 0
    const d = (Math.atan2(b, a) * 180) / Math.PI
    return d < 0 ? d + 360 : d
  }
  const h1p = h(b1, a1p)
  const h2p = h(b2, a2p)
  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(((dhp / 2) * Math.PI) / 180)
  const Lpm = (L1 + L2) / 2
  const Cpm = (C1p + C2p) / 2
  let hpm = h1p + h2p
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hpm = (h1p + h2p) / 2
    else hpm = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2
  }
  const rad = Math.PI / 180
  const T =
    1 -
    0.17 * Math.cos((hpm - 30) * rad) +
    0.24 * Math.cos(2 * hpm * rad) +
    0.32 * Math.cos((3 * hpm + 6) * rad) -
    0.2 * Math.cos((4 * hpm - 63) * rad)
  const dTheta = 30 * Math.exp(-(((hpm - 275) / 25) ** 2))
  const Rc = 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7))
  const Sl = 1 + (0.015 * (Lpm - 50) ** 2) / Math.sqrt(20 + (Lpm - 50) ** 2)
  const Sc = 1 + 0.045 * Cpm
  const Sh = 1 + 0.015 * Cpm * T
  const Rt = -Math.sin(2 * dTheta * rad) * Rc
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))
}

export const hex = (r: number, g: number, b: number, a = 1) =>
  '#' +
  [r, g, b, a * 255]
    .map((v) =>
      Math.max(0, Math.min(255, Math.round(v)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')
    .toUpperCase()

export function parseHex(h: string): { rgb: Rgb; a: number } {
  const n = (i: number) => parseInt(h.slice(1 + i * 2, 3 + i * 2), 16)
  return { rgb: [n(0), n(1), n(2)], a: h.length >= 9 ? n(3) / 255 : 1 }
}
