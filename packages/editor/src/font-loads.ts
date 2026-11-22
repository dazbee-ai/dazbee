// The editor's fonts from the catalog: each family's faces as the catalog lists them, asked for
// once, and the files of only the faces its texts are drawn in (`facesToLoad`), fetched as texts ask
// for new weights and styles. A face's file is fetched once; the fonts we ship are always here, and
// draw a family unless the brand has its own files of it (`withBrandFonts`).
import { type CatalogFace, facesToLoad, FONT_FACES, type FontStyle, type FontUse, withBrandFonts } from '@dazbee/fonts'
import type { ResourceBytes } from '@dazbee/renderer'

/**
 * One face of a family: its weight, or a variable font's range of weights with its default as the
 * weight, and whether it is upright or italic.
 */
export interface FontFace {
  family: string
  weight: number
  weights?: { min: number; max: number } | undefined
  style: FontStyle
}

/** A face as the catalog lists it, with its id, which `fontFile` gives the file of. */
export type ListedFace = CatalogFace & { id: string }

/** Where the catalog's faces and files come from. */
export interface FontSources {
  /**
   * The faces the catalog lists for the named families, without their files. A family the catalog
   * doesn't have has none, and its text draws in the fallback fonts.
   */
  fontFaces?: (families: string[]) => Promise<ListedFace[]>
  /** The file of a face `fontFaces` listed, from our storage. */
  fontFile?: (face: ListedFace) => Promise<Uint8Array>
}

/** The fonts a design opened with: the families asked for, their faces, and the files fetched. */
export interface OpenedFonts {
  families: readonly string[]
  faces: readonly ListedFace[]
  files: readonly (ListedFace & { bytes: Uint8Array })[]
}

export interface FontLoadsDeps {
  /** The fonts we ship, by family, as the editor registers them. */
  shipped: ResourceBytes['fonts']
  /** What `openedFonts` fetched as the design opened. */
  opened: OpenedFonts
  sources: FontSources
  /** Whether the sync server is connected: a load that fails offline is asked for again. */
  connected: () => boolean
  /** Says what went wrong. */
  status: (status: string) => void
  /** Aborted when the editor is destroyed: what arrives after that is dropped. */
  signal: AbortSignal
  /** Told when files arrive: `fonts()` is a new list then. */
  arrived: () => void
}

/**
 * The families we ship, always loaded. The catalog is asked for them too: a brand's upload of one's name draws in
 * place of our file, and one the brand has none of draws in ours and is never lacking.
 */
export const SHIPPED_FAMILIES = new Set(FONT_FACES.map((f) => f.family))

/** No fonts from the catalog: what a design that names none of its families opens with. */
export const NO_FONTS: OpenedFonts = { families: [], faces: [], files: [] }

export function editorFontLoads({ shipped, opened, sources, connected, status, signal, arrived }: FontLoadsDeps) {
  /** Each family's faces as the catalog listed them, in its order, once it answered. */
  const catalog = new Map<string, ListedFace[]>()
  /** The families asked of the catalog, in the order asked: a list's families draw in this order. */
  const asked = new Set<string>()
  /** The weights and styles asked of each family, by their key. */
  const wanted = new Map<string, Map<string, FontUse>>()
  /** Each face's file, by face id, once here. */
  const files = new Map<string, Uint8Array>()
  /** The faces whose file is on its way. */
  const fetching = new Set<string>()
  /** The faces whose file failed to come while connected, which aren't asked for again. */
  const failed = new Set<string>()
  /** How many loads of each family are on their way: its catalog answer and its files. */
  const busy = new Map<string, number>()
  /** The latest load of each family, settled when it and the loads it started are over. */
  const latest = new Map<string, Promise<void>>()
  /** The families whose files a load that failed offline left to fetch: the next ask fetches them. */
  const unfetched = new Set<string>()
  /** Settles when every load asked for so far is over. */
  let all: Promise<void> = Promise.resolve()
  /** The fonts registered: the shipped ones, then each family's files in the catalog's order. */
  let list: ResourceBytes['fonts'] = [...shipped]
  /** Told when a load settles, whatever it brought. */
  const settleListeners = new Set<() => void>()

  for (const family of opened.families) asked.add(family)
  for (const family of opened.families)
    catalog.set(
      family,
      opened.faces.filter((face) => face.family === family),
    )
  for (const file of opened.files) files.set(file.id, file.bytes)
  list = fontList()

  function fonts() {
    return list
  }
  /** The fonts that draw `uses`: the shipped ones and the files here of the faces `facesToLoad` picks (`withBrandFonts`). */
  function fontsFor(uses: readonly FontUse[]): ResourceBytes['fonts'] {
    return withBrandFonts(
      shipped,
      [...asked].flatMap((family) =>
        here(
          facesToLoad(
            catalog.get(family) ?? [],
            uses.filter((use) => use.family === family),
          ),
        ),
      ),
    )
  }
  function pending(family: string) {
    return (busy.get(family) ?? 0) > 0
  }
  /** A family's faces as the catalog lists them; a shipped family the brand has no upload of, ours. */
  function facesOf(family: string): FontFace[] {
    if (drawsShipped(family)) return FONT_FACES.filter((face) => face.family === family).map(faceOf)
    return (catalog.get(family) ?? []).map(faceOf)
  }
  function families() {
    return [...new Set(list.map((font) => font.family))]
  }
  /**
   * Whether the family's own files draw it: ours for a shipped family once the catalog said the brand has no upload of
   * its name (at once without a catalog), and the catalog's files here for any other.
   */
  function drawable(family: string) {
    if (!drawsShipped(family)) return here(catalog.get(family) ?? []).length > 0
    return catalog.has(family) || !sources.fontFaces
  }
  function lacking() {
    return [...catalog].flatMap(([family, faces]) => (faces.length === 0 && !drawsShipped(family) ? [family] : []))
  }
  function loaded() {
    return all
  }

  /**
   * Asks for the faces of these families and the files of the faces drawing these uses, those not
   * asked for yet. The screen asks on every redraw, so a family's faces are picked again only when
   * it is asked for a new weight or style, or a load of its files failed offline.
   */
  function ask(uses: readonly FontUse[]) {
    const fresh: string[] = []
    const grown = new Set(unfetched)
    unfetched.clear()
    for (const use of uses) {
      const known = wanted.get(use.family) ?? new Map<string, FontUse>()
      const key = `${use.weight} ${use.style}`
      if (!known.has(key)) grown.add(use.family)
      wanted.set(use.family, known.set(key, use))
      if (!asked.has(use.family) && !fresh.includes(use.family)) fresh.push(use.family)
    }
    askCatalog(fresh)
    for (const family of grown) {
      const fetched = catalog.has(family) ? fetchFiles(family) : null
      if (fetched) after(family, track([family], fetched))
    }
  }
  /** Asks for the faces of these families; each family's load settles once its files too are here. */
  function loadFamilies(names: readonly string[]) {
    askCatalog(names.filter((family) => !asked.has(family)))
    return names.map((family) => latest.get(family))
  }
  /**
   * Asks the catalog again for the faces of those of these families it was asked for, as after the brand uploaded
   * faces of them: each draws as it did until the answer comes. A family not asked for yet is asked when a text needs it.
   */
  function askAgain(names: readonly string[]) {
    askCatalog(names.filter((family) => asked.has(family)))
  }
  /** Asks for these uses; settles when their families' faces and files are here or failed to come. */
  async function loadUses(uses: readonly FontUse[]) {
    ask(uses)
    await Promise.all([...new Set(uses.map((use) => use.family))].map((family) => latest.get(family)))
  }

  function askCatalog(fresh: readonly string[]) {
    if (fresh.length === 0 || !sources.fontFaces) return
    for (const family of fresh) asked.add(family)
    const loading = track(
      fresh,
      sources.fontFaces([...fresh]).then(
        async (faces) => {
          if (signal.aborted) return true
          for (const family of fresh)
            catalog.set(
              family,
              faces.filter((face) => face.family === family),
            )
          // The files its texts asked for meanwhile are part of this load.
          await Promise.all(fresh.map((family) => fetchFiles(family)))
          return true
        },
        (error: unknown) => {
          // Offline, a family waits for the connection; the next redraw asks for it again.
          if (!connected()) {
            for (const family of fresh) asked.delete(family)
            return false
          }
          status(`Error: a font did not load (${error instanceof Error ? error.message : String(error)})`)
          return true
        },
      ),
    )
    for (const family of fresh) after(family, loading)
  }
  /**
   * Fetches the files of the faces drawing the family's uses that aren't here, on their way or
   * failed; null with none to fetch. Says false when it failed offline.
   */
  function fetchFiles(family: string): Promise<boolean> | null {
    const uses = [...(wanted.get(family)?.values() ?? [])]
    const faces = facesToLoad(catalog.get(family) ?? [], uses).filter(
      (face) => !files.has(face.id) && !fetching.has(face.id) && !failed.has(face.id),
    )
    const { fontFile } = sources
    if (faces.length === 0 || !fontFile) return null
    for (const face of faces) fetching.add(face.id)
    return Promise.all(faces.map((face) => fontFile(face))).then(
      (bytes) => {
        for (const face of faces) fetching.delete(face.id)
        if (signal.aborted) return true
        faces.forEach((face, i) => files.set(face.id, bytes[i] ?? new Uint8Array()))
        list = fontList()
        arrived()
        return true
      },
      (error: unknown) => {
        for (const face of faces) fetching.delete(face.id)
        // Offline, a face waits for the connection; the next redraw asks for it again.
        if (!connected()) {
          unfetched.add(family)
          return false
        }
        for (const face of faces) failed.add(face.id)
        status(`Error: a font did not load (${error instanceof Error ? error.message : String(error)})`)
        return true
      },
    )
  }
  /** Makes `load` part of the family's latest load, which settles once every load before it has too. */
  function after(family: string, load: Promise<void>) {
    latest.set(
      family,
      Promise.all([latest.get(family), load]).then(() => undefined),
    )
  }
  /**
   * Counts `load` as one of the families' loads while it is on its way, and tells the settle
   * listeners when it ends, unless it failed offline (it says false then).
   */
  function track(names: readonly string[], load: Promise<boolean>): Promise<void> {
    for (const family of names) busy.set(family, (busy.get(family) ?? 0) + 1)
    const done = load.then((told) => {
      for (const family of names) busy.set(family, (busy.get(family) ?? 1) - 1)
      if (told && !signal.aborted) for (const listener of [...settleListeners]) listener()
    })
    all = Promise.all([all, done]).then(() => undefined)
    return done
  }
  /** The shipped fonts, then each family's files here, in the catalog's order (`withBrandFonts`). */
  function fontList(): ResourceBytes['fonts'] {
    return withBrandFonts(
      shipped,
      [...asked].flatMap((family) => here(catalog.get(family) ?? [])),
    )
  }
  /** Whether the family is one we ship and the catalog lists no upload of its name: our files draw it. */
  function drawsShipped(family: string) {
    return SHIPPED_FAMILIES.has(family) && (catalog.get(family)?.length ?? 0) === 0
  }
  /** The files here of these faces, in their order. */
  function here(faces: readonly ListedFace[]): ResourceBytes['fonts'] {
    return faces.flatMap((face) => {
      const bytes = files.get(face.id)
      return bytes ? [{ family: face.family, bytes }] : []
    })
  }

  function onSettle(listener: () => void) {
    settleListeners.add(listener)
    return () => settleListeners.delete(listener)
  }

  function destroy() {
    settleListeners.clear()
  }

  return {
    fonts,
    fontsFor,
    pending,
    facesOf,
    families,
    drawable,
    lacking,
    loaded,
    ask,
    loadFamilies,
    askAgain,
    loadUses,
    onSettle,
    destroy,
  }
}

/**
 * The fonts drawing `uses` as a design opens: the faces the catalog lists for their families, shipped ones
 * included, and the files of those `facesToLoad` picks. None without the sources.
 */
export async function openedFonts(uses: readonly FontUse[], sources: FontSources): Promise<OpenedFonts> {
  const families = [...new Set(uses.map((use) => use.family))]
  const { fontFaces, fontFile } = sources
  if (families.length === 0 || !fontFaces || !fontFile) return NO_FONTS
  const faces = await fontFaces(families).catch((error: unknown) => {
    // A design in only the fonts we ship opens in ours when the catalog doesn't answer; the screen asks again.
    if (families.every((family) => SHIPPED_FAMILIES.has(family))) return null
    throw error
  })
  if (!faces) return NO_FONTS
  const picked = families.flatMap((family) =>
    facesToLoad(
      faces.filter((face) => face.family === family),
      uses.filter((use) => use.family === family),
    ),
  )
  const files = await Promise.all(picked.map(async (face) => ({ ...face, bytes: await fontFile(face) })))
  return { families, faces, files }
}

/** A face's family, weight or weights, and style. */
function faceOf({ family, weight, weights, style }: FontFace): FontFace {
  return { family, weight, ...(weights ? { weights } : {}), style }
}
