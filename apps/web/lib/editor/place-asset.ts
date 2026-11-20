// Puts an asset from the library on the stage: an image as a graphic filled with it, an SVG
// file as the layers it draws, once the pictures it shows have uploaded, and says whether a click
// on one in Assets arms it for the pointer instead. An SVG's bytes come through the web app as text
// and are read by the editor, never by the browser's image decoder.
import type { Editor, PlaceImageOptions, Point } from '@dazbee/editor'
import { type AssetSummary, isVectorAsset } from '@dazbee/schema'

import { brandPath } from '@/lib/brand-routes.ts'

export type Placeable = Pick<AssetSummary, 'id' | 'name' | 'width' | 'height' | 'contentType'>

/**
 * Whether a click on an asset in Assets arms it, to place with the next click or drag on a frame,
 * rather than placing it at once: an image clicked with a mouse or a pen, which carries it there. A
 * key clicks with no pointer (`detail` 0), and a tap has none to follow, so they place at once, as
 * an SVG file always is.
 */
export function armsOnClick(asset: Placeable, pointerType: string | null, detail: number) {
  return !isVectorAsset(asset) && detail > 0 && (pointerType === 'mouse' || pointerType === 'pen')
}

/**
 * Places the asset centred at `client`, or in the middle of the frame in view; an image placed as
 * the brand's logo (`options.logo`) follows the brand's logo. An SVG file is placed as layers, which
 * don't follow.
 */
export function placeAsset(
  editor: Editor,
  workspaceId: string,
  brandId: string,
  asset: Placeable,
  client?: Point,
  options?: PlaceImageOptions,
) {
  if (!isVectorAsset(asset)) {
    editor.placeImage(asset, client, options)
    return
  }
  // Offline, nothing is placed; the library shows the asset is there to try again.
  void placeSvg(editor, workspaceId, brandId, asset, client).catch(() => undefined)
}

/**
 * Reads an SVG asset where it goes, which uploads its pictures, and places it once no gesture is
 * open on the editor.
 */
async function placeSvg(editor: Editor, workspaceId: string, brandId: string, asset: Placeable, client?: Point) {
  const read = await editor.readSvg(await svgOf(workspaceId, brandId, asset.id), asset.name || 'SVG', client)
  if (read) await editor.placeWhenSettled(read)
}

/** An SVG asset's markup. */
async function svgOf(workspaceId: string, brandId: string, assetId: string): Promise<string> {
  const response = await fetch(brandPath(workspaceId, brandId, 'assets', assetId))
  if (!response.ok) throw new Error(`the SVG didn't load (${response.status})`)
  return response.text()
}
