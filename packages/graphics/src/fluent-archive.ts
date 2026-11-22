// Fluent Emoji's files, read from its GitHub repository's archive at the commit `sets.ts` pins as it downloads: every
// file, for `write-stickers.ts`, or the picture stickers' files, each checked against the SHA-256 the list gives, for
// the API's `stickers:upload` to store.
import { createHash } from 'node:crypto'

import type { PictureFile } from './pictures.ts'
import { readGitHubArchive, type TarFile } from './read-tar.ts'
import { STICKER_SETS } from './sets.ts'

/**
 * Tells `onFile` each file of the pinned commit's archive, its path from the repository's root (`assets/Rocket/3D/
 * rocket_3d.png`), waiting for each; throws when GitHub can't give it, or gives another commit's.
 */
export async function readFluentArchive(onFile: TarFile): Promise<void> {
  const { source } = STICKER_SETS['fluent-emoji']
  if (!('commit' in source)) throw new Error('Fluent Emoji is pinned to a commit')
  await readGitHubArchive(source, onFile)
}

/**
 * Reads the pinned archive, with `read`, and tells `onPicture` each of `wanted`'s bytes, waiting for each; throws when
 * a file's bytes aren't the ones the list pins, or the archive lacks one.
 */
export async function readStickerPictures<P extends PictureFile>(
  wanted: readonly P[],
  onPicture: (picture: P, bytes: Uint8Array) => Promise<void>,
  read: (onFile: TarFile) => Promise<void> = readFluentArchive,
): Promise<void> {
  const byPath = new Map(wanted.map((picture) => [picture.path, picture]))
  const told = new Set<string>()
  await read(async (path, bytes) => {
    const picture = byPath.get(path)
    if (!picture) return
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== picture.sha256) throw new Error(`${path} has SHA-256 ${sha256}, not the pinned ${picture.sha256}`)
    await onPicture(picture, new Uint8Array(bytes))
    told.add(path)
  })
  const missing = wanted.filter(({ path }) => !told.has(path))
  if (missing.length > 0) throw new Error(`the archive lacks ${missing.map(({ path }) => path).join(', ')}`)
}
