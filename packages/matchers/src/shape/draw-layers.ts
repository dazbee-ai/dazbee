// Drawing a piece's graphics with Dazbee's renderer, on the CPU surface: the graphics go into a
// one-frame design the piece's size, with no fill, and come back as pixels, or as one graphic's
// coverage for fitting its shape.

import type { CanvasKit } from '@dazbee/canvaskit'
import { type Pixels, renderPixels, type ResourceCache, resourceCache } from '@dazbee/renderer'
import type { DropShadow, Paint, Shape, VariableRef } from '@dazbee/schema'

/** A stroke as the shape matcher sets it; the rest of a stroke takes the schema's defaults. */
export interface ShapeStroke {
  paint: Paint
  width: number
  align: 'inside' | 'center'
  cap?: 'butt' | 'round'
}

/** A graphic the shape matcher answers with, in the piece's pixels, before the schema's defaults. */
export interface ShapeLayer {
  type: 'graphic'
  name: string
  role?: 'background'
  bindings?: { fill: VariableRef }
  props: {
    x: number
    y: number
    width: number
    height: number
    rotation: number
    shape: Shape
    fills: Paint[]
    strokes: ShapeStroke[]
    effects?: DropShadow[]
  }
  /** A traced path's fitted shape, which takes its place when the piece still looks the same with it; never drawn or answered. */
  editable?: ShapeLayer
}

/** Fractional indexes in order: a00, a01, … a0z, a10, … */
const INDEX_DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'

/** Each CanvasKit's resource cache: graphics need no fonts or images, so one serves every drawing. */
const caches = new WeakMap<CanvasKit, ResourceCache>()

/**
 * The graphics, back to front, drawn `scale` times the piece's `width` × `height`, with the brand
 * kit's colours for bound fills.
 */
export function drawGraphics(
  ck: CanvasKit,
  layers: readonly ShapeLayer[],
  width: number,
  height: number,
  scale = 1,
  variables?: Record<VariableRef, string>,
): Pixels {
  return renderPixels(
    ck,
    designOf(layers, width, height),
    'f',
    { fonts: [], fallbackFamilies: [], images: {}, ...(variables ? { variables } : {}) },
    cacheOf(ck),
    scale,
  )
}

/**
 * One graphic's coverage, 0 to 1 a pixel: its alpha drawn `scale` times a `width` × `height` piece,
 * the top left `outWidth` × `outHeight` of it.
 */
export function coverage(
  ck: CanvasKit,
  layer: ShapeLayer,
  width: number,
  height: number,
  scale: number,
  outWidth: number,
  outHeight: number,
): Float32Array {
  const drawn = drawGraphics(ck, [layer], width, height, scale)
  const alpha = new Float32Array(outWidth * outHeight)
  const inverse = 1 / 255
  for (let y = 0; y < Math.min(outHeight, drawn.height); y++)
    for (let x = 0; x < Math.min(outWidth, drawn.width); x++)
      alpha[y * outWidth + x] = (drawn.pixels[(y * drawn.width + x) * 4 + 3] ?? 0) * inverse
  return alpha
}

/** The graphics as a design: one page, one frame of `width` × `height` with no fill, the graphics back to front. */
function designOf(layers: readonly ShapeLayer[], width: number, height: number) {
  const nodes: Record<string, unknown> = {}
  layers.forEach((layer, i) => {
    const id = `n${i}`
    nodes[id] = {
      type: layer.type,
      parentId: 'f',
      link: id,
      index: 'a' + (INDEX_DIGITS[Math.floor(i / 62)] ?? '') + (INDEX_DIGITS[i % 62] ?? ''),
      name: layer.name,
      ...(layer.role ? { role: layer.role } : {}),
      ...(layer.bindings ? { bindings: layer.bindings } : {}),
      props: layer.props,
    }
  })
  return {
    meta: { designId: 'piece', name: 'piece' },
    pages: { p: { name: 'Page 1', order: 'a0' } },
    frames: {
      f: {
        pageId: 'p',
        name: 'Piece',
        width: Math.ceil(width - 1e-6),
        height: Math.ceil(height - 1e-6),
        x: 0,
        y: 0,
        fills: [],
        order: 'a0',
      },
    },
    nodes,
  }
}

/** The CanvasKit's resource cache, made on first use. */
function cacheOf(ck: CanvasKit): ResourceCache {
  let cache = caches.get(ck)
  if (!cache) {
    cache = resourceCache(ck)
    caches.set(ck, cache)
  }
  return cache
}
