// The illustrations, whose SVG files the repository doesn't hold: each one's source, SHA-256, size, drawn size,
// search tags and topics, as `write-illustrations.ts` wrote them in `illustrations.json`. The files sit in Dazbee's storage under
// `bundled/<sha256>`, stored by the API's `illustrations:upload`, and placing one adds the stored file to the brand's
// asset library and places it as layers.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { IllustrationSetId } from './sets.ts'

/** An illustration's file as the manifest lists it. */
export interface IllustrationFile {
  /** Where the file comes from: its path in the set's repository, or its link in the set's gallery. */
  source: string
  sha256: string
  byteSize: number
  /** Its drawn size, in the file's own units. */
  width: number
  height: number
  /** Its own words and its set's, which search matches. */
  tags: string[]
  /** The ad topics its words put it in (`food` for a breakfast), which search matches a little less. */
  topics: string[]
}

/** An illustration with its file: its set and name, which make its id (`undraw/delivery`). */
export interface Illustration extends IllustrationFile {
  set: IllustrationSetId
  name: string
}

/** The illustrations, by id, read from `illustrations.json` the first time. */
let listed: ReadonlyMap<string, Illustration> | undefined

/** Every illustration, in the manifest's order: each set's, its names in order. */
export function illustrations(): readonly Illustration[] {
  return [...all().values()]
}

/** The illustration `name` of `set`; undefined when the set has none of that name. */
export function illustrationOf(set: IllustrationSetId, name: string): Illustration | undefined {
  return all().get(`${set}/${name}`)
}

/** The manifest's illustrations, by id. */
function all(): ReadonlyMap<string, Illustration> {
  if (!listed) {
    const files = JSON.parse(readFileSync(join(import.meta.dirname, 'illustrations.json'), 'utf8')) as Record<
      string,
      IllustrationFile
    >
    listed = new Map(
      Object.entries(files).map(([id, file]) => {
        const at = id.indexOf('/')
        return [id, { set: id.slice(0, at) as IllustrationSetId, name: id.slice(at + 1), ...file }]
      }),
    )
  }
  return listed
}
