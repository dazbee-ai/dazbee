// The size a reference picture is sent to GPT Image at. OpenAI counts a reference in patches of 32 px a side, never
// fewer than 576 and never more than 1,536, and bills each patch as one image input token; the model takes no
// setting for how closely it reads a reference (`docs/research/ai-flow-image-models.md`, measured 26 Nov 2026). So a
// reference counted as more than 576 patches is sent as a copy scaled down to fit them, which costs the fewest
// tokens a reference can; a smaller one is sent as it is. The copy is drawn with our CanvasKit build on its CPU
// surface, from the stored bytes.
import { loadCanvasKit } from '@dazbee/renderer/node'
import { readImageHeader } from '@dazbee/schema'

/** The side of a patch OpenAI counts a reference picture in, in pixels. */
const PATCH = 32

/** The fewest patches OpenAI counts for a reference, however small: the most a reference is sent at. */
export const REFERENCE_PATCHES = 576

/** How many patches OpenAI counts for a picture of `size`, before its floor and its ceiling. */
export function patchesOf({ width, height }: { width: number; height: number }): number {
  return Math.ceil(width / PATCH) * Math.ceil(height / PATCH)
}

/**
 * The largest size of `size`'s ratio that counts as at most `REFERENCE_PATCHES` patches; `size` itself when it
 * counts as no more.
 */
export function referenceSize(size: { width: number; height: number }): { width: number; height: number } {
  if (patchesOf(size) <= REFERENCE_PATCHES) return size
  const ratio = size.width / size.height
  // From a patch wider than a size of exactly that many pixels, a pixel narrower at a time.
  const widest = Math.min(size.width, Math.ceil(Math.sqrt(REFERENCE_PATCHES * PATCH * PATCH * ratio)) + PATCH)
  for (let width = widest; width > 1; width--) {
    const fitted = { width, height: Math.max(1, Math.round(width / ratio)) }
    if (patchesOf(fitted) <= REFERENCE_PATCHES) return fitted
  }
  return { width: 1, height: 1 }
}

/**
 * `picture` as GPT Image is sent it: the same bytes when it counts as at most `REFERENCE_PATCHES` patches or isn't
 * a picture whose header we read, otherwise a PNG copy scaled down to `referenceSize`, its transparency kept.
 */
export async function sizedReference(picture: Uint8Array): Promise<Uint8Array> {
  const header = readImageHeader(picture)
  if (!header) return picture
  const size = referenceSize(header)
  if (size.width === header.width && size.height === header.height) return picture
  const ck = await loadCanvasKit()
  const decoded = ck.MakeImageFromEncoded(picture)
  if (!decoded) return picture
  // Mipmaps, so a picture drawn at a fraction of its size is averaged, not sampled.
  const image = decoded.makeCopyWithDefaultMipmaps()
  const surface = ck.MakeSurface(size.width, size.height)
  try {
    if (!surface) throw new Error(`no surface of ${size.width} × ${size.height}`)
    const canvas = surface.getCanvas()
    canvas.clear(ck.TRANSPARENT)
    canvas.drawImageRectOptions(
      image,
      ck.XYWHRect(0, 0, image.width(), image.height()),
      ck.XYWHRect(0, 0, size.width, size.height),
      ck.FilterMode.Linear,
      ck.MipmapMode.Linear,
    )
    const snapshot = surface.makeImageSnapshot()
    const png = snapshot.encodeToBytes()
    snapshot.delete()
    if (!png) throw new Error('the reference picture could not be encoded')
    return png
  } finally {
    surface?.delete()
    image.delete()
    decoded.delete()
  }
}
