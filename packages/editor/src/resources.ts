// The fonts and images the editor draws with: the bytes it has, decoded once, and the ones still
// coming, which the screen draws in placeholders until they arrive. Images are drawn from display
// copies no bigger than the screen shows them (display-copies.ts).
import type { CanvasKit, Image } from '@dazbee/canvaskit'
import { FONT_FACES } from '@dazbee/fonts'
import type { ResourceBytes, ResourceCache, Resources } from '@dazbee/renderer'
import { type Design, fontFamilies, imageAssetIds, type Variables } from '@dazbee/schema'

import { type AlphaMap, alphaMap } from './canvas/alpha-map.ts'
import { type CopyMaker, displayCopies, type ImageUse } from './display-copies.ts'

/**
 * One face of a family the editor has the file of: its weight, or a variable font's range of
 * weights with its default as the weight, and whether it is upright or italic.
 */
export interface FontFace {
  family: string
  weight: number
  weights?: { min: number; max: number }
  style: 'normal' | 'italic'
}

/** Where fonts and images come from, beside the fonts we ship. */
export interface ResourceSources {
  /** The stored bytes of an image asset (#35); designs with image fills need it. */
  assetBytes?: (assetId: string) => Promise<Uint8Array>
  /**
   * The font files of the named families, from our storage (#50): the editor asks for the families
   * the design uses that it doesn't ship, when it opens and whenever text names a new one. A family
   * the catalog doesn't have is left out, and its text draws in the fallback fonts. Each file names
   * the weight and style it is, which Bold picks from.
   */
  fontFiles?: (families: string[]) => Promise<(FontFace & { bytes: Uint8Array })[]>
}

export interface ResourcesDeps {
  ck: CanvasKit
  cache: ResourceCache
  /** The bytes the design opened with. */
  first: ResourceBytes
  /** The faces of the files `fontFiles` gave the design as it opened; the shipped faces come with the editor. */
  firstFaces: readonly FontFace[]
  sources: ResourceSources
  /** Whether the sync server is connected: a font or image that fails offline waits for it. */
  connected: () => boolean
  /** Says what went wrong, as the loading steps do. */
  status: (status: string) => void
  /** Aborted when the editor is destroyed: what arrives after that is dropped. */
  signal: AbortSignal
  /** Runs `run` after `ms`, and gives what cancels it: the wait before a bigger display copy. */
  after?: ((ms: number, run: () => void) => () => void) | undefined
  /** Makes display copies away from the main thread; without it they are made at once. */
  copyMaker?: CopyMaker | undefined
}

export interface EditorResources {
  /** The bytes the editor has: fonts, images and the brand kit's values. */
  bytes(): ResourceBytes
  /** The bytes decoded: the fonts from the cache, the images as display copies with their own sizes. */
  resources(): Resources
  /**
   * What the screen draws a design with: asks for its families, and for the images of these frames
   * (all the design's without them) not asked for yet, and draws an image still coming clear.
   */
  screen(current: Design, frameIds?: readonly string[]): Resources
  /**
   * Asks for the design's families and the bytes of these frames' images not here yet, decoding
   * none: what an export or the font check needs; `loaded` settles when they are here.
   */
  load(current: Design, frameIds: readonly string[]): void
  /**
   * Says where the shown page draws its images and how many device pixels a design pixel takes
   * (zoom × device pixel ratio), which size their display copies by; a redraw says it first.
   */
  show(uses: ReadonlyMap<string, readonly ImageUse[]>, pixelsPerUnit: number): void
  /**
   * Asks for the files of the families not asked for yet. Returns each family's load, settled when
   * its files are here or failed to come; undefined for a family that never loads (shipped, or no
   * way to load it).
   */
  loadFamilies(families: readonly string[]): (Promise<void> | undefined)[]
  /** Settles once the fonts and images asked for so far are here or failed to come. */
  loaded(): Promise<undefined>
  /** The faces of a family the editor has the files of, shipped ones included; none until they arrive. */
  facesOf(family: string): FontFace[]
  /** The families whose files the editor has, shipped ones included (#50). */
  families(): string[]
  /**
   * The families the catalog was asked for and answered with no file, which the editor still lacks:
   * their text draws in the fallback fonts. A family still loading, or whose load failed, is not one.
   */
  lacking(): string[]
  /** A decoded image's alpha map, by asset id, drawn when the image arrived; none for one still coming. */
  alpha(assetId: string): AlphaMap | undefined
  /** Gives bound properties new values: the brand kit's, from the next scene on. */
  setVariables(variables: Variables): void
  /** Calls back when fonts or images arrive: `fonts` when they were fonts. */
  onArrive(listener: (fonts: boolean) => void): () => boolean
  /** Calls back when `bytes` changes: fonts or images arrived, or the brand kit's values were set. It is a new object then. */
  onBytes(listener: () => void): () => boolean
  /** Whether a load of `family`'s files is on its way: asked for, and not yet here, empty or failed. */
  pending(family: string): boolean
  /**
   * Calls back when a load of families settles, whatever it brought: files, none, or a failure while
   * connected. One that fails offline is asked for again later, and tells nothing now.
   */
  onSettle(listener: () => void): () => boolean
  destroy(): void
}

/** The families we ship are loaded already; the rest come from the catalog, when the editor was given a way. */
export const SHIPPED_FAMILIES = new Set(FONT_FACES.map((f) => f.family))

export function editorResources({
  ck,
  cache,
  first,
  firstFaces,
  sources,
  connected,
  status,
  signal,
  after,
  copyMaker,
}: ResourcesDeps): EditorResources {
  /** The bytes the editor has, which grow as fonts and images arrive. */
  let resourceBytes = first
  /** The faces of the font files the editor has. */
  let faces: FontFace[] = [...FONT_FACES.map(faceOf), ...firstFaces]
  /** The fonts decoded, from the cache; images are the display copies'. */
  let resources = cache.resources(fontsOf(resourceBytes))
  /** Told when fonts or images arrive. */
  const arriveListeners = new Set<(fonts: boolean) => void>()
  /** Told when the bytes change. */
  const bytesListeners = new Set<() => void>()
  /** The images as the screen draws them, by the size it shows them. */
  const copies = displayCopies({
    ck,
    encoded: (assetId) => resourceBytes.images[assetId],
    changed: () => {
      for (const listener of arriveListeners) listener(false)
    },
    failed: () => status('Error: an image could not be opened'),
    maker: copyMaker,
    after,
  })
  /** The fonts and the copies together, made again when either changes. */
  let drawable: Resources = withCopies()
  /**
   * The resources each set of frames was drawn with, by the images they draw, holding only those
   * (an image still coming as a placeholder): kept while the fonts and those images stay the same,
   * so a copy made for another page (a Pages card thumbnail) leaves the stage's pictures alone.
   * One that no longer matches is dropped at the next `show`.
   */
  const drawnWith = new Map<string, { ids: readonly string[]; resources: Resources }>()
  /** The images on their way. */
  const loading = new Set<string>()
  // Families text names after the design opened (a pick in the font menu, another tab) load in the
  // background (#50); until then that text draws in the fallback fonts. Exports wait for them.
  const fontsAsked = new Set([...SHIPPED_FAMILIES, ...resourceBytes.fonts.map((f) => f.family)])
  /** Settles when every family asked for so far is here or failed to come. */
  let fontsLoading: Promise<void> = Promise.resolve()
  /** Each family asked for after the design opened, settled when its files are here or failed to come. */
  const familyLoads = new Map<string, Promise<void>>()
  /** Images a design named after it opened (one placed from the asset library, #52); exports wait for them too. */
  let imagesLoading: Promise<void> = Promise.resolve()
  /** The families whose load is on its way. */
  const pendingFamilies = new Set<string>()
  /** The families the catalog answered with no file. */
  const answeredEmpty = new Set<string>()
  /** Told when a load of families settles. */
  const settleListeners = new Set<() => void>()
  /** Each decoded image's alpha map, by asset id, with the image it was drawn from. */
  const alphaMaps = new Map<string, { image: Image; map: AlphaMap }>()

  // Images that arrive after the design (another tab added them) load in the background; until
  // then the screen draws them clear. Exports never do: they throw until every image is loaded.
  const maybeClear = ck.MakeImage(
    {
      width: 1,
      height: 1,
      alphaType: ck.AlphaType.Premul,
      colorType: ck.ColorType.RGBA_8888,
      colorSpace: ck.ColorSpace.SRGB,
    },
    new Uint8Array(4),
    4,
  )
  if (!maybeClear) throw new Error('could not make the image placeholder')
  const clear: Image = maybeClear

  function screen(current: Design, frameIds?: readonly string[]): Resources {
    askFamilies(fontFamilies(current, resourceBytes.variables))
    const ids = imageAssetIds(current, frameIds, resourceBytes.variables)
    copies.make(ids)
    const shown = decoded()
    const missing = ids.filter((id) => !shown.images.has(id))
    // An image whose bytes are here and that is still missing is on its way from the image worker,
    // or didn't open: it isn't fetched again.
    fetchImages(missing)
    const key = ids.join('\n')
    const kept = drawnWith.get(key)
    if (kept && matches(kept.resources, ids, shown)) return kept.resources
    const made = { ...shown, images: new Map(ids.map((id) => [id, shown.images.get(id) ?? clear])) }
    drawnWith.set(key, { ids, resources: made })
    return made
  }
  /** Whether resources made for these images draw them as `shown` does: the same fonts and images. */
  function matches(kept: Resources, ids: readonly string[], shown: Resources) {
    return kept.fonts === shown.fonts && ids.every((id) => kept.images.get(id) === (shown.images.get(id) ?? clear))
  }
  function load(current: Design, frameIds: readonly string[]) {
    askFamilies(fontFamilies(current, resourceBytes.variables))
    fetchImages(imageAssetIds(current, frameIds, resourceBytes.variables))
  }
  /** Fetches the bytes of these images not here and not on their way; `imagesLoading` settles when they are here. */
  function fetchImages(ids: readonly string[]) {
    const fresh = ids.filter((id) => !loading.has(id) && !resourceBytes.images[id])
    if (fresh.length === 0 || !sources.assetBytes) return
    for (const id of fresh) loading.add(id)
    const arriving = loadImages(fresh, sources)
      .then(
        (images) => {
          if (signal.aborted) return
          resourceBytes = { ...resourceBytes, images: { ...resourceBytes.images, ...images } }
          tellBytes()
          // The redraw this tells makes the copies of those the shown page draws.
          for (const listener of arriveListeners) listener(false)
        },
        (error: unknown) => {
          // Offline, an image waits for the connection; the next redraw asks for it again.
          if (!connected()) return
          status(`Error: an image did not load (${error instanceof Error ? error.message : String(error)})`)
        },
      )
      .finally(() => {
        for (const id of fresh) loading.delete(id)
      })
    imagesLoading = Promise.all([imagesLoading, arriving]).then(() => undefined)
  }
  function show(uses: ReadonlyMap<string, readonly ImageUse[]>, pixelsPerUnit: number) {
    copies.show(uses, pixelsPerUnit)
    const shown = decoded()
    for (const [key, { ids, resources }] of drawnWith) if (!matches(resources, ids, shown)) drawnWith.delete(key)
  }
  function bytes() {
    return resourceBytes
  }
  /** The fonts and the copies as they are now, with the alpha map of each copy made since. */
  function decoded() {
    if (drawable.fonts === resources.fonts && drawable.images === copies.images()) return drawable
    drawable = withCopies()
    mapImages()
    return drawable
  }
  function withCopies(): Resources {
    return { ...resources, images: copies.images(), imageSizes: copies.sizes() }
  }
  function loaded() {
    return Promise.all([fontsLoading, imagesLoading]).then(() => undefined)
  }
  function families() {
    return [...new Set(resourceBytes.fonts.map((f) => f.family))]
  }
  function lacking() {
    const have = new Set(families())
    return [...answeredEmpty].filter((family) => !have.has(family))
  }
  function alpha(assetId: string) {
    decoded()
    return alphaMaps.get(assetId)?.map
  }

  /** Draws the alpha map of each image copied since the last call, and lets go of those no longer held. */
  function mapImages() {
    const images = drawable.images
    for (const [id, entry] of alphaMaps) if (images.get(id) !== entry.image) alphaMaps.delete(id)
    for (const [id, image] of images) {
      if (!alphaMaps.has(id)) alphaMaps.set(id, { image, map: alphaMap(ck, image, copies.sizes().get(id)) })
    }
  }

  function loadFamilies(families: readonly string[]) {
    askFamilies(families)
    return families.map((family) => familyLoads.get(family))
  }
  /** Asks for the files of the families not asked for yet; `fontsLoading` settles when they are here. */
  function askFamilies(families: readonly string[]) {
    if (!sources.fontFiles) return
    const fresh = families.filter((family) => !fontsAsked.has(family))
    if (fresh.length === 0) return
    for (const family of fresh) {
      fontsAsked.add(family)
      pendingFamilies.add(family)
    }
    /** The load is over: told unless it failed offline, to be asked for again. */
    const settled = (told: boolean) => {
      for (const family of fresh) pendingFamilies.delete(family)
      if (told && !signal.aborted) for (const listener of [...settleListeners]) listener()
    }
    const loading = loadFonts(fresh, sources).then(
      (fonts) => {
        const given = new Set(fonts.map((font) => font.family))
        for (const family of fresh) if (!SHIPPED_FAMILIES.has(family) && !given.has(family)) answeredEmpty.add(family)
        if (signal.aborted || fonts.length === 0) return settled(true)
        resourceBytes = {
          ...resourceBytes,
          fonts: [...resourceBytes.fonts, ...fonts.map(({ family, bytes }) => ({ family, bytes }))],
        }
        faces = [...faces, ...fonts.map(faceOf)]
        resources = cache.resources(fontsOf(resourceBytes))
        tellBytes()
        for (const listener of arriveListeners) listener(true)
        settled(true)
      },
      (error: unknown) => {
        // Offline, a family waits for the connection; the next redraw asks for it again.
        if (!connected()) {
          for (const family of fresh) fontsAsked.delete(family)
          return settled(false)
        }
        status(`Error: a font did not load (${error instanceof Error ? error.message : String(error)})`)
        settled(true)
      },
    )
    for (const family of fresh) familyLoads.set(family, loading)
    fontsLoading = Promise.all([fontsLoading, loading]).then(() => undefined)
  }
  function setVariables(variables: Variables) {
    resourceBytes = { ...resourceBytes, variables }
    tellBytes()
  }
  /** Tells that the bytes changed. */
  function tellBytes() {
    for (const listener of [...bytesListeners]) listener()
  }

  function onArrive(listener: (fonts: boolean) => void) {
    arriveListeners.add(listener)
    return () => arriveListeners.delete(listener)
  }

  function onBytes(listener: () => void) {
    bytesListeners.add(listener)
    return () => bytesListeners.delete(listener)
  }

  function onSettle(listener: () => void) {
    settleListeners.add(listener)
    return () => settleListeners.delete(listener)
  }

  function destroy() {
    arriveListeners.clear()
    bytesListeners.clear()
    settleListeners.clear()
    alphaMaps.clear()
    copies.destroy()
    clear.delete()
  }

  return {
    bytes,
    resources: decoded,
    screen,
    load,
    show,
    loadFamilies,
    loaded,
    facesOf: (family: string) => faces.filter((face) => face.family === family),
    families,
    lacking,
    alpha,
    setVariables,
    onArrive,
    onBytes,
    pending: (family: string) => pendingFamilies.has(family),
    onSettle,
    destroy,
  }
}

/** The bytes of image assets, from `assetBytes`; no images need none. */
export async function loadImages(ids: string[], sources: ResourceSources): Promise<Record<string, Uint8Array>> {
  if (ids.length === 0) return {}
  const { assetBytes } = sources
  if (!assetBytes) throw new Error('the design has images, but the editor was given no way to load them')
  return Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await assetBytes(id)] as const)))
}

/** The files of the families we don't ship, from `fontFiles`; none without it. */
export async function loadFonts(
  families: string[],
  sources: ResourceSources,
): Promise<(FontFace & { bytes: Uint8Array })[]> {
  const wanted = families.filter((family) => !SHIPPED_FAMILIES.has(family))
  if (wanted.length === 0 || !sources.fontFiles) return []
  return sources.fontFiles(wanted)
}

/** The bytes with no images: the cache decodes the fonts, and the display copies the images. */
function fontsOf(bytes: ResourceBytes): ResourceBytes {
  return { ...bytes, images: {} }
}

/** A face of a font file: its family, weight or weights, and style. */
function faceOf({ family, weight, weights, style }: FontFace): FontFace {
  return { family, weight, ...(weights ? { weights } : {}), style }
}
