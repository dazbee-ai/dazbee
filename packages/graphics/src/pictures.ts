// The picture stickers, which the repository doesn't hold: each one's file in its source, SHA-256, size and pixel
// size, as `write-stickers.ts` wrote them in `sticker-pictures.json`; and their bytes, read from the pinned source and
// checked against their SHA-256, for a script to store them in Dazbee's storage. Placing one copies the stored file.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { readFluentArchive } from './fluent-archive.ts'
import type { StickerSetId } from './sets.ts'

/** A picture sticker's file: where its source holds it, and what it is. */
export interface StickerPicture {
  /** The sticker's id with the style: `fluent-emoji/rocket/3d`. */
  id: string
  /** The file's path in its source, from the repository's root. */
  path: string
  sha256: string
  byteSize: number
  width: number
  height: number
}

/** The pictures, read from `sticker-pictures.json` the first time. */
let pictures: ReadonlyMap<string, StickerPicture> | undefined

/** Every picture sticker's file, as the manifest lists them. */
export function stickerPictures(): readonly StickerPicture[] {
  return [...picturesById().values()]
}

/** The picture of the sticker `name` of `set` in `style`; undefined when it has none. */
export function stickerPicture(set: StickerSetId, name: string, style: string): StickerPicture | undefined {
  return picturesById().get(`${set}/${name}/${style}`)
}

/**
 * Reads the pinned source and tells `onPicture` each of `wanted`'s bytes, waiting for each; throws when a file's bytes
 * aren't the ones pinned, or the source lacks one.
 */
export async function readStickerPictures(
  wanted: readonly StickerPicture[],
  onPicture: (picture: StickerPicture, bytes: Uint8Array) => Promise<void>,
): Promise<void> {
  const byPath = new Map(wanted.map((picture) => [picture.path, picture]))
  const told = new Set<string>()
  await readFluentArchive(async (path, bytes) => {
    const picture = byPath.get(path)
    if (!picture) return
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== picture.sha256) throw new Error(`${path} has SHA-256 ${sha256}, not the pinned ${picture.sha256}`)
    await onPicture(picture, new Uint8Array(bytes))
    told.add(path)
  })
  const missing = wanted.filter(({ path }) => !told.has(path))
  if (missing.length > 0) throw new Error(`the source lacks ${missing.map(({ path }) => path).join(', ')}`)
}

/** The manifest's pictures by id. */
function picturesById(): ReadonlyMap<string, StickerPicture> {
  if (!pictures) {
    const listed = JSON.parse(readFileSync(join(import.meta.dirname, 'sticker-pictures.json'), 'utf8')) as Record<
      string,
      Omit<StickerPicture, 'id'>
    >
    pictures = new Map(Object.entries(listed).map(([id, picture]) => [id, { id, ...picture }]))
  }
  return pictures
}
