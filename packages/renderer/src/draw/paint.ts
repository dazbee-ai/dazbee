import type { Canvas, CanvasKit, Image, Paint as CkPaint, Path, Shader } from '@dazbee/canvaskit'
import type { Flips } from '@dazbee/doc'
import type { ImagePaint, Paint, RadialPaint, Rect } from '@dazbee/schema'

import { color } from '../color.ts'
import { type ImageSize, imageSizeOf, type Resources } from '../resources.ts'
import { imageColorMatrix } from './adjust.ts'
import { flipMatrix } from './flip.ts'

/** What an image fill draws past its image's edges along an axis: the image again, nothing, or its edge pixels stretched. */
export type ImageBeyond = 'repeat' | 'clear' | 'edge'

type Size = Pick<Rect, 'width' | 'height'>

export function fillPath(
  ck: CanvasKit,
  canvas: Canvas,
  path: Path,
  fill: Paint,
  box: Rect & Flips,
  resources: Resources,
) {
  // A PDF reader can drop a see-through image pattern's alpha, so a vector export draws the image
  // whole inside a layer that holds its opacity instead.
  const faded = resources.vector && fill.type === 'image' && fill.opacity < 1
  const paint = paintFor(ck, faded ? { ...fill, opacity: 1 } : fill, box, resources)
  if (!paint) return
  if (faded) {
    const layer = new ck.Paint()
    layer.setAlphaf(fill.opacity)
    canvas.saveLayer(layer, path.getBounds())
    layer.delete()
  }
  // Skia's PDF writer draws an image fill it can't write as a pattern, such as one with a colour
  // matrix, as a picture of the whole clip, up to a million pixels and scaled down past that. Clipped
  // to the path's bounds, the picture covers only the fill, at one pixel to a unit.
  const clipped = resources.vector && fill.type === 'image'
  if (clipped) {
    canvas.save()
    canvas.clipRect(path.getBounds(), ck.ClipOp.Intersect, false)
  }
  canvas.drawPath(path, paint)
  if (clipped) canvas.restore()
  if (faded) canvas.restore()
  paint.delete()
}

/**
 * A CanvasKit paint for one schema paint, or null for a hidden one. Gradient and image geometry is
 * placed in the layer's box, mirrored as the layer is flipped; the paint's own opacity multiplies
 * its colours' alpha.
 */
export function paintFor(
  ck: CanvasKit,
  fill: Paint,
  box: Rect & Flips,
  resources: Pick<Resources, 'images' | 'imageSizes'>,
): CkPaint | null {
  if (fill.visible === false) return null
  const paint = new ck.Paint()
  paint.setAntiAlias(true)
  let shader: Shader | null = null
  const flip = flipMatrix(ck, box)
  const flipped = (matrix: number[]) => (flip ? ck.Matrix.multiply(flip, matrix) : matrix)
  const unitBox = flipped(
    ck.Matrix.multiply(ck.Matrix.translated(box.x, box.y), ck.Matrix.scaled(box.width, box.height)),
  )
  switch (fill.type) {
    case 'solid':
      paint.setColor(color(ck, fill.color))
      break
    case 'linear':
      shader = ck.Shader.MakeLinearGradient(
        [fill.from.x, fill.from.y],
        [fill.to.x, fill.to.y],
        fill.stops.map((s) => color(ck, s.color)),
        fill.stops.map((s) => s.offset),
        ck.TileMode.Clamp,
        unitBox,
      )
      break
    case 'radial':
      shader = ck.Shader.MakeRadialGradient(
        [box.x + fill.center.x * box.width, box.y + fill.center.y * box.height],
        radialRadius(fill, box),
        fill.stops.map((s) => color(ck, s.color)),
        fill.stops.map((s) => s.offset),
        ck.TileMode.Clamp,
        flip ?? undefined,
      )
      break
    case 'angular': {
      // Turned about its centre in the unit box, so offset 0 starts at the angle.
      const turn = ck.Matrix.rotated((fill.angle * Math.PI) / 180, fill.center.x, fill.center.y)
      shader = ck.Shader.MakeSweepGradient(
        fill.center.x,
        fill.center.y,
        fill.stops.map((s) => color(ck, s.color)),
        fill.stops.map((s) => s.offset),
        ck.TileMode.Clamp,
        ck.Matrix.multiply(unitBox, turn),
      )
      break
    }
    case 'image': {
      const image = resources.images.get(fill.assetId)
      if (!image) throw new Error(`no image for asset "${fill.assetId}"`)
      shader = imageShader(ck, image, imageSizeOf(resources, fill.assetId, image), fill, box, flip)
      paint.setAlphaf(fill.opacity)
      const matrix = imageColorMatrix(fill.adjust, fill.filter)
      if (matrix) {
        const filter = ck.ColorFilter.MakeMatrix(matrix)
        paint.setColorFilter(filter)
        filter.delete()
      }
      break
    }
  }
  const opacity = fill.opacity ?? 1
  if (fill.type !== 'image' && opacity < 1) paint.setAlphaf((paint.getColor()[3] ?? 1) * opacity)
  if (shader) {
    paint.setShader(shader)
    shader.delete()
  }
  return paint
}

/**
 * A radial's radius in design pixels: its share of the box's shorter side, so it is a circle in any
 * box, as CSS's closest-side. The hit test reads it as the renderer draws it.
 */
export function radialRadius(paint: Pick<RadialPaint, 'radius'>, box: Size): number {
  return paint.radius * Math.min(box.width, box.height)
}

/**
 * Where an image fill draws its whole image in a box: fill covers the box, centred; fit fits inside
 * it, centred; crop stretches its crop rect over the box, and without one places it as fill does;
 * tile starts it at the box's corner at its own size times its tile scale, and repeats it from there.
 */
export function imagePlacement(image: Size, fill: Pick<ImagePaint, 'fit' | 'crop' | 'tileScale'>, box: Rect): Rect {
  const { width: iw, height: ih } = image
  const tile = fill.tileScale ?? 1
  if (fill.fit === 'tile') return { x: box.x, y: box.y, width: iw * tile, height: ih * tile }
  if (fill.fit === 'crop' && fill.crop) return imageRect(fill.crop, image, box)
  const scale = (fill.fit === 'fit' ? Math.min : Math.max)(box.width / iw, box.height / ih)
  const width = iw * scale
  const height = ih * scale
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height }
}

/** Where the whole image sits when a crop of it is stretched over a box. */
export function imageRect(crop: Rect, image: Size, box: Rect): Rect {
  const sx = box.width / crop.width
  const sy = box.height / crop.height
  return { x: box.x - crop.x * sx, y: box.y - crop.y * sy, width: image.width * sx, height: image.height * sy }
}

/**
 * What an image fill draws past its image's edges, along each axis: tile repeats the image; fit,
 * and a crop that reaches past the image along that axis, leave it clear; fill and a crop inside
 * the image stretch its edge pixels, which only the box's own edge ever samples.
 */
export function imageBeyond(image: Size, fill: Pick<ImagePaint, 'fit' | 'crop'>): Record<'x' | 'y', ImageBeyond> {
  if (fill.fit === 'tile') return { x: 'repeat', y: 'repeat' }
  if (fill.fit === 'fit') return { x: 'clear', y: 'clear' }
  const { crop } = fill
  const past = (start: number, length: number, size: number) => start < 0 || start + length > size
  return {
    x: fill.fit === 'crop' && crop && past(crop.x, crop.width, image.width) ? 'clear' : 'edge',
    y: fill.fit === 'crop' && crop && past(crop.y, crop.height, image.height) ? 'clear' : 'edge',
  }
}

/**
 * Places an image in a box as `imagePlacement` says, drawing past its edges as `imageBeyond` says,
 * both by its own size `size`: a display copy smaller than that is stretched over the same place.
 * `flip` then mirrors it, when the layer is flipped.
 */
function imageShader(
  ck: CanvasKit,
  image: Image,
  size: ImageSize,
  fill: ImagePaint,
  box: Rect,
  flip: number[] | null,
): Shader {
  const rect = imagePlacement(size, fill, box)
  const placed = ck.Matrix.multiply(
    ck.Matrix.translated(rect.x, rect.y),
    ck.Matrix.scaled(rect.width / image.width(), rect.height / image.height()),
  )
  const matrix = flip ? ck.Matrix.multiply(flip, placed) : placed
  const modes = { repeat: ck.TileMode.Repeat, clear: ck.TileMode.Decal, edge: ck.TileMode.Clamp }
  const beyond = imageBeyond(size, fill)
  // Shrunk past half size, the nearest mipmap keeps a photo's look where the image alone would
  // alias; it costs no more than without, and a linear blend between mipmaps was 5 times slower.
  return image.makeShaderOptions(modes[beyond.x], modes[beyond.y], ck.FilterMode.Linear, ck.MipmapMode.Nearest, matrix)
}
