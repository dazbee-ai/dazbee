// Marks reach every picture seller the same way: drawn over a copy of the call's first reference picture and
// sent as one more reference, since some sellers (Meta) take no mask. Drawn with our CanvasKit build on its CPU
// surface, from the stored bytes.
import { loadCanvasKit } from '@dazbee/renderer/node'

/** The longest side of a marked copy: the worker has 256 MB, and no seller takes a bigger reference at our sizes. */
export const MARKED_SIDE = 2048

/**
 * The first reference `picture` with `marks` (a picture with transparency) drawn over it, stretched to the
 * picture's size, as a PNG; scaled down to fit `MARKED_SIDE` when the picture is bigger.
 */
export async function drawMarks(picture: Uint8Array, marks: Uint8Array): Promise<Uint8Array> {
  const ck = await loadCanvasKit()
  const base = ck.MakeImageFromEncoded(picture)
  if (!base) throw new Error('the picture under the marks is not a picture')
  const over = ck.MakeImageFromEncoded(marks)
  if (!over) {
    base.delete()
    throw new Error('the marks are not a picture')
  }
  const scale = Math.min(1, MARKED_SIDE / Math.max(base.width(), base.height()))
  const width = Math.max(1, Math.round(base.width() * scale))
  const height = Math.max(1, Math.round(base.height() * scale))
  const surface = ck.MakeSurface(width, height)
  const paint = new ck.Paint()
  try {
    if (!surface) throw new Error(`no surface of ${width} × ${height}`)
    const canvas = surface.getCanvas()
    canvas.clear(ck.TRANSPARENT)
    canvas.drawImageRect(base, ck.XYWHRect(0, 0, base.width(), base.height()), ck.XYWHRect(0, 0, width, height), paint)
    canvas.drawImageRect(over, ck.XYWHRect(0, 0, over.width(), over.height()), ck.XYWHRect(0, 0, width, height), paint)
    const snapshot = surface.makeImageSnapshot()
    const png = snapshot.encodeToBytes()
    snapshot.delete()
    if (!png) throw new Error('the marked picture could not be encoded')
    return png
  } finally {
    paint.delete()
    surface?.delete()
    base.delete()
    over.delete()
  }
}
