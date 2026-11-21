// Fluent Emoji's files, read from its GitHub repository's archive at the commit `sets.ts` pins as it downloads: every
// file, for `write-stickers.ts`, or the picture stickers' files, each checked against the SHA-256 the list gives, for
// the API's `stickers:upload` to store.
import { createHash } from 'node:crypto'
import { Readable } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import { createGunzip } from 'node:zlib'

import type { PictureFile } from './pictures.ts'
import { readTar, type TarFile } from './read-tar.ts'
import { STICKER_SETS } from './sets.ts'

/**
 * Tells `onFile` each file of the pinned commit's archive, its path from the repository's root (`assets/Rocket/3D/
 * rocket_3d.png`), waiting for each; throws when GitHub can't give it, or gives another commit's.
 */
export async function readFluentArchive(onFile: TarFile): Promise<void> {
  const { source } = STICKER_SETS['fluent-emoji']
  if (!('commit' in source)) throw new Error('Fluent Emoji is pinned to a commit')
  const { repository, commit } = source
  const response = await fetch(`https://codeload.github.com/${repository}/tar.gz/${commit}`)
  if (!response.ok || !response.body) throw new Error(`GitHub answered ${response.status} for ${repository}`)
  const body = Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(createGunzip())
  const archived = await readTar(body, (path, bytes) => onFile(path.slice(path.indexOf('/') + 1), bytes))
  if (archived !== commit) throw new Error(`the archive is of ${archived}, not the pinned ${commit}`)
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
