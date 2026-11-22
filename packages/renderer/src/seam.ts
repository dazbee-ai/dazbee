import type { CanvasKit, Image, Surface } from '@dazbee/canvaskit'
import { parseDesign } from '@dazbee/schema'

import { drawScene } from './draw/draw.ts'
import { drawVectorFrame, type VectorTarget } from './draw/vector.ts'
import { type ResourceBytes, type ResourceCache, resourceCache, type Resources } from './resources.ts'
import { render, type Scene } from './scene.ts'
import { textMeasure } from './text/cache.ts'

/** What a PDF says about itself. */
export interface VectorOptions {
  /** The PDF's title, such as the design's name. */
  title?: string
  /** The language of its text, such as `en` or `ar`. */
  lang?: string
}

/** A frame's pixels as a raster export reads them, before any encoding. */
export interface Pixels {
  width: number
  height: number
  /** RGBA, 8 bits a channel, not premultiplied, row by row. */
  pixels: Uint8Array
}

/** A frame's pixels and the PNG of them. */
export interface Rendered extends Pixels {
  png: Uint8Array
}

/** How a raster export is drawn and encoded. */
export interface EncodeOptions {
  format: 'png' | 'webp'
  /** WebP's quality, 1 to 100; 100 is lossless. PNG is always lossless. */
  quality?: number
  /** How many pixels of the file to one of the frame, each way; 1 by default. */
  scale?: number
}

/**
 * The render seam for exports: design JSON in, pixels and PNG out, always on the CPU surface
 * (ADR-0005), in Node and in the browser alike.
 */
export function renderDesign(
  ck: CanvasKit,
  json: unknown,
  frameId: string,
  bytes: ResourceBytes,
  cache?: ResourceCache,
): Rendered {
  return onSurface(ck, json, frameId, bytes, cache, 1, (image, width, height) => ({
    ...readPixels(ck, image, width, height),
    png: encode(ck, image, { format: 'png' }),
  }))
}

/**
 * A frame's pixels, drawn `scale` times its size: everything is drawn at that density, not
 * enlarged. Reads the pixels only, for an export that encodes them itself, such as a JPG.
 */
export function renderPixels(
  ck: CanvasKit,
  json: unknown,
  frameId: string,
  bytes: ResourceBytes,
  cache?: ResourceCache,
  scale = 1,
): Pixels {
  return onSurface(ck, json, frameId, bytes, cache, scale, (image, width, height) =>
    readPixels(ck, image, width, height),
  )
}

/**
 * A frame as a PNG or a WebP, drawn `scale` times its size. Encodes straight from the surface, so
 * a big export holds no second copy of its pixels.
 */
export function renderEncoded(
  ck: CanvasKit,
  json: unknown,
  frameId: string,
  bytes: ResourceBytes,
  options: EncodeOptions,
  cache?: ResourceCache,
): Uint8Array {
  return onSurface(ck, json, frameId, bytes, cache, options.scale ?? 1, (image) => encode(ck, image, options))
}

/**
 * The render seam for vector exports: design JSON in, a one-page PDF or an SVG out, drawn by the
 * same code as the pixels onto Skia's PDF or SVG canvas, in Node and in the browser alike. A unit
 * is one pixel of the frame, and what the file can't hold as vectors is drawn at that resolution
 * (see drawVectorFrame). PDF text stays text with its fonts embedded; SVG text is drawn as shapes,
 * because an SVG names fonts the app that opens it may not have and shapes Hindi and Arabic itself.
 */
export function renderVector(
  ck: CanvasKit,
  json: unknown,
  frameId: string,
  bytes: ResourceBytes,
  target: VectorTarget,
  cache?: ResourceCache,
  options: VectorOptions = {},
): Uint8Array {
  return withScene(ck, json, frameId, bytes, cache, (scene, resources) => {
    if (target === 'pdf') {
      const pdf = new ck.PDFDocument({
        title: options.title ?? '',
        author: '',
        creator: '',
        producer: '',
        lang: options.lang ?? '',
        // One raster pixel to a unit: blurs and shadows come at the export's own resolution.
        rasterDPI: 72,
        encodingQuality: 101,
      })
      try {
        const canvas = pdf.beginPage(scene.width, scene.height)
        if (!canvas) throw new Error('CanvasKit could not start a PDF page')
        drawVectorFrame(ck, canvas, scene, resources, 'pdf')
        pdf.endPage()
        const file = pdf.close()
        if (!file) throw new Error('CanvasKit could not finish the PDF')
        return file
      } finally {
        pdf.delete()
      }
    }
    const svg = new ck.SVGDocument(scene.width, scene.height, ck.SVG_CONVERT_TEXT_TO_PATHS | ck.SVG_NO_PRETTY_XML)
    try {
      const canvas = svg.canvas()
      if (!canvas) throw new Error('CanvasKit could not start an SVG')
      drawVectorFrame(ck, canvas, scene, resources, 'svg')
      const file = svg.close()
      if (!file) throw new Error('CanvasKit could not finish the SVG')
      return numberClips(file)
    } finally {
      svg.delete()
    }
  })
}

/**
 * Draws one frame onto a surface the caller owns, such as the editor's WebGL surface. Returns the
 * frame's size.
 */
export function drawDesign(
  ck: CanvasKit,
  surface: Surface,
  json: unknown,
  frameId: string,
  bytes: ResourceBytes,
  cache?: ResourceCache,
): { width: number; height: number } {
  const scene = drawOn(ck, surface, json, frameId, bytes, cache, 1)
  return { width: scene.width, height: scene.height }
}

/**
 * Draws one frame on a CPU surface `scale` times its size and hands `read` a snapshot of it. The
 * surface and the snapshot are freed after, whatever `read` does.
 */
function onSurface<T>(
  ck: CanvasKit,
  json: unknown,
  frameId: string,
  bytes: ResourceBytes,
  cache: ResourceCache | undefined,
  scale: number,
  read: (image: Image, width: number, height: number) => T,
): T {
  const parsed = parseDesign(json)
  const frame =
    parsed.success && Object.hasOwn(parsed.design.frames, frameId) ? parsed.design.frames[frameId] : undefined
  // A bad design or frame is reported by the draw, which parses and renders it.
  const width = Math.ceil((frame?.width ?? 1) * scale)
  const height = Math.ceil((frame?.height ?? 1) * scale)
  const surface = ck.MakeSurface(width, height)
  if (!surface) throw new Error(`CanvasKit could not make a ${width}×${height} CPU surface`)
  try {
    drawOn(ck, surface, parsed.success ? parsed.design : json, frameId, bytes, cache, scale)
    const image = surface.makeImageSnapshot()
    try {
      return read(image, width, height)
    } finally {
      image.delete()
    }
  } finally {
    // delete() alone keeps the w×h×4 pixel buffer in wasm memory; dispose() frees both.
    surface.dispose()
  }
}

/** Draws one frame on the surface, the canvas scaled by `scale` so it is drawn at that density. */
function drawOn(
  ck: CanvasKit,
  surface: Surface,
  json: unknown,
  frameId: string,
  bytes: ResourceBytes,
  cache: ResourceCache | undefined,
  scale: number,
): Scene {
  return withScene(ck, json, frameId, bytes, cache, (scene, resources) => {
    const canvas = surface.getCanvas()
    canvas.save()
    try {
      if (scale !== 1) canvas.scale(scale, scale)
      drawScene(ck, canvas, scene, resources)
    } finally {
      canvas.restore()
    }
    surface.flush()
    return scene
  })
}

/** Reads a snapshot back as unpremultiplied RGBA. */
function readPixels(ck: CanvasKit, image: Image, width: number, height: number): Pixels {
  const pixels = image.readPixels(0, 0, {
    width,
    height,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  })
  if (!(pixels instanceof Uint8Array)) throw new Error('CanvasKit could not read back the rendered pixels')
  return { width, height, pixels }
}

/** Encodes a snapshot as a PNG or a WebP, transparency kept. */
function encode(ck: CanvasKit, image: Image, { format, quality = 100 }: EncodeOptions): Uint8Array {
  const file = format === 'png' ? image.encodeToBytes() : image.encodeToBytes(ck.ImageFormat.WEBP, quality)
  if (!file) throw new Error(`CanvasKit could not encode the ${format === 'png' ? 'PNG' : 'WebP'}`)
  return file
}

/**
 * Builds the scene and hands it to `draw` with the cache's resources, or with ones made for this
 * draw and freed after it. A long-lived process passes one cache to every render so fonts and
 * images are decoded once. Auto layout measures text with the same fonts the draw uses (#46).
 */
function withScene<T>(
  ck: CanvasKit,
  json: unknown,
  frameId: string,
  bytes: ResourceBytes,
  cache: ResourceCache | undefined,
  draw: (scene: Scene, resources: Resources) => T,
): T {
  const parsed = parseDesign(json)
  if (!parsed.success) throw new Error(`invalid design:\n${parsed.errors.join('\n')}`)
  const owned = cache ?? resourceCache(ck)
  try {
    const resources = owned.resources(bytes)
    const scene = render(parsed.design, frameId, undefined, textMeasure(ck, resources), bytes.variables)
    return draw(scene, resources)
  } finally {
    if (!cache) owned.delete()
  }
}

/**
 * Skia names an SVG's clip paths after its clips' ids, which count up across the whole process, so
 * the same frame would come out different after other exports. Renumbered in order of appearance,
 * the file depends on the frame alone, in every runtime.
 */
function numberClips(file: Uint8Array): Uint8Array {
  const ids = new Map<string, string>()
  const text = new TextDecoder().decode(file).replace(/\bcl_[0-9a-f]+\b/g, (id) => {
    if (!ids.has(id)) ids.set(id, `cl_${ids.size + 1}`)
    return ids.get(id) as string
  })
  return new TextEncoder().encode(text)
}
