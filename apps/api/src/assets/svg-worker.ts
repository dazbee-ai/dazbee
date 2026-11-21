// SVG files in the asset library. They are never decoded as images: the bytes are read as
// layers by @dazbee/svg, which refuses what it can't read or what would run away, and the
// thumbnail is those layers drawn by the renderer, as the editor will draw them once placed. Only
// the pictures a file embeds are decoded, by CanvasKit, to leave out any that can't be drawn.
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { renderDesign } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type ImageHeader, MAX_SVG_BYTES } from '@dazbee/schema'
import { SVG_TYPE, SvgError, svgMarkup, svgToLayers } from '@dazbee/svg'

/** An SVG file's type and size, its sides rounded up to whole pixels; null when it isn't one we can read as layers. */
export async function readSvgHeader(bytes: Uint8Array): Promise<ImageHeader | null> {
  const text = svgText(bytes)
  if (!text) return null
  try {
    const { width, height } = svgToLayers(await loadCanvasKit(), text)
    return { contentType: SVG_TYPE, width: Math.max(1, Math.ceil(width)), height: Math.max(1, Math.ceil(height)) }
  } catch (error) {
    if (error instanceof SvgError) return null
    throw error
  }
}

/** The file's layers drawn in a see-through frame, `size` pixels on the longer side, as a PNG. */
export async function svgThumbnail(bytes: Uint8Array, size: number): Promise<Uint8Array> {
  const text = svgText(bytes)
  if (!text) throw new Error('not an SVG file')
  const ck = await loadCanvasKit()
  const read = svgToLayers(ck, text, { fit: size })
  // Only the pictures CanvasKit decodes are drawn: one with a good header and a broken body is left out.
  const images = Object.fromEntries(
    read.images.filter((image) => decodes(ck, image.bytes)).map((i) => [i.key, i.bytes]),
  )
  const kept = Object.keys(images).length === read.images.length ? read : withoutBroken(ck, text, size, images)
  const { width, height } = read
  const nodes = kept
    ? Object.fromEntries(
        Object.entries(kept.tree.nodes).map(([id, node]) => [
          id,
          id === kept.root ? { ...node, parentId: 'f', index: 'a0' } : node,
        ]),
      )
    : {}
  const design = {
    meta: { designId: 'thumbnail', name: 'Thumbnail' },
    pages: { page: { name: 'Page', order: 'a0' } },
    frames: {
      f: {
        pageId: 'page',
        name: 'Thumbnail',
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
        x: 0,
        y: 0,
        order: 'a0',
      },
    },
    nodes,
  }
  return renderDesign(ck, design, 'f', {
    fonts: loadFontFiles(),
    fallbackFamilies: [...FALLBACK_FAMILIES],
    images,
  }).png
}

/**
 * The file's layers without the pictures CanvasKit can't decode; null when nothing else is in it,
 * which draws a clear thumbnail: such a picture never makes the file refused.
 */
function withoutBroken(
  ck: Awaited<ReturnType<typeof loadCanvasKit>>,
  text: string,
  size: number,
  images: Record<string, Uint8Array>,
) {
  try {
    return svgToLayers(ck, text, { fit: size, assetIds: Object.fromEntries(Object.keys(images).map((k) => [k, k])) })
  } catch (error) {
    if (error instanceof SvgError && error.problem === 'empty') return null
    throw error
  }
}

/**
 * Whether CanvasKit makes an image of the picture, as the renderer will need to: it makes none of a
 * good header over a stream it can't inflate. A stream that ends early still makes one, its missing
 * rows clear, as browsers draw it.
 */
function decodes(ck: Awaited<ReturnType<typeof loadCanvasKit>>, bytes: Uint8Array) {
  const image = ck.MakeImageFromEncoded(bytes)
  image?.delete()
  return image !== null
}

/** The bytes as SVG markup: UTF-8 text whose first element is <svg>. Null for anything else. */
function svgText(bytes: Uint8Array): string | null {
  if (bytes.length > MAX_SVG_BYTES) return null
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
  return svgMarkup(text)
}
