// PROTOTYPE. Pictures as RGBA float arrays: decoding and encoding through Dazbee's own CanvasKit
// (bytes we control, never the system's decoder), resizing, compositing and the alpha mask.
import { readFileSync, writeFileSync } from 'node:fs'

import type { CanvasKit } from '@dazbee/canvaskit'

/** RGBA, unpremultiplied, colour channels 0..255 and alpha 0..1, row by row. */
export interface Img {
  w: number
  h: number
  /** r, g, b in 0..255; a in 0..1. */
  d: Float32Array
}

export const makeImg = (w: number, h: number): Img => ({ w, h, d: new Float32Array(w * h * 4) })

/** Unpremultiplied RGBA bytes to an Img. */
export function fromBytes(w: number, h: number, px: Uint8Array): Img {
  const img = makeImg(w, h)
  for (let i = 0; i < w * h; i++) {
    img.d[i * 4] = px[i * 4]!
    img.d[i * 4 + 1] = px[i * 4 + 1]!
    img.d[i * 4 + 2] = px[i * 4 + 2]!
    // 254 is how the layered blocks store opaque.
    const a = px[i * 4 + 3]!
    img.d[i * 4 + 3] = a >= 253 ? 1 : a / 255
  }
  return img
}

export function toBytes(img: Img): Uint8Array {
  const out = new Uint8Array(img.w * img.h * 4)
  for (let i = 0; i < img.w * img.h * 4; i++) {
    const v = (i & 3) === 3 ? img.d[i]! * 255 : img.d[i]!
    out[i] = Math.max(0, Math.min(255, Math.round(v)))
  }
  return out
}

export function decodeFile(ck: CanvasKit, path: string): Img {
  return decode(ck, readFileSync(path))
}

export function decode(ck: CanvasKit, bytes: Uint8Array): Img {
  const image = ck.MakeImageFromEncoded(bytes)
  if (!image) throw new Error('could not decode')
  try {
    const w = image.width()
    const h = image.height()
    const px = image.readPixels(0, 0, {
      width: w,
      height: h,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    }) as Uint8Array
    return fromBytes(w, h, px)
  } finally {
    image.delete()
  }
}

export function encode(ck: CanvasKit, img: Img, format: 'png' | 'jpeg' = 'png', quality = 100): Uint8Array {
  const image = ck.MakeImage(
    {
      width: img.w,
      height: img.h,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    },
    toBytes(img),
    img.w * 4,
  )
  if (!image) throw new Error('could not make image')
  try {
    const bytes = format === 'png' ? image.encodeToBytes() : image.encodeToBytes(ck.ImageFormat.JPEG, quality)
    if (!bytes) throw new Error('could not encode')
    return bytes
  } finally {
    image.delete()
  }
}

export const savePng = (ck: CanvasKit, img: Img, path: string) => writeFileSync(path, encode(ck, img))

/** Area-averaged downscale (premultiplied), or bilinear upscale, to w×h. */
export function resize(img: Img, w: number, h: number): Img {
  if (w === img.w && h === img.h) return img
  const out = makeImg(w, h)
  const sx = img.w / w
  const sy = img.h / h
  if (sx >= 1 && sy >= 1) {
    for (let y = 0; y < h; y++) {
      const y0 = y * sy
      const y1 = y0 + sy
      for (let x = 0; x < w; x++) {
        const x0 = x * sx
        const x1 = x0 + sx
        let r = 0,
          g = 0,
          b = 0,
          a = 0,
          wsum = 0
        for (let yy = Math.floor(y0); yy < Math.ceil(y1) && yy < img.h; yy++) {
          const wy = Math.min(y1, yy + 1) - Math.max(y0, yy)
          for (let xx = Math.floor(x0); xx < Math.ceil(x1) && xx < img.w; xx++) {
            const wgt = wy * (Math.min(x1, xx + 1) - Math.max(x0, xx))
            const i = (yy * img.w + xx) * 4
            const al = img.d[i + 3]! * wgt
            r += img.d[i]! * al
            g += img.d[i + 1]! * al
            b += img.d[i + 2]! * al
            a += al
            wsum += wgt
          }
        }
        const o = (y * w + x) * 4
        out.d[o] = a > 0 ? r / a : 0
        out.d[o + 1] = a > 0 ? g / a : 0
        out.d[o + 2] = a > 0 ? b / a : 0
        out.d[o + 3] = wsum > 0 ? a / wsum : 0
      }
    }
    return out
  }
  for (let y = 0; y < h; y++) {
    const fy = Math.max(0, Math.min(img.h - 1, (y + 0.5) * sy - 0.5))
    const y0 = Math.floor(fy)
    const y1 = Math.min(img.h - 1, y0 + 1)
    const ty = fy - y0
    for (let x = 0; x < w; x++) {
      const fx = Math.max(0, Math.min(img.w - 1, (x + 0.5) * sx - 0.5))
      const x0 = Math.floor(fx)
      const x1 = Math.min(img.w - 1, x0 + 1)
      const tx = fx - x0
      sampleInto(img, x0, x1, y0, y1, tx, ty, out.d, (y * w + x) * 4)
    }
  }
  return out
}

/** Bilinear sample of premultiplied colour at four neighbours, written unpremultiplied. */
export function sampleInto(
  img: Img,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  tx: number,
  ty: number,
  out: Float32Array,
  o: number,
) {
  let r = 0,
    g = 0,
    b = 0,
    a = 0
  const add = (x: number, y: number, wgt: number) => {
    const i = (y * img.w + x) * 4
    const al = img.d[i + 3]! * wgt
    r += img.d[i]! * al
    g += img.d[i + 1]! * al
    b += img.d[i + 2]! * al
    a += al
  }
  add(x0, y0, (1 - tx) * (1 - ty))
  add(x1, y0, tx * (1 - ty))
  add(x0, y1, (1 - tx) * ty)
  add(x1, y1, tx * ty)
  out[o] = a > 0 ? r / a : 0
  out[o + 1] = a > 0 ? g / a : 0
  out[o + 2] = a > 0 ? b / a : 0
  out[o + 3] = a
}

/** The picture drawn over a flat colour: opaque RGB. */
export function over(img: Img, bg: [number, number, number]): Float32Array {
  const out = new Float32Array(img.w * img.h * 3)
  for (let i = 0; i < img.w * img.h; i++) {
    const a = img.d[i * 4 + 3]!
    out[i * 3] = img.d[i * 4]! * a + bg[0] * (1 - a)
    out[i * 3 + 1] = img.d[i * 4 + 1]! * a + bg[1] * (1 - a)
    out[i * 3 + 2] = img.d[i * 4 + 2]! * a + bg[2] * (1 - a)
  }
  return out
}

/** Side-by-side sheet of pictures over a checkerboard, with a gap between. */
export function sheet(imgs: Img[], gap = 8): Img {
  const h = Math.max(...imgs.map((i) => i.h))
  const w = imgs.reduce((s, i) => s + i.w, 0) + gap * (imgs.length - 1)
  const out = makeImg(w, h)
  for (let i = 0; i < w * h; i++) {
    const x = i % w
    const y = Math.floor(i / w)
    const c = ((x >> 3) + (y >> 3)) & 1 ? 235 : 205
    out.d.set([c, c, c, 1], i * 4)
  }
  let ox = 0
  for (const img of imgs) {
    for (let y = 0; y < img.h; y++)
      for (let x = 0; x < img.w; x++) {
        const s = (y * img.w + x) * 4
        const o = (y * w + x + ox) * 4
        const a = img.d[s + 3]!
        for (let c = 0; c < 3; c++) out.d[o + c] = img.d[s + c]! * a + out.d[o + c]! * (1 - a)
      }
    ox += img.w + gap
  }
  return out
}
