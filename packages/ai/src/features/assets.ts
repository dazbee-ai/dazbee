// The pictures a flow job makes become assets of its brand: the worker records each on the original's own key,
// with its SHA-256 and image header, named from the brief. Thumbnails are made when the images first ask.
import { createHash } from 'node:crypto'

import { and, eq } from 'drizzle-orm'

import { aiBriefs, assets, type Db, newId, type Tx } from '@dazbee/db'
import { briefTitle, readImageHeader } from '@dazbee/schema'

import type { PictureAssets } from '../call.ts'

/**
 * Records pictures as assets of `brand` in `workspace`, named `name`; a brand of another workspace is refused by the
 * assets table's own key. The same bytes give back the brand's asset of
 * them, brought back to its images if it was deleted.
 */
export function pictureAssets({ workspace, brand, name }: { workspace: string; brand: string; name: string }) {
  const record: PictureAssets['record'] = async (tx, { key, bytes }, tag) => {
    const header = readImageHeader(bytes)
    if (!header) throw new Error(`the picture ${key} is not a PNG, JPEG or WebP image`)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    await tx
      .insert(assets)
      .values({
        id: newId(),
        workspaceId: workspace,
        brandId: brand,
        sha256,
        byteSize: bytes.length,
        name,
        tags: [tag],
        ...header,
      })
      .onConflictDoNothing()
    const [row] = await tx
      .update(assets)
      .set({ deletedAt: null })
      .where(and(eq(assets.workspaceId, workspace), eq(assets.brandId, brand), eq(assets.sha256, sha256)))
      .returning({ id: assets.id })
    if (!row) throw new Error(`the asset of ${key} was not recorded`)
    return row.id
  }
  return { record } satisfies PictureAssets
}

/** What a job's pictures are named: the title of the workspace's brief `briefId`, or of `words` without one. */
export async function pictureName(
  db: Db | Tx,
  workspace: string,
  briefId: string | undefined,
  words: string,
): Promise<string> {
  if (!briefId) return briefTitle(words)
  const [row] = await db
    .select({ words: aiBriefs.words })
    .from(aiBriefs)
    .where(and(eq(aiBriefs.id, briefId), eq(aiBriefs.workspaceId, workspace)))
  return briefTitle(row?.words ?? words)
}
