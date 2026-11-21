import type { Converted, ConvertOptions } from '@dazbee/svg'

import type { Spot } from './canvas/view.ts'
import type { SvgRead } from './place-svg.ts'
import type { EditorUploads } from './uploads.ts'

/** The share of a frame's shorter side a placed SVG may take before it is scaled down to it. */
const SVG_ROOM = 0.6

export async function svgLayers(
  text: string,
  name: string,
  frame: { width: number; height: number },
  spot: Spot,
  uploads: EditorUploads,
  signal: AbortSignal,
  converted: (text: string, options: ConvertOptions) => Converted | null,
): Promise<SvgRead | null> {
  const natural = converted(text, { name })
  if (!natural) return null
  const room = Math.min(frame.width, frame.height) * SVG_ROOM
  const fit = Math.max(natural.width, natural.height) > room ? { fit: room } : {}
  const uploader = uploads.can()
  const assets = uploader ? await uploads.upload(natural.images) : {}
  const assetIds = Object.fromEntries(Object.entries(assets).map(([key, asset]) => [key, asset.id]))
  if (signal.aborted) return null
  const made = natural.images.length > 0 || 'fit' in fit ? converted(text, { name, ...fit, assetIds }) : natural
  if (!made) return null
  // Without an uploader the pictures have no assets, so they are left out.
  const leftOut =
    natural.images.length > 0 && !uploader && !made.skipped.includes('image')
      ? [...made.skipped, 'image' as const]
      : made.skipped
  const notUploaded = uploader ? natural.images.filter((image) => !(image.key in assetIds)).length : 0
  return { spot, tree: made.tree, root: made.root, leftOut, notUploaded }
}
