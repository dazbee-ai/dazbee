// What the editor loads through the app's own routes: an asset's bytes, the brand's font files (a Google
// face's from its permanent address) and its brand kit's values, the pictures of an SVG file it uploads, and what
// the matchers work with; starting the stage's editor once for a stage mounted twice; and asking the offline worker
// to keep the page.
import type { FontSources, MatchSources } from '@dazbee/editor'
import {
  BrandKit,
  EMPTY_BRAND_KIT,
  FontFamily,
  googleFacePaths,
  MOST_FONT_FAMILIES_ASKED,
  type Variables,
} from '@dazbee/schema'

import { loadedCatalog, sharedCatalogRead } from '@/components/brand-kit/font-catalog.ts'
import { kitVariables } from '@/components/brand-kit/kit-logo.ts'
import { OPENING_POSES } from '@/components/editor/design-opening.ts'
import { mascotSrc } from '@/components/ui/mascot.tsx'
import { brandPath } from '@/lib/brand-routes.ts'
import { sharedAsks } from '@/lib/shared-asks.ts'
import { sendAsset } from '@/lib/upload-asset.ts'

/** The file extension of each picture type an SVG file's pictures are sniffed as. */
const EXTENSIONS: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

/** The brand kit's values being asked for, by `<workspace>/<brand>`, shared by a stage mounted again meanwhile. */
const kitAsks = sharedAsks<Variables | undefined>()

export async function assetBytes(workspaceId: string, brandId: string, assetId: string) {
  const response = await fetch(brandPath(workspaceId, brandId, 'assets', assetId))
  if (!response.ok) throw new Error(`asset ${assetId}: ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}

/**
 * Starts the stage's editor with the brand kit's values (`brandKitVariables`), or none when the mount ended first.
 * React's strict mode mounts the stage twice in development and ends the first mount at once: both share one ask for
 * the kit, and only the second starts an editor, so the design's fonts and files are fetched once.
 */
export async function startStageEditor<E>(
  workspaceId: string,
  brandId: string,
  signal: AbortSignal,
  start: (variables: Variables | undefined) => Promise<E>,
): Promise<E | null> {
  const variables = await brandKitVariables(workspaceId, brandId)
  if (signal.aborted) return null
  return start(variables)
}

/**
 * The faces of the families the editor asks for, as the brand sees them, asked of the brand each time: only what the
 * design's texts use, and a family uploaded since is there; offline, from the catalog the page read last; and the file of each face it asks for: a Google face's
 * from its permanent address, which the browser keeps, and an upload's through the brand.
 */
export function fontLoader(workspaceId: string, brandId: string): Required<FontSources> {
  /** The permanent address of each Google face's file the brand listed, by face id. */
  const googleFiles = new Map<string, string>()
  const askFor = async (families: string[]) => {
    const query = new URLSearchParams(families.map((family) => ['family', family]))
    const response = await fetch(`${brandPath(workspaceId, brandId, 'fonts')}?${query}`)
    if (!response.ok) throw new Error(`fonts: ${response.status}`)
    return FontFamily.array().parse(await response.json())
  }
  return {
    fontFaces: async (families) => {
      const asks: string[][] = []
      for (let i = 0; i < families.length; i += MOST_FONT_FAMILIES_ASKED)
        asks.push(families.slice(i, i + MOST_FONT_FAMILIES_ASKED))
      const listed = await Promise.all(asks.map(askFor)).then(
        (answers) => answers.flat(),
        (error: unknown) => {
          // Offline, the catalog the font chooser read on this page answers, as the whole catalog once did.
          const known = loadedCatalog(workspaceId, brandId)
          if (!known) throw error
          return known
        },
      )
      const faces = listed.filter((f) => families.includes(f.family)).flatMap((f) => f.faces)
      for (const face of faces) {
        const paths = googleFacePaths(face)
        if (paths) googleFiles.set(face.id, paths.file)
      }
      return faces
    },
    fontFile: async (face) => {
      const response = await fetch(googleFiles.get(face.id) ?? brandPath(workspaceId, brandId, 'fonts', face.id))
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
export function brandKitVariables(workspaceId: string, brandId: string): Promise<Variables | undefined> {
  return kitAsks(`${workspaceId}/${brandId}`, async () => {
    const response = await fetch(brandPath(workspaceId, brandId, 'kit', 'data')).catch(() => null)
    if (!response?.ok) return undefined
    return kitVariables(workspaceId, brandId, BrandKit.parse(await response.json()))
  })
}

/**
 * What the stage's editor loads and sends through the app's routes for a brand: an asset's bytes, the brand's fonts,
 * the pictures of an SVG file it uploads, and what the matchers work with.
 */
export function editorSources(workspaceId: string, brandId: string) {
  return {
    assetBytes: (assetId: string) => assetBytes(workspaceId, brandId, assetId),
    ...fontLoader(workspaceId, brandId),
    uploadImage: imageUploader(workspaceId, brandId),
    matchers: () => matchSources(workspaceId, brandId),
  }
}

/**
 * What the matchers work with as Make editable rebuilds text and shapes: the brand kit's colours, fonts and text
 * styles, which a rebuilt layer may bind to, read now (none for a brand with no kit), and the brand's font catalog,
 * where a text's font is found, with the path its uploaded faces are read at. It rejects when the kit or the
 * catalog can't be read, as offline, so nothing is rebuilt without them and the editor tries again.
 */
export async function matchSources(workspaceId: string, brandId: string): Promise<MatchSources> {
  const [kit, catalog] = await Promise.all([
    fetch(brandPath(workspaceId, brandId, 'kit', 'data')).then(async (response) => {
      if (response.ok) return BrandKit.parse(await response.json())
      if (response.status === 404) return EMPTY_BRAND_KIT
      throw new Error(`brand kit: ${response.status}`)
    }),
    sharedCatalogRead(workspaceId, brandId),
  ])
  if (!catalog) throw new Error('the font catalog did not come')
  return {
    kit: {
      colors: Object.fromEntries(kit.colors.map((colour) => [colour.token, colour.value])),
      fonts: Object.fromEntries(kit.fonts.map((font) => [font.token, font.family])),
      textStyles: kit.textStyles,
    },
    fonts: { catalog, uploadPath: `${brandPath(workspaceId, brandId, 'fonts')}/` },
  }
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
