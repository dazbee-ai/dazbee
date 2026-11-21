// Where a layer puts ink in its frame: what it draws by itself on the CPU surface (ADR-0005), its
// shadows, blurs, opacity and blend mode left out, as how much of each pixel it covers, in the
// frame's pixels however its containers turn it.
import type { Canvas, CanvasKit } from '@dazbee/canvaskit'
import { boundsOf, type Point, turn } from '@dazbee/doc'
import { drawLayers, type Resources, type SceneLayer } from '@dazbee/renderer'
import type { Rect } from '@dazbee/schema'

/** A container's rotation, which turns the layers inside it about the container's centre. */
export interface Turn {
  about: Point
  degrees: number
}

/** What a layer draws by itself over a region of its frame, as a mask. */
export interface Ink {
  /** The region, in the frame's pixels. */
  region: Rect
  /** How many pixels of the mask make one of the frame, each way. */
  scale: number
  width: number
  height: number
  /** How much of each pixel the layer covers, 0 to 255, row by row. */
  alpha: Uint8Array
  /** The most coverage any pixel has; ink is a pixel with at least half of it. */
  most: number
}

/** A region of a frame drawn on the CPU surface, as unpremultiplied RGBA, row by row. */
export interface DrawnRegion {
  width: number
  height: number
  pixels: Uint8Array
}

/** The most pixels a region is drawn with for a check: a bigger region is drawn smaller. */
const MAX_DRAWN_PIXELS = 4_000_000

/** The box around `corners` once each container's rotation in `turns`, innermost first, has turned them. */
export function placed(corners: readonly Point[], turns: readonly Turn[]): Rect {
  const points = corners.map((corner) => turns.reduceRight((p, { about, degrees }) => turn(p, about, degrees), corner))
  return boundsOf(points.map((p) => ({ ...p, width: 0, height: 0, rotation: 0 })))
}

/** `wanted` pixels to one of the frame, or fewer when the region would take more than MAX_DRAWN_PIXELS. */
export function fitScale(region: Rect, wanted: number): number {
  const area = region.width * region.height * wanted * wanted
  return area > MAX_DRAWN_PIXELS ? wanted * Math.sqrt(MAX_DRAWN_PIXELS / area) : wanted
}

/**
 * The ink `layer` puts in `region` of its frame, turned by `turns` and drawn `scale` times the frame's
 * size, or less as fitScale allows. Nothing outside the frame is cut off, so a mask may hold ink past
 * the frame's edge.
 */
export function inkOf(
  ck: CanvasKit,
  layer: SceneLayer,
  turns: readonly Turn[],
  resources: Resources,
  region: Rect,
  scale = 1,
): Ink {
  const fitted = fitScale(region, scale)
  const bare = {
    ...layer,
    props: { ...layer.props, effects: [], opacity: 1, blendMode: 'normal' },
  } as SceneLayer
  const drawn = drawnRegion(ck, region, fitted, (canvas) => {
    for (const { about, degrees } of turns) canvas.rotate(degrees, about.x, about.y)
    drawLayers(ck, canvas, [bare], resources)
  })
  const alpha = new Uint8Array(drawn.width * drawn.height)
  let most = 0
  for (let i = 0; i < alpha.length; i++) {
    const a = drawn.pixels[i * 4 + 3] ?? 0
    alpha[i] = a
    if (a > most) most = a
  }
  return { region, scale: fitted, width: drawn.width, height: drawn.height, alpha, most }
}

/** Draws `region` of a frame with `draw`, `scale` pixels to one of the frame, on a CPU surface, and reads it back. */
export function drawnRegion(ck: CanvasKit, region: Rect, scale: number, draw: (canvas: Canvas) => void): DrawnRegion {
  const width = Math.max(1, Math.ceil(region.width * scale))
  const height = Math.max(1, Math.ceil(region.height * scale))
  const surface = ck.MakeSurface(width, height)
  if (!surface) throw new Error(`CanvasKit could not make a ${width}×${height} CPU surface`)
  try {
    const canvas = surface.getCanvas()
    canvas.clear(ck.TRANSPARENT)
    canvas.scale(scale, scale)
    canvas.translate(-region.x, -region.y)
    draw(canvas)
    surface.flush()
    const image = surface.makeImageSnapshot()
    try {
      const pixels = image.readPixels(0, 0, {
        width,
        height,
        colorType: ck.ColorType.RGBA_8888,
        alphaType: ck.AlphaType.Unpremul,
        colorSpace: ck.ColorSpace.SRGB,
      })
      if (!(pixels instanceof Uint8Array)) throw new Error('CanvasKit could not read back the drawn pixels')
      return { width, height, pixels }
    } finally {
      image.delete()
    }
  } finally {
    surface.dispose()
  }
}

/** How much ink, in the frame's square pixels, lies where `at` holds of a pixel's centre in the frame. */
export function inkWhere(ink: Ink, at: (x: number, y: number) => boolean): number {
  let count = 0
  for (let row = 0; row < ink.height; row++) {
    const y = ink.region.y + (row + 0.5) / ink.scale
    for (let col = 0; col < ink.width; col++) {
      if (inked(ink, row * ink.width + col) && at(ink.region.x + (col + 0.5) / ink.scale, y)) count++
    }
  }
  return count / (ink.scale * ink.scale)
}

/** How much of the frame, in square pixels, both layers put ink on, read at the finer of their two scales. */
export function sharedInk(a: Ink, b: Ink): number {
  const left = Math.max(a.region.x, b.region.x)
  const top = Math.max(a.region.y, b.region.y)
  const right = Math.min(a.region.x + a.region.width, b.region.x + b.region.width)
  const bottom = Math.min(a.region.y + a.region.height, b.region.y + b.region.height)
  if (right <= left || bottom <= top) return 0
  const step = 1 / Math.max(a.scale, b.scale)
  let count = 0
  for (let y = top + step / 2; y < bottom; y += step)
    for (let x = left + step / 2; x < right; x += step) if (inkedAt(a, x, y) && inkedAt(b, x, y)) count++
  return count * step * step
}

/** Whether the layer puts ink on the frame's point (x, y). */
function inkedAt(ink: Ink, x: number, y: number): boolean {
  const col = Math.floor((x - ink.region.x) * ink.scale)
  const row = Math.floor((y - ink.region.y) * ink.scale)
  if (col < 0 || row < 0 || col >= ink.width || row >= ink.height) return false
  return inked(ink, row * ink.width + col)
}

/** Whether pixel `i` of a mask is ink: covered at least half as much as its most covered pixel. */
function inked(ink: Ink, i: number): boolean {
  return ink.most > 0 && (ink.alpha[i] ?? 0) * 2 >= ink.most
}
