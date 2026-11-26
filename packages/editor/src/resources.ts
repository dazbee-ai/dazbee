// The fonts and images the editor draws with: the bytes it has, decoded once, and the ones still
// coming, which the screen draws in placeholders until they arrive. Only the faces the design's
// texts are drawn in load (font-loads.ts). Images are drawn from display copies no bigger than the
// screen shows them (display-copies.ts).
import type { CanvasKit, Image } from '@dazbee/canvaskit'
import type { FontUse } from '@dazbee/fonts'
import type { ResourceBytes, ResourceCache, Resources } from '@dazbee/renderer'
import { type Design, fontUses, imageAssetIds, type Variables } from '@dazbee/schema'

import { type AlphaMap, alphaMap } from './canvas/alpha-map.ts'
import { type CopyMaker, displayCopies, type ImageUse } from './display-copies.ts'
import { editorFontLoads, type FontFace, type FontSources, type OpenedFonts, SHIPPED_FAMILIES } from './font-loads.ts'

/** How long `prepareImages` waits for an image's display copy before it settles anyway: one that never comes holds nothing back. */
export const PREPARE_MS = 5000

/**
 * Where fonts and images come from, beside the fonts we ship: the catalog's faces of the families
 * the design uses, which Bold picks weights from, and the files of those its texts are drawn in.
 */
export interface ResourceSources extends FontSources {
  /** The stored bytes of an image asset (#35); designs with image fills need it. */
  assetBytes?: (assetId: string) => Promise<Uint8Array>
}

export interface ResourcesDeps {
  ck: CanvasKit
  cache: ResourceCache
  /** The bytes the design opened with: the shipped fonts, the files of `firstFonts` and the first images. */
  first: ResourceBytes
  /** The catalog's faces and files the design opened with (`openedFonts`). */
  firstFonts: OpenedFonts
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
  /** Asks for the bytes of these images not here yet; settles once they are here or failed to come. */
  fetchImages(ids: readonly string[]): Promise<void>
  /**
   * Gets these images ready to draw: their bytes fetched and their display copies made, so a layer whose fill turns
   * to one draws it at once, not clear until its copy comes. Settles once each is ready, or its bytes failed to
   * come, or after PREPARE_MS, whatever became of its copy.
   */
  prepareImages(ids: readonly string[]): Promise<void>
  /**
   * Says where the shown page draws its images and how many device pixels a design pixel takes
   * (zoom × device pixel ratio), which size their display copies by; a redraw says it first.
   */
  show(uses: ReadonlyMap<string, readonly ImageUse[]>, pixelsPerUnit: number): void
  /**
   * Asks the catalog for the faces of the families not asked for yet. Returns each family's load,
   * settled when its faces, and the files its texts asked for meanwhile, are here or failed to come;
   * undefined for a family that never loads (no way to load it). A shipped family is asked for too: the brand may have
   * an upload of its name.
   */
  loadFamilies(families: readonly string[]): (Promise<void> | undefined)[]
  /**
   * Asks the catalog again for the faces of those of these families it was asked for, as after the brand uploaded
   * faces of them: a shipped family then draws in the upload. Each draws as it did until the answer comes.
   */
  askAgain(families: readonly string[]): void
  /** Asks for the files of the faces drawing these uses (`facesToLoad`); settles when they are here or failed to come. */
  loadUses(uses: readonly FontUse[]): Promise<void>
  /**
   * The bytes that draw `current`: the shipped fonts and the files of only the faces its texts are
   * drawn in, as the API draws it, with the brand kit's values and the images here. An export draws with these.
   */
  bytesFor(current: Design): ResourceBytes
  /** Settles once the fonts and images asked for so far are here or failed to come. */
  loaded(): Promise<undefined>
  /** The faces of a family as the catalog lists them, shipped ones included; none until the catalog answers. */
  facesOf(family: string): FontFace[]
  /** The families whose files the editor has, shipped ones included (#50). */
  families(): string[]
  /**
   * Whether the family's own files draw it: ours for a shipped family the catalog said the brand has no upload of, the
   * catalog's files here for any other. A text fitted before then would be fitted in other letters.
   */
  drawable(family: string): boolean
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
  /** Whether a load of `family`'s faces or files is on its way: asked for, and not yet here, empty or failed. */
  pending(family: string): boolean
  /**
   * Calls back when a load of families settles, whatever it brought: files, none, or a failure while
   * connected. One that fails offline is asked for again later, and tells nothing now.
   */
  onSettle(listener: () => void): () => boolean
  destroy(): void
}

export function editorResources({
  ck,
  cache,
  first,
  firstFonts,
  sources,
  connected,
  status,
  signal,
  after,
  copyMaker,
}: ResourcesDeps): EditorResources {
  /**
   * The files the design opened with from the catalog, the same arrays `first.fonts` holds after the shipped ones: a
   * brand's upload of a shipped family's name is among them, not among the shipped fonts.
   */
  const openedFiles = new Set(firstFonts.files.map((file) => file.bytes))
  /** The catalog's faces and the files of those the design's texts are drawn in. */
  const fonts = editorFontLoads({
    shipped: first.fonts.filter((font) => SHIPPED_FAMILIES.has(font.family) && !openedFiles.has(font.bytes)),
    opened: firstFonts,
    sources,
    connected,
    status,
    signal,
    arrived: fontsArrived,
  })
  /** The bytes the editor has, which grow as fonts and images arrive. */
  let resourceBytes: ResourceBytes = { ...first, fonts: fonts.fonts() }
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
  /** Images a design named after it opened (one placed from the asset library, #52); exports wait for them too. */
  let imagesLoading: Promise<void> = Promise.resolve()
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
    fonts.ask(fontUses(current, resourceBytes.variables))
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
    fonts.ask(fontUses(current, resourceBytes.variables))
    fetchImages(imageAssetIds(current, frameIds, resourceBytes.variables))
  }
  /**
   * Fetches the bytes of these images not here and not on their way; `imagesLoading` settles when they are here, and
   * so does what it gives, once these are here or failed to come.
   */
  function fetchImages(ids: readonly string[]): Promise<void> {
    const fresh = ids.filter((id) => !loading.has(id) && !resourceBytes.images[id])
    if (fresh.length === 0 || !sources.assetBytes)
      return ids.some((id) => loading.has(id)) ? imagesLoading : Promise.resolve()
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
    return arriving
  }
  /** See `EditorResources.prepareImages`. */
  function prepareImages(ids: readonly string[]): Promise<void> {
    // Ready once drawn from a copy; an image whose bytes didn't come is not waited for.
    const ready = () => ids.every((id) => copies.images().has(id) || !resourceBytes.images[id])
    return new Promise<void>((resolve) => {
      let cancel = () => {}
      let settled = false
      function done() {
        if (settled) return
        settled = true
        arriveListeners.delete(check)
        signal.removeEventListener('abort', done)
        cancel()
        resolve()
      }
      function check() {
        if (ready()) done()
      }
      if (signal.aborted) return done()
      signal.addEventListener('abort', done)
      void fetchImages(ids).then(() => {
        if (settled) return
        copies.make(ids)
        if (ready()) return done()
        arriveListeners.add(check)
        cancel = after?.(PREPARE_MS, done) ?? cancel
      })
    })
  }
  function show(uses: ReadonlyMap<string, readonly ImageUse[]>, pixelsPerUnit: number) {
    copies.show(uses, pixelsPerUnit)
    const shown = decoded()
    for (const [key, { ids, resources }] of drawnWith) if (!matches(resources, ids, shown)) drawnWith.delete(key)
  }
  function bytes() {
    return resourceBytes
  }
  function bytesFor(current: Design): ResourceBytes {
    return { ...resourceBytes, fonts: fonts.fontsFor(fontUses(current, resourceBytes.variables)) }
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
    return Promise.all([fonts.loaded(), imagesLoading]).then(() => undefined)
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

  /** The files that came are registered: the cache decodes them, and the screen draws with them. */
  function fontsArrived() {
    resourceBytes = { ...resourceBytes, fonts: fonts.fonts() }
    resources = cache.resources(fontsOf(resourceBytes))
    tellBytes()
    for (const listener of arriveListeners) listener(true)
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

  function destroy() {
    arriveListeners.clear()
    bytesListeners.clear()
    fonts.destroy()
    alphaMaps.clear()
    copies.destroy()
    clear.delete()
  }

  return {
    bytes,
    resources: decoded,
    screen,
    load,
    fetchImages,
    prepareImages,
    show,
    loadFamilies: fonts.loadFamilies,
    askAgain: fonts.askAgain,
    loadUses: fonts.loadUses,
    bytesFor,
    loaded,
    facesOf: fonts.facesOf,
    families: fonts.families,
    drawable: fonts.drawable,
    lacking: fonts.lacking,
    alpha,
    setVariables,
    onArrive,
    onBytes,
    pending: fonts.pending,
    onSettle: fonts.onSettle,
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

/** The bytes with no images: the cache decodes the fonts, and the display copies the images. */
function fontsOf(bytes: ResourceBytes): ResourceBytes {
  return { ...bytes, images: {} }
}
