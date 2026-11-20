// Brand kits (#53): one per brand, its colours, fonts and text styles that designs bind to as
// `brand:<token>`, its logo and its tone of voice. A brand that never saved one has the empty kit.
import { and, eq } from 'drizzle-orm'

import { brandKits, type Db } from '@dazbee/db'
import { BrandKit, EMPTY_BRAND_KIT, type SaveBrandKit } from '@dazbee/schema'

import { findAsset } from '../assets/assets.ts'

export class InvalidKit extends Error {}

export async function getBrandKit(db: Db, workspaceId: string, brandId: string): Promise<BrandKit> {
  const [row] = await db
    .select()
    .from(brandKits)
    .where(and(eq(brandKits.brandId, brandId), eq(brandKits.workspaceId, workspaceId)))
  return row
    ? {
        colors: row.colors,
        fonts: row.fonts,
        logoAssetId: row.logoAssetId,
        voice: row.voice,
        textStyles: row.textStyles,
      }
    : EMPTY_BRAND_KIT
}

/**
 * Saves the brand's whole kit. Its logo has to be an asset of the same brand. A save that leaves
 * the text styles out keeps the ones the kit has, and is refused when the kit it makes with them
 * isn't one, such as when one of its tokens names one of them.
 */
export async function saveBrandKit(db: Db, workspaceId: string, brandId: string, kit: SaveBrandKit): Promise<BrandKit> {
  if (kit.logoAssetId && !(await findAsset(db, workspaceId, brandId, { id: kit.logoAssetId })))
    throw new InvalidKit('The logo is not an asset of this brand')
  const { textStyles, ...rest } = kit
  if (!textStyles) {
    const kept = await getBrandKit(db, workspaceId, brandId)
    const merged = BrandKit.safeParse({ ...rest, textStyles: kept.textStyles })
    if (!merged.success) throw new InvalidKit(merged.error.issues.map((i) => i.message).join('; '))
  }
  const values = { ...rest, ...(textStyles ? { textStyles } : {}), updatedAt: new Date() }
  await db
    .insert(brandKits)
    .values({ brandId, workspaceId, ...values })
    .onConflictDoUpdate({ target: brandKits.brandId, set: values })
  return getBrandKit(db, workspaceId, brandId)
}
