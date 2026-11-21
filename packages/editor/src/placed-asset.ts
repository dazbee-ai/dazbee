// The layers an asset of the brand's library becomes when it is placed in a frame, as the editor
// places it and an agent's place_asset does: an image as a graphic filled with it, as the brand's
// logo named so, given the logo's role and bound to `brand:logo`; and an SVG file as a group of the
// layers it draws, centred where it goes, scaled down to fit the frame or scaled to fit a box.
import type { CanvasKit } from '@dazbee/canvaskit'
import { brandRef, type LayerTree, LOGO_ROLE, type Point, type Rect } from '@dazbee/schema'
import { type Skipped, type SvgImage, svgToLayers } from '@dazbee/svg'

import { imageIn, newImage, type NewLayer } from './gestures/drawing/draw-tools.ts'
import { round } from './layers/transform.ts'

export { SvgError } from '@dazbee/svg'

/** An SVG file as the layers placing puts down, with the uploaded pictures' assets. */
export interface SvgLayers {
  tree: LayerTree
  /** The group that holds the file's layers. */
  root: string
  /** What the file had that no layer shows. */
  leftOut: readonly Skipped[]
  /** How many of its pictures didn't upload, so no layer shows them. */
  notUploaded: number
}

/** How an SVG file is read for placing. */
export interface SvgPlacing {
  /** The group's name. */
  name: string
  /** The frame it goes in: a file larger than SVG_ROOM of its shorter side is scaled down to that. */
  frame: { width: number; height: number }
  /** The size to fit the file in instead, its shape kept: scaled up or down until it meets the nearer sides. */
  box?: { width: number; height: number }
  /**
   * Uploads the pictures the file shows, each distinct one once, giving the asset each that uploaded
   * became, by its key; without it, the pictures are left out.
   */
  upload?: (pictures: readonly SvgImage[]) => Promise<Readonly<Record<string, { id: string }>>>
}

/** What design.place takes to put an SVG file's layers in a frame. */
export interface SvgPlaceInput {
  parentId: string
  tree: LayerTree
  dx: number
  dy: number
}

/** The share of a frame's shorter side a placed SVG may take before it is scaled down to it. */
const SVG_ROOM = 0.6

/**
 * The graphic an image asset becomes, filled with it: centred on a point at its own size, or
 * smaller to take at most half the frame's width and height, its shape kept; or covering a box. As
 * the brand's logo (`options.logo`), named so and given the logo's role, for `logoBinding` to bind.
 */
export function placedImage(
  asset: { id: string; name: string; width: number; height: number },
  frame: { width: number; height: number },
  where: Point | Rect,
  { logo }: { logo?: { name: string } } = {},
): NewLayer & { role?: string } {
  const layer = 'width' in where ? imageIn(asset, where) : newImage(asset, where, frame)
  return { ...layer, ...(logo ? { name: logo.name, role: LOGO_ROLE } : {}) }
}

/** What node.bind takes, beside the ids, to bind a logo's picture to the brand's logo. */
export function logoBinding(assetId: string) {
  return { property: 'image', ref: brandRef(LOGO_ROLE), value: assetId } as const
}

/**
 * An SVG file read as the layers placing puts down: converted, scaled as `placing` says, and the
 * pictures it shows uploaded. It throws `SvgError` for a file it can't read.
 */
export async function svgLayers(ck: CanvasKit, text: string, placing: SvgPlacing): Promise<SvgLayers> {
  const { name, upload } = placing
  const natural = svgToLayers(ck, text, { name })
  const fit = fitOf(natural, placing)
  const assets = upload ? await upload(natural.images) : {}
  const assetIds = Object.fromEntries(Object.entries(assets).map(([key, asset]) => [key, asset.id]))
  const made = natural.images.length > 0 || 'fit' in fit ? svgToLayers(ck, text, { name, ...fit, assetIds }) : natural
  // Without an uploader the pictures have no assets, so they are left out.
  const leftOut =
    natural.images.length > 0 && !upload && !made.skipped.includes('image')
      ? [...made.skipped, 'image' as const]
      : made.skipped
  const notUploaded = upload ? natural.images.filter((image) => !(image.key in assetIds)).length : 0
  return { tree: made.tree, root: made.root, leftOut, notUploaded }
}

/**
 * What design.place takes to put an SVG file's layers in `parentId`, their group centred on
 * `centre`; null for layers with no group.
 */
export function svgPlaceInput(
  { tree, root }: Pick<SvgLayers, 'tree' | 'root'>,
  parentId: string,
  centre: Point,
): SvgPlaceInput | null {
  const box = tree.nodes[root]?.props
  if (!box) return null
  return {
    parentId,
    tree,
    dx: round(centre.x - (box.x + box.width / 2)),
    dy: round(centre.y - (box.y + box.height / 2)),
  }
}

/** The longer side a file of `natural`'s size is scaled to, as `placing` says; none at its own size. */
function fitOf(natural: { width: number; height: number }, { frame, box }: SvgPlacing): { fit?: number } {
  const longer = Math.max(natural.width, natural.height)
  if (box) return { fit: longer * Math.min(box.width / natural.width, box.height / natural.height) }
  const room = Math.min(frame.width, frame.height) * SVG_ROOM
  return longer > room ? { fit: room } : {}
}
