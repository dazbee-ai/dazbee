// The "looks the same" rule for the text and shape matchers, fitted to the owner's blind judgements
// (rule.md). One computation for both halves: the block and its rebuild, drawn at the block's size,
// are shrunk alike to at most 512 px a side, put over the background the block is seen on, and
// blurred by a Gaussian of σ 2 px; three numbers are read from that, and each half has its own bars.
// Pure functions over RGBA bytes: no imports.

export interface Rgba {
  width: number
  height: number
  /** 8-bit RGBA, straight (not premultiplied) alpha. */
  data: Uint8Array
}

export type Kind = 'text' | 'shape'

export const RULE = {
  /** Both pictures are shrunk alike (box filter) so neither side is over this. */
  maxSide: 512,
  /** σ in pixels of the Gaussian blur put on both pictures before comparing. */
  blur: 2,
  /** What a see-through block is seen over when no background is given: the judging page's checker, averaged. */
  seeThrough: [180, 180, 180] as readonly number[],
  /** A pixel is "far" when its ΔE00 is over this. */
  farDeltaE: 10,
  /** Text looks the same when SSIM ≥ ssim and no more than inkMissed of the block's ink is left uncovered. */
  text: { ssim: 0.46, inkMissed: 0.12 },
  /** A shape block looks the same when no more than far of its foreground is far. */
  shape: { far: 0.015 },
}

export interface Metrics {
  /** Mean SSIM of the luminance over the whole block (Wang et al. 2004). */
  ssim: number
  /** Share of the foreground (pixels either picture covers) apart by a ΔE00 over RULE.farDeltaE. */
  far: number
  /** Share of the block's foreground the rebuild leaves uncovered, with 1 px of give. */
  inkMissed: number
}

export interface Options {
  /**
   * The backgrounds the block is seen on, RGB 0–255; the worse value of each number counts. Text: the
   * block's estimated background. Shapes: leave out for RULE.seeThrough.
   */
  backgrounds?: readonly (readonly number[])[]
  /** The block's foreground, 0 to 1 a pixel, when its alpha covers everything (a flat crop). */
  blockInk?: Float32Array
}

/** Whether the rebuild looks the same as the block, with the numbers it was decided on. */
export function judge(kind: Kind, block: Rgba, drawn: Rgba, opts: Options = {}): { same: boolean; metrics: Metrics } {
  const metrics = measure(block, drawn, opts)
  return { same: looksSame(kind, metrics), metrics }
}

/** The decision from the three numbers. */
export function looksSame(kind: Kind, m: Metrics): boolean {
  return kind === 'text' ? m.ssim >= RULE.text.ssim && m.inkMissed <= RULE.text.inkMissed : m.far <= RULE.shape.far
}

/** The three numbers, the worse over the backgrounds. Both pictures the same size. */
export function measure(block: Rgba, drawn: Rgba, opts: Options = {}): Metrics {
  if (block.width !== drawn.width || block.height !== drawn.height) throw new Error('pictures differ in size')
  const k = Math.min(1, RULE.maxSide / Math.max(block.width, block.height))
  const w = Math.max(1, Math.round(block.width * k))
  const h = Math.max(1, Math.round(block.height * k))
  const n = w * h
  const a = shrink(block, w, h)
  const b = shrink(drawn, w, h)
  const ink = opts.blockInk ? shrinkMask(opts.blockInk, block.width, block.height, w, h) : null

  const blockFg = new Uint8Array(n)
  const drawnFg = new Uint8Array(n)
  let fgCount = 0
  for (let i = 0; i < n; i++) {
    blockFg[i] = (ink ? ink[i]! > 0.5 : a.data[i * 4 + 3]! > 127) ? 1 : 0
    drawnFg[i] = b.data[i * 4 + 3]! > 127 ? 1 : 0
    if (blockFg[i] || drawnFg[i]) fgCount++
  }
  const inkMissed = missedShare(blockFg, drawnFg, w, h)

  let worst: Metrics | null = null
  for (const bg of opts.backgrounds ?? [RULE.seeThrough]) {
    const ca = blurRgb(over(a, bg), w, h, RULE.blur)
    const cb = blurRgb(over(b, bg), w, h, RULE.blur)
    const map = ssimMap(luma(ca, n), luma(cb, n), w, h)
    let ssim = 0
    for (let i = 0; i < n; i++) ssim += map[i]!
    ssim /= n
    const memo = new Map<number, number>()
    let far = 0
    for (let i = 0; i < n; i++) if ((blockFg[i] || drawnFg[i]) && pairDeltaE(ca, cb, i, memo) > RULE.farDeltaE) far++
    const m = { ssim, far: fgCount ? far / fgCount : 0, inkMissed }
    worst = worst ? { ssim: Math.min(worst.ssim, m.ssim), far: Math.max(worst.far, m.far), inkMissed } : m
  }
  return worst!
}

// ---- Pixels ----

/** Box-filter shrink in premultiplied colour, alpha kept. */
function shrink(img: Rgba, w: number, h: number): Rgba {
  if (w === img.width && h === img.height) return img
  const out = new Uint8Array(w * h * 4)
  const sx = img.width / w
  const sy = img.height / h
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const x0 = x * sx
      const x1 = (x + 1) * sx
      const y0 = y * sy
      const y1 = (y + 1) * sy
      let r = 0
      let g = 0
      let bl = 0
      let al = 0
      let wt = 0
      for (let yy = Math.floor(y0); yy < Math.ceil(y1); yy++)
        for (let xx = Math.floor(x0); xx < Math.ceil(x1); xx++) {
          const f = (Math.min(x1, xx + 1) - Math.max(x0, xx)) * (Math.min(y1, yy + 1) - Math.max(y0, yy))
          const i = (yy * img.width + xx) * 4
          const pa = img.data[i + 3]! / 255
          r += img.data[i]! * pa * f
          g += img.data[i + 1]! * pa * f
          bl += img.data[i + 2]! * pa * f
          al += pa * f
          wt += f
        }
      const o = (y * w + x) * 4
      out[o] = al > 0 ? Math.round(r / al) : 0
      out[o + 1] = al > 0 ? Math.round(g / al) : 0
      out[o + 2] = al > 0 ? Math.round(bl / al) : 0
      out[o + 3] = Math.round((al / wt) * 255)
    }
  return { width: w, height: h, data: out }
}

/** Box-filter shrink of a 0–1 mask. */
function shrinkMask(mask: Float32Array, w0: number, h0: number, w: number, h: number): Float32Array {
  if (w === w0 && h === h0) return mask
  const out = new Float32Array(w * h)
  const sx = w0 / w
  const sy = h0 / h
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      let wt = 0
      for (let yy = Math.floor(y * sy); yy < Math.ceil((y + 1) * sy); yy++)
        for (let xx = Math.floor(x * sx); xx < Math.ceil((x + 1) * sx); xx++) {
          const f =
            (Math.min((x + 1) * sx, xx + 1) - Math.max(x * sx, xx)) *
            (Math.min((y + 1) * sy, yy + 1) - Math.max(y * sy, yy))
          s += mask[yy * w0 + xx]! * f
          wt += f
        }
      out[y * w + x] = s / wt
    }
  return out
}

/** RGB 0–255 of a picture over a flat background. */
function over(img: Rgba, bg: readonly number[]): Float32Array {
  const n = img.width * img.height
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const al = img.data[i * 4 + 3]! / 255
    for (let c = 0; c < 3; c++) out[i * 3 + c] = img.data[i * 4 + c]! * al + bg[c]! * (1 - al)
  }
  return out
}

/** A Gaussian blur of an RGB picture (radius 3σ), edges clamped. */
function blurRgb(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  if (sigma <= 0) return src
  const r = Math.ceil(3 * sigma)
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)))
  const s = k.reduce((x, y) => x + y, 0)
  const kn = k.map((v) => v / s)
  const pass = (from: Float32Array, dx: number, dy: number) => {
    const out = new Float32Array(from.length)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        for (let c = 0; c < 3; c++) {
          let v = 0
          for (let t = -r; t <= r; t++) {
            const xx = Math.min(w - 1, Math.max(0, x + t * dx))
            const yy = Math.min(h - 1, Math.max(0, y + t * dy))
            v += kn[t + r]! * from[(yy * w + xx) * 3 + c]!
          }
          out[(y * w + x) * 3 + c] = v
        }
    return out
  }
  return pass(pass(src, 1, 0), 0, 1)
}

/** Rec. 709 luminance of gamma-encoded RGB. */
function luma(rgb: Float32Array, n: number): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = 0.2126 * rgb[i * 3]! + 0.7152 * rgb[i * 3 + 1]! + 0.0722 * rgb[i * 3 + 2]!
  return out
}

/** A mask grown by `r` pixels (a square). */
function dilate(mask: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const tmp = new Uint8Array(w * h)
  const out = new Uint8Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let t = Math.max(0, x - r); t <= Math.min(w - 1, x + r) && !v; t++) v = mask[y * w + t]!
      tmp[y * w + x] = v
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let v = 0
      for (let t = Math.max(0, y - r); t <= Math.min(h - 1, y + r) && !v; t++) v = tmp[t * w + x]!
      out[y * w + x] = v
    }
  return out
}

/** Share of the block's foreground with no rebuilt foreground within 1 px. */
function missedShare(blockFg: Uint8Array, drawnFg: Uint8Array, w: number, h: number): number {
  const near = dilate(drawnFg, w, h, 1)
  let ink = 0
  let missed = 0
  for (let i = 0; i < w * h; i++)
    if (blockFg[i]) {
      ink++
      if (!near[i]) missed++
    }
  return ink ? missed / ink : 0
}

// ---- SSIM ----

const SSIM_KERNEL = (() => {
  const k = Array.from({ length: 11 }, (_, i) => Math.exp(-((i - 5) ** 2) / (2 * 1.5 * 1.5)))
  const s = k.reduce((x, y) => x + y, 0)
  return k.map((v) => v / s)
})()

/** An 11-tap Gaussian (σ 1.5) blur of one channel, edges clamped. */
function gauss(src: Float32Array, w: number, h: number): Float32Array {
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let t = -5; t <= 5; t++) s += SSIM_KERNEL[t + 5]! * src[y * w + Math.min(w - 1, Math.max(0, x + t))]!
      tmp[y * w + x] = s
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let s = 0
      for (let t = -5; t <= 5; t++) s += SSIM_KERNEL[t + 5]! * tmp[Math.min(h - 1, Math.max(0, y + t)) * w + x]!
      out[y * w + x] = s
    }
  return out
}

/** The SSIM map: 11×11 Gaussian window σ 1.5, K1 0.01, K2 0.03, range 255. */
function ssimMap(x: Float32Array, y: Float32Array, w: number, h: number): Float32Array {
  const n = w * h
  const mx = gauss(x, w, h)
  const my = gauss(y, w, h)
  const prod = new Float32Array(n)
  const moment = (f: (i: number) => number) => {
    for (let i = 0; i < n; i++) prod[i] = f(i)
    return gauss(prod, w, h)
  }
  const sxx = moment((i) => x[i]! * x[i]!)
  const syy = moment((i) => y[i]! * y[i]!)
  const sxy = moment((i) => x[i]! * y[i]!)
  const c1 = (0.01 * 255) ** 2
  const c2 = (0.03 * 255) ** 2
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const ux = mx[i]!
    const uy = my[i]!
    out[i] =
      ((2 * ux * uy + c1) * (2 * (sxy[i]! - ux * uy) + c2)) /
      ((ux * ux + uy * uy + c1) * (sxx[i]! - ux * ux + syy[i]! - uy * uy + c2))
  }
  return out
}

// ---- Colour ----

/** ΔE00 of pixel i of two RGB pictures, colours rounded to 8 bits for the memo. */
function pairDeltaE(a: Float32Array, b: Float32Array, i: number, memo: Map<number, number>): number {
  const k1 = (Math.round(a[i * 3]!) << 16) | (Math.round(a[i * 3 + 1]!) << 8) | Math.round(a[i * 3 + 2]!)
  const k2 = (Math.round(b[i * 3]!) << 16) | (Math.round(b[i * 3 + 1]!) << 8) | Math.round(b[i * 3 + 2]!)
  if (k1 === k2) return 0
  const key = k1 * 16777216 + k2
  let d = memo.get(key)
  if (d === undefined) {
    if (memo.size > 1_000_000) memo.clear()
    d = ciede2000(lab(k1 >> 16, (k1 >> 8) & 255, k1 & 255), lab(k2 >> 16, (k2 >> 8) & 255, k2 & 255))
    memo.set(key, d)
  }
  return d
}

/** sRGB 0–255 to CIE L*a*b* (D65). */
function lab(r: number, g: number, b: number): [number, number, number] {
  const lin = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const R = lin(r)
  const G = lin(g)
  const B = lin(b)
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / 0.95047
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / 1.08883
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

/** CIEDE2000 colour difference (Sharma, Wu and Dalal 2005). */
function ciede2000(p: readonly number[], q: readonly number[]): number {
  const [L1, a1, b1] = p as [number, number, number]
  const [L2, a2, b2] = q as [number, number, number]
  const rad = Math.PI / 180
  const Cm = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)))
  const a1p = (1 + G) * a1
  const a2p = (1 + G) * a2
  const C1p = Math.hypot(a1p, b1)
  const C2p = Math.hypot(a2p, b2)
  const hue = (bb: number, aa: number) => {
    if (aa === 0 && bb === 0) return 0
    const hh = Math.atan2(bb, aa) / rad
    return hh < 0 ? hh + 360 : hh
  }
  const h1p = hue(b1, a1p)
  const h2p = hue(b2, a2p)
  const dLp = L2 - L1
  const dCp = C2p - C1p
  let dhp = 0
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p
    if (dhp > 180) dhp -= 360
    else if (dhp < -180) dhp += 360
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad)
  const Lmp = (L1 + L2) / 2
  const Cmp = (C1p + C2p) / 2
  let hmp = h1p + h2p
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) <= 180) hmp = (h1p + h2p) / 2
    else hmp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2
  }
  const T =
    1 -
    0.17 * Math.cos((hmp - 30) * rad) +
    0.24 * Math.cos(2 * hmp * rad) +
    0.32 * Math.cos((3 * hmp + 6) * rad) -
    0.2 * Math.cos((4 * hmp - 63) * rad)
  const dTheta = 30 * Math.exp(-(((hmp - 275) / 25) ** 2))
  const Rc = 2 * Math.sqrt(Cmp ** 7 / (Cmp ** 7 + 25 ** 7))
  const Sl = 1 + (0.015 * (Lmp - 50) ** 2) / Math.sqrt(20 + (Lmp - 50) ** 2)
  const Sc = 1 + 0.045 * Cmp
  const Sh = 1 + 0.015 * Cmp * T
  const Rt = -Math.sin(2 * dTheta * rad) * Rc
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh))
}
