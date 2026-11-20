// Brand kits (#53): one per brand, its colours, fonts and text styles that designs bind to as
// `brand:<token>`, its logo and its tone of voice. A brand that never saved one has the empty kit.
import { and, eq } from 'drizzle-orm'

import { brandKits, type Db } from '@dazbee/db'
import { BrandKit, EMPTY_BRAND_KIT, type SaveBrandKit, type StoredBrandKit } from '@dazbee/schema'

import { findAsset } from '../assets/assets.ts'

export class InvalidKit extends Error {}
/** A save made from a kit saved since; thrown inside the save so it writes nothing, not even a new row. */
class KitChanged extends Error {}

export async function getBrandKit(db: Db, workspaceId: string, brandId: string): Promise<StoredBrandKit> {
  const [row] = await db
    .select()
    .from(brandKits)
    .where(and(eq(brandKits.brandId, brandId), eq(brandKits.workspaceId, workspaceId)))
  return row ? storedKit(row) : { ...EMPTY_BRAND_KIT, updatedAt: null }
}

/**
 * Saves the brand's whole kit. Its logo has to be an asset of the same brand. A save that leaves
 * the text styles out keeps the ones the kit has, and is refused when the kit it makes with them
 * isn't one, such as when one of its tokens names one of them. A save made from a kit saved since
 * (`basedOn` isn't the stored kit's `updatedAt`) writes nothing and gives `'changed'`.
 */
export async function saveBrandKit(
  db: Db,
  workspaceId: string,
  brandId: string,
  kit: SaveBrandKit,
): Promise<StoredBrandKit | 'changed'> {
  if (kit.logoAssetId && !(await findAsset(db, workspaceId, brandId, { id: kit.logoAssetId })))
    throw new InvalidKit('The logo is not an asset of this brand')
  const { textStyles, basedOn, ...rest } = kit
  const mine = and(eq(brandKits.brandId, brandId), eq(brandKits.workspaceId, workspaceId))
  try {
    return await db.transaction(async (tx) => {
      // The kit's row, made when missing, is held until the save ends, so saves of one kit run one at
      // a time, and the kit checked below is the one the save replaces.
      const made = await tx
        .insert(brandKits)
        .values({ brandId, workspaceId })
        .onConflictDoNothing()
        .returning({ brandId: brandKits.brandId })
      const [held] = await tx
        .select({ textStyles: brandKits.textStyles, updatedAt: brandKits.updatedAt })
        .from(brandKits)
        .where(mine)
        .for('update')
      // A row this save made holds no kit yet: the brand never saved one.
      const stored = made.length > 0 || !held ? null : held.updatedAt.getTime()
      if (basedOn !== undefined && (basedOn === null ? null : Date.parse(basedOn)) !== stored) throw new KitChanged()
      if (!textStyles) {
        const merged = BrandKit.safeParse({ ...rest, textStyles: held?.textStyles ?? [] })
        if (!merged.success) throw new InvalidKit(merged.error.issues.map((i) => i.message).join('; '))
      }
      // Each save is later than the one before, even within a millisecond, so `basedOn` names one save.
      const updatedAt = new Date(Math.max(Date.now(), (stored ?? 0) + 1))
      // The kit as this save left it, not as a save after it may have.
      const [saved] = await tx
        .update(brandKits)
        .set({ ...rest, ...(textStyles ? { textStyles } : {}), updatedAt })
        .where(mine)
        .returning()
      if (!saved) throw new Error('The kit held for the save is gone')
      return storedKit(saved)
    })
  } catch (e) {
    if (e instanceof KitChanged) return 'changed'
    throw e
  }
}

function storedKit(row: typeof brandKits.$inferSelect): StoredBrandKit {
  return {
    colors: row.colors,
    fonts: row.fonts,
    logoAssetId: row.logoAssetId,
    voice: row.voice,
    textStyles: row.textStyles,
    updatedAt: row.updatedAt.toISOString(),
  }
}
