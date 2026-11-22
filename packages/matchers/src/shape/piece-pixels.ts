// A piece's pixels: the match job's picture decoded with CanvasKit, as every runtime decodes it, and
// cut to the piece's rect, out to whole pixels.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Pixels } from '@dazbee/renderer'
import type { Piece } from '@dazbee/schema'

/**
 * The pixels of the picture under a piece's rect, 8-bit RGBA with straight alpha, from the rect's
 * top left pixel to its bottom right one, taking in every pixel the rect touches.
 */
export function piecePixels(ck: CanvasKit, picture: string, rect: Piece['rect']): Pixels {
  const image = ck.MakeImageFromEncoded(Uint8Array.from(atob(picture), (char) => char.charCodeAt(0)))
  if (!image) throw new Error('the picture is not a PNG CanvasKit reads')
  try {
    const x0 = Math.min(image.width() - 1, Math.floor(rect.x))
    const y0 = Math.min(image.height() - 1, Math.floor(rect.y))
    const width = Math.max(1, Math.min(image.width(), Math.ceil(rect.x + rect.width)) - x0)
    const height = Math.max(1, Math.min(image.height(), Math.ceil(rect.y + rect.height)) - y0)
    const pixels = image.readPixels(x0, y0, {
      width,
      height,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    })
    if (!(pixels instanceof Uint8Array)) throw new Error('could not read the picture’s pixels')
    return { width, height, pixels }
  } finally {
    image.delete()
  }
}
