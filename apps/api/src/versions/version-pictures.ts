// A version's picture for the Versions card: its cover frame, drawn on the CPU surface on the
// drawing thread design pictures use (ADR-0005), with the brand's fonts and images, at most 320 px on
// its long side. It is drawn the first time it is asked for and kept in the version's row, so it
// goes with the version; two requests for one picture draw it once.
import { type Db, setVersionThumbnail, versionThumbnail } from '@dazbee/db'
import type { Storage } from '@dazbee/storage'

import { coverOf, drawCover } from '../drawing/design-thumbnails.ts'
import { inDrawingTurn } from '../drawing/drawing-turn.ts'
import { brandResourcesFor } from '../drawing/render.ts'
import { versionDesign } from './versions.ts'

/** The longest side of a version's picture: the card's row on a 2× screen. */
export const VERSION_PICTURE_SIZE = 320

/** Each version's picture being drawn, by its design's id and its own: a request finds only its own design's. */
const drawing = new Map<string, Promise<Uint8Array | null>>()

/**
 * The picture of version `versionId` of design `designId`, a design of brand `brandId` in the
 * workspace, as PNG bytes, drawn now when it has none; null for a version with no frame, or none of
 * this design.
 */
export async function versionPicture(
  db: Db,
  storage: Storage,
  workspaceId: string,
  brandId: string,
  designId: string,
  versionId: string,
): Promise<Uint8Array | null> {
  const key = `${designId}/${versionId}`
  const drawingNow = drawing.get(key)
  if (drawingNow) return drawingNow
  const kept = await versionThumbnail(db, designId, versionId)
  if (kept) return kept
  let drawn = drawing.get(key)
  if (!drawn) {
    drawn = (async () => {
      const design = await versionDesign(db, designId, versionId)
      const cover = design && coverOf(design)
      if (!design || !cover) return null
      const png = await inDrawingTurn(async () =>
        drawCover(
          design,
          cover,
          VERSION_PICTURE_SIZE,
          await brandResourcesFor(db, storage, workspaceId, brandId, design),
        ),
      )
      await setVersionThumbnail(db, designId, versionId, png)
      return png
    })().finally(() => drawing.delete(key))
    drawing.set(key, drawn)
  }
  return drawn
}
