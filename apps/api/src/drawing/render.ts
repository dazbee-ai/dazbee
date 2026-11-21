// Drawing a design in Node (#54): the same render seam the editor's exports use, with every byte it
// needs read from our storage as the editor reads it: the fonts we ship, the faces of the brand's
// catalog families its texts are drawn in, the originals of its images (the kit's logo where a
// picture follows it), and its brand kit's values. Pictures are drawn one at a time (`inDrawingTurn`).
import type { Db } from '@dazbee/db'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { renderDesign, type Rendered, type ResourceBytes } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { brandVariables, coverFrame, type Design, fontUses, imageAssetIds } from '@dazbee/schema'
import type { Storage } from '@dazbee/storage'

import { findAsset } from '../assets/assets.ts'
import { getBrandKit } from '../brand-kits/brand-kits.ts'
import { fontFiles } from '../fonts/fonts.ts'
import { originalKey } from '../storage-keys.ts'

/** The picture drawn now, or the last one asked for: each starts once the one before it ends. */
let drawingTurn: Promise<unknown> = Promise.resolve()

/**
 * What drawing the design for this brand needs beyond the fonts we ship: the faces of the brand's
 * catalog families its texts are drawn in (`fontUses`), the originals of its images and its brand
 * kit's values. An image the brand has no
 * asset for is left out. A drawing worker that holds the shipped fonts itself needs only this.
 */
export async function brandResourcesFor(
  db: Db,
  storage: Storage,
  workspaceId: string,
  brandId: string,
  design: Design,
): Promise<ResourceBytes> {
  const kit = await getBrandKit(db, workspaceId, brandId)
  const logo = kit.logoAssetId ? await findAsset(db, workspaceId, brandId, { id: kit.logoAssetId }) : null
  const variables = brandVariables(kit, logo ?? undefined)
  const [fonts, images] = await Promise.all([
    fontFiles(db, storage, workspaceId, brandId, fontUses(design, variables)),
    Promise.all(
      imageAssetIds(design, undefined, variables).map(async (id) => {
        const asset = await findAsset(db, workspaceId, brandId, { id })
        const bytes = asset && (await storage.get(originalKey(workspaceId, asset.sha256)))
        return bytes ? [[id, bytes] as const] : []
      }),
    ),
  ])
  return { fonts, fallbackFamilies: [...FALLBACK_FAMILIES], images: Object.fromEntries(images.flat()), variables }
}

/**
 * Runs `draw` once every picture asked for before it has been drawn: a picture reads its font and
 * image bytes inside its turn, so the API holds one design's bytes at a time, not every waiting
 * picture's. A CJK family's face runs to 50 MB.
 */
export function inDrawingTurn<T>(draw: () => Promise<T>): Promise<T> {
  const turn = drawingTurn.then(draw, draw)
  drawingTurn = turn.catch(() => undefined)
  return turn
}

/** The design's cover frame (see `coverFrame`), as an export draws it, in its drawing turn. */
export async function renderCover(
  db: Db,
  storage: Storage,
  workspaceId: string,
  brandId: string,
  design: Design,
): Promise<Rendered> {
  const ck = await loadCanvasKit()
  const cover = coverFrame(design)
  if (!cover) throw new Error('the design has no frame')
  return inDrawingTurn(async () =>
    renderDesign(ck, design, cover[0], await resourcesFor(db, storage, workspaceId, brandId, design)),
  )
}

/** What drawing the design for this brand needs, the shipped fonts included. */
async function resourcesFor(
  db: Db,
  storage: Storage,
  workspaceId: string,
  brandId: string,
  design: Design,
): Promise<ResourceBytes> {
  const resources = await brandResourcesFor(db, storage, workspaceId, brandId, design)
  return { ...resources, fonts: [...loadFontFiles(), ...resources.fonts] }
}
