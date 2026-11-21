// PROTOTYPE. Draws a block's layers with Dazbee's renderer: the layers go into a one-frame design
// the block's size, drawn on the CPU surface (ADR-0005) at a scale, and read back as an Img.
import type { CanvasKit } from '@dazbee/canvaskit'
import { renderPixels, resourceCache, type ResourceCache } from '@dazbee/renderer'

import { fromBytes, type Img } from './pixels.ts'

/** A layer the matcher answers with, in the block's pixels, as Dazbee stores it without its place. */
export interface OutLayer {
  type: 'graphic' | 'boolean'
  name: string
  role?: 'badge' | 'cta' | 'background' | 'decoration'
  props: Record<string, unknown>
  bindings?: { fill?: `brand:${string}` }
  /** A boolean's shapes, first to last. */
  children?: OutLayer[]
}

let cache: ResourceCache | undefined

/** Fractional indexes in order: a0, a1, ... az, b0 ... */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
export const indexAt = (i: number) => 'a' + DIGITS[Math.floor(i / 62)]! + DIGITS[i % 62]!

/** The layers as a design: one page, one frame of w×h with no fill, the layers back to front. */
export function designOf(layers: OutLayer[], w: number, h: number) {
  const nodes: Record<string, unknown> = {}
  let n = 0
  const put = (layer: OutLayer, parentId: string, i: number) => {
    const id = `n${n++}`
    nodes[id] = {
      type: layer.type,
      parentId,
      link: id,
      index: indexAt(i),
      name: layer.name,
      ...(layer.role ? { role: layer.role } : {}),
      ...(layer.bindings ? { bindings: layer.bindings } : {}),
      props: layer.props,
    }
    layer.children?.forEach((c, j) => put(c, id, j))
  }
  layers.forEach((l, i) => put(l, 'f', i))
  return {
    meta: { designId: 'block', name: 'block' },
    pages: { p: { name: 'Page 1', order: 'a0' } },
    frames: {
      f: {
        pageId: 'p',
        name: 'Block',
        width: Math.ceil(w - 1e-6),
        height: Math.ceil(h - 1e-6),
        x: 0,
        y: 0,
        fills: [],
        order: 'a0',
      },
    },
    nodes,
  }
}

/** The layers drawn by Dazbee's renderer at `scale` times the block's w×h. */
export function drawLayers(
  ck: CanvasKit,
  layers: OutLayer[],
  w: number,
  h: number,
  scale = 1,
  variables?: Record<string, string>,
): Img {
  cache ??= resourceCache(ck)
  const px = renderPixels(
    ck,
    designOf(layers, w, h),
    'f',
    { fonts: [], fallbackFamilies: [], images: {}, ...(variables ? { variables } : {}) },
    cache,
    scale,
  )
  return fromBytes(px.width, px.height, px.pixels)
}

/**
 * One layer's coverage (alpha) at a scale, the top-left outW×outH of it: its shape filled opaque
 * white, effects and strokes kept.
 */
export function coverage(
  ck: CanvasKit,
  layer: OutLayer,
  w: number,
  h: number,
  scale: number,
  outW: number,
  outH: number,
): Float32Array {
  cache ??= resourceCache(ck)
  const px = renderPixels(
    ck,
    designOf([layer], w, h),
    'f',
    { fonts: [], fallbackFamilies: [], images: {} },
    cache,
    scale,
  )
  const a = new Float32Array(outW * outH)
  const inv = 1 / 255
  for (let y = 0; y < Math.min(outH, px.height); y++)
    for (let x = 0; x < Math.min(outW, px.width); x++) a[y * outW + x] = px.pixels[(y * px.width + x) * 4 + 3]! * inv
  return a
}
