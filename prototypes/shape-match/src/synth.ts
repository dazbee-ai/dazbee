// PROTOTYPE. Makes the synthetic set: ~300 blocks drawn by Dazbee's renderer from known layers
// (the ground truth), plus photo-like blocks that must stay pictures, each degraded the way AI
// pictures are (resampled, JPEG, blurred, noisy, wobbly edges, or all at once). A third of them,
// every id divisible by 3, is the development part; the rest is held out for the results.
// Writes data/synth/<id>.png and data/synth/index.json.
import { mkdirSync, writeFileSync } from 'node:fs'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { deltaE00, hex, type Lab, labToRgb, parseHex, rgbToLab } from './colour.ts'
import { drawLayers, type OutLayer } from './draw.ts'
import type { BrandColour } from './match.ts'
import { decode, encode, type Img, makeImg, resize, sampleInto, savePng } from './pixels.ts'

export const FAMILIES = [
  'rect',
  'rounded',
  'pill',
  'circle',
  'ellipse',
  'line',
  'star',
  'starburst',
  'polygon',
  'ring',
  'outline',
  'badge',
  'shadowed',
  'ribbon',
  'icon',
  'linear',
  'radial',
  'backdrop',
  'overlap',
  'rotated',
  'translucent',
  'dashed',
  'photo',
  'render',
] as const
export type Family = (typeof FAMILIES)[number]
export const DEGRADATIONS = ['clean', 'resample', 'jpeg', 'blur', 'noise', 'wobble', 'ai'] as const
export type Degradation = (typeof DEGRADATIONS)[number]

export interface SynthBlock {
  id: number
  family: Family
  degradation: Degradation
  /** brand: fills are kit colours; near: a fill sits 7-12 ΔE from a kit colour and must not snap; none: kit far away. */
  brand: 'brand' | 'near' | 'none'
  kit: BrandColour[]
  truth: 'shapes' | 'picture'
  /** Ground-truth layers in the block's pixels (empty for pictures). */
  layers: OutLayer[]
  /** The kit token each ground-truth layer's fill is, where it is a brand colour. */
  tokens: (string | null)[]
  w: number
  h: number
  dev: boolean
}

const OUT = process.env.SYNTH_DIR ?? 'data/synth'
const COUNT_PER_FAMILY = 13

let seed = Number(process.env.SYNTH_SEED ?? 20261121)
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
const between = (a: number, b: number) => a + (b - a) * rand()
const int = (a: number, b: number) => Math.floor(between(a, b + 1))
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!

function randomColour(): [number, number, number] {
  const L = between(20, 92)
  const C = between(10, 75)
  const hue = between(0, Math.PI * 2)
  return labToRgb([L, C * Math.cos(hue), C * Math.sin(hue)])
}

function farFrom(others: [number, number, number][], min: number): [number, number, number] {
  for (let i = 0; i < 200; i++) {
    const c = randomColour()
    const lab = rgbToLab(...c)
    if (others.every((o) => deltaE00(lab, rgbToLab(...o)) >= min)) return c
  }
  return randomColour()
}

/** A colour ΔE00 between lo and hi from c. */
function nearTo(c: [number, number, number], lo: number, hi: number): [number, number, number] {
  const lab = rgbToLab(...c)
  for (let i = 0; i < 2000; i++) {
    const step = between(3, 16)
    const dir = [between(-1, 1), between(-1, 1), between(-1, 1)]
    const len = Math.hypot(dir[0]!, dir[1]!, dir[2]!) || 1
    const cand: Lab = [
      lab[0] + (dir[0]! / len) * step,
      lab[1] + (dir[1]! / len) * step,
      lab[2] + (dir[2]! / len) * step,
    ]
    const rgb = labToRgb(cand)
    const d = deltaE00(rgbToLab(...rgb), lab)
    if (d >= lo && d <= hi) return rgb
  }
  return c
}

const TOKENS = ['primary', 'secondary', 'accent', 'background', 'text']

function makeKit(): BrandColour[] {
  const cols: [number, number, number][] = []
  for (let i = 0; i < 5; i++) cols.push(farFrom(cols, 20))
  return cols.map((c, i) => ({ token: TOKENS[i]!, value: hex(...c) }))
}

const solidOf = (c: [number, number, number]) => ({ type: 'solid', color: hex(...c) })

function graphic(name: string, props: Record<string, unknown>): OutLayer {
  return { type: 'graphic', name, props: { rotation: 0, fills: [], strokes: [], ...props } }
}

/** The layers of one family, sized about w×h, laid out inside a margin; colours from `colour()`. */
function layersOf(family: Family, colour: () => [number, number, number]) {
  const m = int(4, 10)
  const out: OutLayer[] = []
  let w = int(60, 360)
  let h = int(40, 200)
  const box = () => ({ x: m, y: m, width: w, height: h })
  switch (family) {
    case 'rect':
      out.push(graphic('rect', { ...box(), shape: { kind: 'rect', cornerRadius: 0 }, fills: [solidOf(colour())] }))
      break
    case 'rounded':
      out.push(
        graphic('rounded', {
          ...box(),
          shape: { kind: 'rect', cornerRadius: between(4, Math.min(w, h) / 3) },
          fills: [solidOf(colour())],
        }),
      )
      break
    case 'pill':
      h = int(30, 110)
      w = int(Math.round(h * 2), Math.round(h * 5))
      out.push(graphic('pill', { ...box(), shape: { kind: 'rect', cornerRadius: h / 2 }, fills: [solidOf(colour())] }))
      break
    case 'circle':
      w = h = int(40, 260)
      out.push(graphic('circle', { ...box(), shape: { kind: 'ellipse' }, fills: [solidOf(colour())] }))
      break
    case 'ellipse':
      out.push(graphic('ellipse', { ...box(), shape: { kind: 'ellipse' }, fills: [solidOf(colour())] }))
      break
    case 'line': {
      w = int(60, 400)
      h = between(1.5, 6)
      out.push(
        graphic('line', {
          ...box(),
          shape: { kind: 'line' },
          strokes: [{ paint: solidOf(colour()), width: h, align: 'center', cap: 'butt' }],
        }),
      )
      break
    }
    case 'star':
      w = h = int(60, 260)
      out.push(
        graphic('star', {
          ...box(),
          shape: { kind: 'star', points: 5, innerRadius: between(0.38, 0.55), cornerRadius: 0 },
          fills: [solidOf(colour())],
        }),
      )
      break
    case 'starburst':
      w = h = int(80, 260)
      out.push(
        graphic('starburst', {
          ...box(),
          shape: { kind: 'star', points: int(12, 24), innerRadius: between(0.78, 0.9), cornerRadius: 0 },
          fills: [solidOf(colour())],
        }),
      )
      break
    case 'polygon':
      w = h = int(60, 240)
      out.push(
        graphic('polygon', {
          ...box(),
          shape: { kind: 'polygon', sides: pick([3, 6, 8]), cornerRadius: 0 },
          fills: [solidOf(colour())],
        }),
      )
      break
    case 'ring':
      w = h = int(60, 240)
      out.push(
        graphic('ring', {
          ...box(),
          shape: { kind: 'ellipse' },
          strokes: [{ paint: solidOf(colour()), width: between(2, w / 10), align: 'inside' }],
        }),
      )
      break
    case 'outline':
      h = int(36, 100)
      w = int(h * 2, h * 5)
      out.push(
        graphic('outline', {
          ...box(),
          shape: { kind: 'rect', cornerRadius: between(0, h / 2) },
          strokes: [{ paint: solidOf(colour()), width: between(1.5, 5), align: 'inside' }],
        }),
      )
      break
    case 'badge': {
      w = h = int(90, 260)
      const c1 = colour()
      const inset = between(0.08, 0.14) * w
      out.push(graphic('disc', { ...box(), shape: { kind: 'ellipse' }, fills: [solidOf(c1)] }))
      out.push(
        graphic('inner ring', {
          x: m + inset,
          y: m + inset,
          width: w - 2 * inset,
          height: h - 2 * inset,
          shape: { kind: 'ellipse' },
          strokes: [{ paint: solidOf(colour()), width: between(2, 5), align: 'inside' }],
        }),
      )
      break
    }
    case 'shadowed': {
      h = int(40, 110)
      w = int(h * 2, h * 4)
      const blur = between(6, 18)
      const dy = between(3, 10)
      const pad = Math.ceil(blur * 1.5 + dy)
      out.push(
        graphic('button', {
          x: pad,
          y: pad,
          width: w,
          height: h,
          shape: { kind: 'rect', cornerRadius: between(4, h / 2) },
          fills: [solidOf(colour())],
          effects: [
            { type: 'dropShadow', x: between(-3, 3), y: dy, blur, spread: 0, color: hex(0, 0, 0, between(0.25, 0.5)) },
          ],
        }),
      )
      return { layers: out, w: w + 2 * pad, h: h + 2 * pad }
    }
    case 'ribbon': {
      h = int(40, 100)
      w = int(h * 3, h * 6)
      const n = h * between(0.25, 0.45)
      const d = `M0 0L${w} 0L${w - n} ${h / 2}L${w} ${h}L0 ${h}L${n} ${h / 2}Z`
      out.push(
        graphic('ribbon', {
          ...box(),
          shape: { kind: 'path', d, fillRule: 'nonzero', drawnIn: { width: w, height: h } },
          fills: [solidOf(colour())],
        }),
      )
      break
    }
    case 'icon': {
      w = h = int(40, 160)
      const icons = [
        // heart
        'M50 88C20 65 4 48 4 30C4 15 15 5 28 5C38 5 45 11 50 19C55 11 62 5 72 5C85 5 96 15 96 30C96 48 80 65 50 88Z',
        // arrow
        'M5 40L60 40L60 15L95 50L60 85L60 60L5 60Z',
        // check
        'M8 52L22 38L40 56L80 14L94 28L40 84Z',
        // speech bubble with a hole-free tail
        'M50 8C76 8 95 23 95 43C95 63 76 78 50 78C44 78 38 77 33 75L12 92L18 68C10 61 5 52 5 43C5 23 24 8 50 8Z',
        // ring-with-hole (evenodd)
        'M50 5A45 45 0 1 1 49.99 5ZM50 30A20 20 0 1 0 50.01 30Z',
      ]
      const i = int(0, icons.length - 1)
      out.push(
        graphic('icon', {
          ...box(),
          shape: {
            kind: 'path',
            d: icons[i]!,
            fillRule: i === 4 ? 'evenodd' : 'nonzero',
            drawnIn: { width: 100, height: 100 },
          },
          fills: [solidOf(colour())],
        }),
      )
      break
    }
    case 'linear': {
      const a = colour()
      const b = farFrom([a], 15)
      const ang = pick([0, 45, 90, between(0, 180)]) * (Math.PI / 180)
      out.push(
        graphic('gradient', {
          ...box(),
          shape: { kind: 'rect', cornerRadius: between(0, Math.min(w, h) / 4) },
          fills: [
            {
              type: 'linear',
              from: { x: 0.5 - Math.cos(ang) / 2, y: 0.5 - Math.sin(ang) / 2 },
              to: { x: 0.5 + Math.cos(ang) / 2, y: 0.5 + Math.sin(ang) / 2 },
              stops: [
                { offset: 0, color: hex(...a) },
                { offset: 1, color: hex(...b) },
              ],
            },
          ],
        }),
      )
      break
    }
    case 'radial': {
      w = h = int(80, 260)
      const a = colour()
      const b = farFrom([a], 15)
      out.push(
        graphic('radial', {
          ...box(),
          shape: { kind: pick(['ellipse', 'rect']), cornerRadius: 0 },
          fills: [
            {
              type: 'radial',
              center: { x: between(0.35, 0.65), y: between(0.35, 0.65) },
              radius: between(0.5, 0.8),
              stops: [
                { offset: 0, color: hex(...a) },
                { offset: 1, color: hex(...b) },
              ],
            },
          ],
        }),
      )
      break
    }
    case 'backdrop': {
      w = int(200, 480)
      h = int(200, 480)
      const a = colour()
      const b = farFrom([a], 12)
      out.push(
        graphic('backdrop', {
          x: 0,
          y: 0,
          width: w,
          height: h,
          shape: { kind: 'rect', cornerRadius: 0 },
          fills: [
            {
              type: 'linear',
              from: { x: between(0, 0.3), y: 0 },
              to: { x: between(0.7, 1), y: 1 },
              stops: [
                { offset: 0, color: hex(...a) },
                { offset: 1, color: hex(...b) },
              ],
            },
          ],
        }),
      )
      return { layers: out, w, h }
    }
    case 'overlap': {
      w = int(120, 300)
      h = int(90, 220)
      const c1 = colour()
      out.push(
        graphic('back', {
          x: m,
          y: m,
          width: w * 0.65,
          height: h * 0.8,
          shape: { kind: 'rect', cornerRadius: between(0, 20) },
          fills: [solidOf(c1)],
        }),
      )
      out.push(
        graphic('front', {
          x: m + w * 0.4,
          y: m + h * 0.3,
          width: w * 0.6,
          height: h * 0.7,
          shape: { kind: 'ellipse' },
          fills: [solidOf(farFrom([c1], 20))],
        }),
      )
      break
    }
    case 'rotated': {
      h = int(30, 90)
      w = int(h * 2, h * 4)
      const diag = Math.hypot(w, h)
      out.push(
        graphic('rotated', {
          x: m + (diag - w) / 2,
          y: m + (diag - h) / 2,
          width: w,
          height: h,
          rotation: between(-35, 35),
          shape: { kind: 'rect', cornerRadius: pick([0, h / 2, h / 5]) },
          fills: [solidOf(colour())],
        }),
      )
      return { layers: out, w: diag + 2 * m, h: diag + 2 * m }
    }
    case 'translucent':
      out.push(
        graphic('panel', {
          ...box(),
          shape: { kind: 'rect', cornerRadius: between(0, 24) },
          fills: [{ ...solidOf(colour()), opacity: Math.round(between(0.55, 0.85) * 100) / 100 }],
        }),
      )
      break
    case 'dashed': {
      h = int(60, 140)
      w = int(h * 1.5, h * 3.5)
      const sw = between(2, 4)
      out.push(
        graphic('panel', {
          ...box(),
          shape: { kind: 'rect', cornerRadius: between(6, 20) },
          fills: [solidOf([255, 255, 255])],
        }),
      )
      out.push(
        graphic('dashes', {
          x: m + 8,
          y: m + 8,
          width: w - 16,
          height: h - 16,
          shape: { kind: 'rect', cornerRadius: between(4, 14) },
          strokes: [{ paint: solidOf(colour()), width: sw, align: 'center', dashes: [between(6, 14), between(4, 8)] }],
        }),
      )
      break
    }
    default:
      break
  }
  return { layers: out, w: w + 2 * m, h: h + 2 * m }
}

/** A photo-like picture: fractal noise through a palette, with soft blobs and grain. */
function photo(w: number, h: number, cutout: boolean): Img {
  const img = makeImg(w, h)
  const pal = [randomColour(), randomColour(), randomColour()]
  const grid = (n: number) => Array.from({ length: (n + 2) * (n + 2) }, () => rand())
  const octaves = [4, 8, 16, 32].map((n) => ({ n, g: grid(n) }))
  const noise = (x: number, y: number) => {
    let v = 0
    let amp = 0.5
    for (const { n, g } of octaves) {
      const fx = (x / w) * n
      const fy = (y / h) * n
      const x0 = Math.floor(fx)
      const y0 = Math.floor(fy)
      const tx = fx - x0
      const ty = fy - y0
      const s = (a: number, b: number) => g[(b * (n + 2) + a) % g.length]!
      const sm = (t: number) => t * t * (3 - 2 * t)
      const top = s(x0, y0) * (1 - sm(tx)) + s(x0 + 1, y0) * sm(tx)
      const bot = s(x0, y0 + 1) * (1 - sm(tx)) + s(x0 + 1, y0 + 1) * sm(tx)
      v += amp * (top * (1 - sm(ty)) + bot * sm(ty))
      amp /= 2
    }
    return v / 0.9375
  }
  const blobs = Array.from({ length: int(3, 7) }, () => ({
    x: between(0, w),
    y: between(0, h),
    r: between(10, Math.min(w, h) / 2),
    c: randomColour(),
  }))
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const v = noise(x, y)
      const t = Math.min(1.999, v * 2)
      const a = pal[Math.floor(t)]!
      const b = pal[Math.floor(t) + 1]!
      const f = t - Math.floor(t)
      const c = [0, 1, 2].map((k) => a[k]! * (1 - f) + b[k]! * f)
      for (const bl of blobs) {
        const d = Math.hypot(x - bl.x, y - bl.y) / bl.r
        const wgt = Math.exp(-d * d * 2) * 0.7
        for (let k = 0; k < 3; k++) c[k] = c[k]! * (1 - wgt) + bl.c[k]! * wgt
      }
      const i = (y * w + x) * 4
      for (let k = 0; k < 3; k++) img.d[i + k] = Math.max(0, Math.min(255, c[k]! + (rand() - 0.5) * 18))
      let alpha = 1
      if (cutout) {
        const d = Math.hypot((x - w / 2) / (w / 2), (y - h / 2) / (h / 2)) + (noise(x * 1.7, y * 1.3) - 0.5) * 0.5
        alpha = Math.max(0, Math.min(1, (0.95 - d) * 12))
      }
      img.d[i + 3] = alpha
    }
  return img
}

/** A detailed render: many small soft shapes with gradients, more than a designer would rebuild. */
function renderLike(ck: Awaited<ReturnType<typeof loadCanvasKit>>, w: number, h: number): Img {
  const layers: OutLayer[] = []
  const n = int(40, 80)
  for (let i = 0; i < n; i++) {
    const a = randomColour()
    const b = randomColour()
    const s = between(6, Math.min(w, h) / 3)
    layers.push(
      graphic('bit', {
        x: between(-s / 2, w - s / 2),
        y: between(-s / 2, h - s / 2),
        width: s,
        height: s * between(0.5, 1.5),
        rotation: between(0, 90),
        shape: { kind: pick(['ellipse', 'rect', 'star']), cornerRadius: between(0, 6), points: 5, innerRadius: 0.5 },
        fills: [
          {
            type: 'linear',
            from: { x: 0, y: 0 },
            to: { x: 1, y: 1 },
            stops: [
              { offset: 0, color: hex(...a) },
              { offset: 1, color: hex(...b) },
            ],
          },
        ],
        effects: rand() < 0.3 ? [{ type: 'layerBlur', radius: between(1, 4) }] : [],
      }),
    )
  }
  return drawLayers(ck, layers, w, h)
}

// ---- Degradations ----

function blur(img: Img, sigma: number): Img {
  const r = Math.ceil(sigma * 3)
  const k: number[] = []
  let s = 0
  for (let i = -r; i <= r; i++) {
    k.push(Math.exp(-(i * i) / (2 * sigma * sigma)))
    s += k[k.length - 1]!
  }
  const kk = k.map((v) => v / s)
  const pass = (src: Img, dx: number, dy: number) => {
    const out = makeImg(src.w, src.h)
    for (let y = 0; y < src.h; y++)
      for (let x = 0; x < src.w; x++) {
        let pr = 0,
          pg = 0,
          pb = 0,
          pa = 0
        for (let i = -r; i <= r; i++) {
          const xx = Math.max(0, Math.min(src.w - 1, x + i * dx))
          const yy = Math.max(0, Math.min(src.h - 1, y + i * dy))
          const j = (yy * src.w + xx) * 4
          const a = src.d[j + 3]! * kk[i + r]!
          pr += src.d[j]! * a
          pg += src.d[j + 1]! * a
          pb += src.d[j + 2]! * a
          pa += a
        }
        const o = (y * src.w + x) * 4
        out.d[o] = pa > 0 ? pr / pa : 0
        out.d[o + 1] = pa > 0 ? pg / pa : 0
        out.d[o + 2] = pa > 0 ? pb / pa : 0
        out.d[o + 3] = pa
      }
    return out
  }
  return pass(pass(img, 1, 0), 0, 1)
}

function resample(img: Img, f: number): Img {
  return resize(resize(img, Math.max(2, Math.round(img.w * f)), Math.max(2, Math.round(img.h * f))), img.w, img.h)
}

function noise(img: Img, sigma: number): Img {
  const out = makeImg(img.w, img.h)
  out.d.set(img.d)
  for (let i = 0; i < img.w * img.h; i++) {
    const g = (rand() + rand() + rand() - 1.5) * 2 * sigma
    for (let k = 0; k < 3; k++)
      out.d[i * 4 + k] = Math.max(0, Math.min(255, out.d[i * 4 + k]! + g + (rand() - 0.5) * sigma))
  }
  return out
}

function wobble(img: Img, amp: number): Img {
  const n = 6
  const gx = Array.from({ length: (n + 2) * (n + 2) }, () => between(-1, 1))
  const gy = Array.from({ length: (n + 2) * (n + 2) }, () => between(-1, 1))
  const field = (g: number[], x: number, y: number) => {
    const fx = (x / img.w) * n
    const fy = (y / img.h) * n
    const x0 = Math.floor(fx)
    const y0 = Math.floor(fy)
    const tx = fx - x0
    const ty = fy - y0
    const s = (a: number, b: number) => g[b * (n + 2) + a]!
    return (
      (s(x0, y0) * (1 - tx) + s(x0 + 1, y0) * tx) * (1 - ty) + (s(x0, y0 + 1) * (1 - tx) + s(x0 + 1, y0 + 1) * tx) * ty
    )
  }
  const out = makeImg(img.w, img.h)
  for (let y = 0; y < img.h; y++)
    for (let x = 0; x < img.w; x++) {
      const sx = Math.max(0, Math.min(img.w - 1, x + amp * field(gx, x, y)))
      const sy = Math.max(0, Math.min(img.h - 1, y + amp * field(gy, x, y)))
      const x0 = Math.floor(sx)
      const y0 = Math.floor(sy)
      sampleInto(
        img,
        x0,
        Math.min(img.w - 1, x0 + 1),
        y0,
        Math.min(img.h - 1, y0 + 1),
        sx - x0,
        sy - y0,
        out.d,
        (y * img.w + x) * 4,
      )
    }
  return out
}

function jpeg(ck: Awaited<ReturnType<typeof loadCanvasKit>>, img: Img, q: number): Img {
  // Colour bleeds under see-through pixels as in a cut-out layer: spread the nearest colours first.
  const filled = makeImg(img.w, img.h)
  filled.d.set(img.d)
  for (let pass = 0; pass < 6; pass++) {
    const src = filled.d.slice()
    for (let y = 0; y < img.h; y++)
      for (let x = 0; x < img.w; x++) {
        const i = (y * img.w + x) * 4
        if (src[i + 3]! > 0.02) continue
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const xx = x + dx!
          const yy = y + dy!
          if (xx < 0 || yy < 0 || xx >= img.w || yy >= img.h) continue
          const j = (yy * img.w + xx) * 4
          if (src[j + 3]! > 0.02) {
            filled.d[i] = src[j]!
            filled.d[i + 1] = src[j + 1]!
            filled.d[i + 2] = src[j + 2]!
            filled.d[i + 3] = 0.03
            break
          }
        }
      }
  }
  const opaque = makeImg(img.w, img.h)
  for (let i = 0; i < img.w * img.h; i++)
    opaque.d.set([filled.d[i * 4]!, filled.d[i * 4 + 1]!, filled.d[i * 4 + 2]!, 1], i * 4)
  const back = decode(ck, encode(ck, opaque, 'jpeg', q))
  const out = makeImg(img.w, img.h)
  for (let i = 0; i < img.w * img.h; i++)
    out.d.set([back.d[i * 4]!, back.d[i * 4 + 1]!, back.d[i * 4 + 2]!, img.d[i * 4 + 3]!], i * 4)
  return out
}

export function degrade(ck: Awaited<ReturnType<typeof loadCanvasKit>>, img: Img, d: Degradation): Img {
  switch (d) {
    case 'clean':
      return img
    case 'resample':
      return resample(img, between(0.45, 0.7))
    case 'jpeg':
      return jpeg(ck, img, int(55, 80))
    case 'blur':
      return blur(img, between(0.7, 1.3))
    case 'noise':
      return noise(img, between(3, 6))
    case 'wobble':
      return wobble(img, between(0.6, 1.5))
    case 'ai':
      return jpeg(ck, noise(blur(wobble(resample(img, 0.65), 0.8), 0.6), 3), 75)
  }
}

if (import.meta.url === `file:///${process.argv[1]!.replace(/\\/g, '/')}`) {
  const ck = await loadCanvasKit()
  mkdirSync(OUT, { recursive: true })
  const index: SynthBlock[] = []
  let id = 0
  for (const family of FAMILIES) {
    for (let k = 0; k < COUNT_PER_FAMILY; k++) {
      const degradation = DEGRADATIONS[(k + FAMILIES.indexOf(family)) % DEGRADATIONS.length]!
      const kit = makeKit()
      const brandKind: SynthBlock['brand'] = k % 5 < 2 ? 'brand' : k % 5 === 2 ? 'near' : 'none'
      const kitRgb = kit.map((c) => parseHex(c.value).rgb)
      const tokens: (string | null)[] = []
      let used = 0
      const colour = (): [number, number, number] => {
        const i = used++ % kit.length
        if (brandKind === 'brand') {
          tokens.push(kit[i]!.token)
          return kitRgb[i]!
        }
        tokens.push(null)
        if (brandKind === 'near') return nearTo(kitRgb[i]!, 7, 12)
        return farFrom(kitRgb, 15)
      }
      let img: Img
      let layers: OutLayer[] = []
      let truth: SynthBlock['truth'] = 'shapes'
      let w: number
      let h: number
      if (family === 'photo' || family === 'render') {
        truth = 'picture'
        w = int(120, 320)
        h = int(100, 300)
        img = family === 'photo' ? photo(w, h, k % 2 === 1) : renderLike(ck, w, h)
      } else {
        const made = layersOf(family, colour)
        layers = made.layers
        w = Math.ceil(made.w)
        h = Math.ceil(made.h)
        img = drawLayers(ck, layers, w, h)
      }
      const degraded = degrade(ck, img, degradation)
      savePng(ck, degraded, `${OUT}/${id}.png`)
      index.push({
        id,
        family,
        degradation,
        brand: brandKind,
        kit,
        truth,
        layers,
        tokens: tokens.slice(0, layers.length),
        w,
        h,
        dev: id % 3 === 0,
      })
      id++
    }
  }
  writeFileSync(`${OUT}/index.json`, JSON.stringify(index, null, 1))
  console.log(
    'blocks',
    index.length,
    'dev',
    index.filter((b) => b.dev).length,
    'test',
    index.filter((b) => !b.dev).length,
  )
}
