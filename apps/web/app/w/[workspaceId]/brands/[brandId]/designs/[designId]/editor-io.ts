// What the editor loads through the app's own routes: an asset's bytes, the brand's font files and
// its brand kit's values, and the pictures of an SVG file it uploads; and asking the offline worker
// to keep the page.
import type { FontSources } from '@dazbee/editor'
import { BrandKit, FontFamily, type Variables } from '@dazbee/schema'

import { kitVariables } from '@/components/brand-kit/kit-logo.ts'
import { OPENING_POSES } from '@/components/editor/design-opening.ts'
import { mascotSrc } from '@/components/ui/mascot.tsx'
import { brandPath } from '@/lib/brand-routes.ts'
import { sendAsset } from '@/lib/upload-asset.ts'

/** The file extension of each picture type an SVG file's pictures are sniffed as. */
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

export async function assetBytes(workspaceId: string, brandId: string, assetId: string) {
  const response = await fetch(brandPath(workspaceId, brandId, 'assets', assetId))
  if (!response.ok) throw new Error(`asset ${assetId}: ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * The faces of the families the editor asks for, from the brand's catalog, fetched once and
 * again when a family isn't in it yet, as after an upload; and the file of each face it asks for.
 */
export function fontLoader(workspaceId: string, brandId: string): Required<FontSources> {
  let catalog: Promise<FontFamily[]> | null = null
  const fetchCatalog = async () => {
    const response = await fetch(brandPath(workspaceId, brandId, 'fonts'))
    if (!response.ok) throw new Error(`fonts: ${response.status}`)
    return FontFamily.array().parse(await response.json())
  }
  return {
    fontFaces: async (families) => {
      let known = await (catalog ??= fetchCatalog()).catch((error: unknown) => {
        catalog = null
        throw error
      })
      if (families.some((family) => !known.some((f) => f.family === family))) known = await (catalog = fetchCatalog())
      return known.filter((f) => families.includes(f.family)).flatMap((f) => f.faces)
    },
    fontFile: async (face) => {
      const response = await fetch(brandPath(workspaceId, brandId, 'fonts', face.id))
      if (!response.ok) throw new Error(`font ${face.family} ${face.weight}: ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    },
  }
}

/**
 * Uploads a picture of an SVG file placed into the brand's library, as the library's own upload
 * sends a file, named as the editor names it; the web app checks its bytes again.
 */
export function imageUploader(workspaceId: string, brandId: string) {
  return async (bytes: Uint8Array, type: string, name: string) => {
    const file = new File([new Uint8Array(bytes)], `${name}.${EXTENSIONS[type] ?? 'png'}`, { type })
    const asset = await sendAsset(workspaceId, brandId, file, () => undefined)
    return { id: asset.id, name: asset.name, width: asset.width, height: asset.height }
  }
}

/**
 * The values of the brand kit's tokens, its logo's included, for layers bound to them. Without
 * a connection the editor starts without them, and bound layers keep the values they were bound with.
 */
export async function brandKitVariables(workspaceId: string, brandId: string): Promise<Variables | undefined> {
  const response = await fetch(brandPath(workspaceId, brandId, 'kit', 'data')).catch(() => null)
  if (!response?.ok) return undefined
  return kitVariables(workspaceId, brandId, BrandKit.parse(await response.json()))
}

/**
 * Asks the offline worker to keep this page, everything it has loaded so far, and the pictures of the
 * bee a design opening shows, so a design that can't be opened offline still shows its bee.
 */
export async function keepForOffline() {
  if (!('serviceWorker' in navigator)) return
  const registration = await navigator.serviceWorker.ready
  const urls = [
    location.href,
    ...performance.getEntriesByType('resource').map((entry) => entry.name),
    ...OPENING_POSES.map(mascotSrc),
  ]
  registration.active?.postMessage({ type: 'keep', urls })
}
