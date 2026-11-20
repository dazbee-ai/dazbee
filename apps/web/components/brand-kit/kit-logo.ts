// The kit's logo as an asset of the brand's library, which says whether it is an image a picture
// can follow (`brand:logo`) or an SVG file. Assets the app has listed are remembered by id, so the
// Brand flyout knows the logo at once; one not listed yet is looked up in the library.
import { AssetSummary, type BrandKit, brandVariables, type Variables } from '@dazbee/schema'

import { brandPath } from '@/lib/brand-routes.ts'

/** Assets the app has listed, by id. An asset's bytes and type never change, so they are kept. */
const known = new Map<string, AssetSummary>()

/** Remembers assets the app has listed, such as the library's or a new upload. */
export function rememberAssets(assets: readonly AssetSummary[]) {
  for (const asset of assets) known.set(asset.id, asset)
}

/** The kit's logo by its id, when the app has listed it; undefined for no logo. */
export function knownLogo(logoAssetId: string | null): AssetSummary | undefined {
  return logoAssetId ? known.get(logoAssetId) : undefined
}

/**
 * The kit's logo by its id, looked up in the brand's library when not listed yet; undefined
 * offline, or when the library has it no longer.
 */
export async function kitLogo(
  workspaceId: string,
  brandId: string,
  logoAssetId: string | null,
): Promise<AssetSummary | undefined> {
  if (!logoAssetId || knownLogo(logoAssetId)) return knownLogo(logoAssetId)
  const response = await fetch(brandPath(workspaceId, brandId, 'assets')).catch(() => null)
  if (response?.ok) {
    const listed = AssetSummary.array().safeParse(await response.json().catch(() => null))
    if (listed.success) rememberAssets(listed.data)
  }
  return knownLogo(logoAssetId)
}

/** The values the kit gives its tokens, the logo's included once it is known. */
export async function kitVariables(workspaceId: string, brandId: string, kit: BrandKit): Promise<Variables> {
  return brandVariables(kit, await kitLogo(workspaceId, brandId, kit.logoAssetId))
}
