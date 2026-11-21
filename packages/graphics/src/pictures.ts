// The picture stickers, whose files the repository doesn't hold: each one's path in its source, SHA-256, size and
// pixel size, as `write-stickers.ts` wrote them in `sticker-pictures.json`. The files sit in Dazbee's storage, stored
// by the API's `stickers:upload`, and placing one copies the stored file.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { StickerSetId } from './sets.ts'

/** A picture's file as the list gives it. */
export interface PictureFile {
  /** The file's path in its source, from the repository's root. */
  path: string
  sha256: string
  byteSize: number
  width: number
  height: number
}

/** A picture sticker's file: the sticker's id (`fluent-emoji/rocket`), its style and the file. */
export interface StickerPicture extends PictureFile {
  sticker: string
  style: string
}

/** The pictures by sticker and style (`fluent-emoji/rocket/3d`), read from `sticker-pictures.json` the first time. */
let pictures: ReadonlyMap<string, StickerPicture> | undefined

/** Every picture sticker's file, as the list gives them. */
export function stickerPictures(): readonly StickerPicture[] {
  return [...listed().values()]
}

/** The picture of the sticker `name` of `set` in `style`; undefined when it has none. */
export function stickerPicture(set: StickerSetId, name: string, style: string): StickerPicture | undefined {
  return listed().get(`${set}/${name}/${style}`)
}

/** The list's pictures, by sticker and style. */
function listed(): ReadonlyMap<string, StickerPicture> {
  if (!pictures) {
    const files = JSON.parse(readFileSync(join(import.meta.dirname, 'sticker-pictures.json'), 'utf8')) as Record<
      string,
      PictureFile
    >
    pictures = new Map(
      Object.entries(files).map(([key, file]) => {
        const at = key.lastIndexOf('/')
        return [key, { sticker: key.slice(0, at), style: key.slice(at + 1), ...file }]
      }),
    )
  }
  return pictures
}
