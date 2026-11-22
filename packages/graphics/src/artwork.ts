// The artwork sets' graphics, whose files the repository doesn't hold: each graphic's search tags and, for each of
// its styles, its file's source, SHA-256, size and drawn size, as `write-artwork.ts` wrote them in `artwork.json`. The
// files sit in Dazbee's storage under `bundled/<sha256>`, stored by the API's `artwork:upload`, and placing one adds
// the stored file to the brand's asset library.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ArtworkSetId } from './artwork-sets.ts'

/** One style's file of a graphic, as the manifest lists it. */
export interface ArtworkFile {
  /** Where the file comes from: its path in the set's repository or zip, or its link. */
  source: string
  sha256: string
  byteSize: number
  /** Its drawn size: an SVG file's in its own units, a picture's in pixels. */
  width: number
  height: number
  /** For an effect drawn light on dark, `screen`: it is placed so its dark drops out. */
  blend?: 'screen'
}

/** A graphic of an artwork set as the manifest lists it: its tags and its file in each style. */
export interface ArtworkEntry {
  /** Its own words and its set's, which search matches. */
  tags: string[]
  /** Its file in each style it is drawn in, in the set's order of styles. */
  files: Record<string, ArtworkFile>
}

/** A graphic of an artwork set: its set and name, which make its id (`coolshapes/star-1`), and what the manifest lists. */
export interface Artwork extends ArtworkEntry {
  set: ArtworkSetId
  name: string
}

/** One style's file of a graphic, with the graphic's set and name: what the upload stores. */
export interface ArtworkStyleFile extends ArtworkFile {
  set: ArtworkSetId
  name: string
  style: string
}

/** The graphics, by id, read from `artwork.json` the first time. */
let listed: ReadonlyMap<string, Artwork> | undefined

/** Every graphic of the artwork sets, in the manifest's order: each set's, its names in order. */
export function artworks(): readonly Artwork[] {
  return [...all().values()]
}

/** The graphic `name` of `set`; undefined when the set has none of that name. */
export function artworkOf(set: ArtworkSetId, name: string): Artwork | undefined {
  return all().get(`${set}/${name}`)
}

/** Every style's file of every graphic, in the manifest's order. */
export function artworkFiles(): ArtworkStyleFile[] {
  return artworks().flatMap(({ set, name, files }) =>
    Object.entries(files).map(([style, file]) => ({ set, name, style, ...file })),
  )
}

/** The manifest's graphics, by id. */
function all(): ReadonlyMap<string, Artwork> {
  if (!listed) {
    const entries = JSON.parse(readFileSync(join(import.meta.dirname, 'artwork.json'), 'utf8')) as Record<
      string,
      ArtworkEntry
    >
    listed = new Map(
      Object.entries(entries).map(([id, entry]) => {
        const at = id.indexOf('/')
        return [id, { set: id.slice(0, at) as ArtworkSetId, name: id.slice(at + 1), ...entry }]
      }),
    )
  }
  return listed
}
