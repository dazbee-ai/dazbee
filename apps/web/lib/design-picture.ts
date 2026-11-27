// Where a design's picture is read: the design's thumbnail route, at an address that names the version it shows, so
// the browser keeps each one and never shows an older one: the design's last edit, and the AI draft its cover frame
// shows while no tab has written it into the design.
import type { DesignCover, DesignSummary } from '@dazbee/schema'

import { brandPath } from './brand-routes.ts'

/** The address of the picture of `design`, whose cover is `cover` when known. */
export function designPictureSrc(
  workspaceId: string,
  brandId: string,
  design: Pick<DesignSummary, 'id' | 'updatedAt'>,
  cover?: Pick<DesignCover, 'draftAssetId'> | null,
): string {
  const version = `${Date.parse(design.updatedAt)}${cover?.draftAssetId ? `-${cover.draftAssetId}` : ''}`
  return `${brandPath(workspaceId, brandId, 'designs', design.id, 'thumbnail')}?v=${version}`
}
