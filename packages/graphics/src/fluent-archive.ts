// Fluent Emoji's files, read from its GitHub repository's archive at the commit `sets.ts` pins, as it downloads.
import { Readable } from 'node:stream'
import type { ReadableStream } from 'node:stream/web'
import { createGunzip } from 'node:zlib'

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
  const archived = await readTar(
    Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(createGunzip()),
    (path, bytes) => onFile(path.slice(path.indexOf('/') + 1), bytes),
  )
  if (archived !== commit) throw new Error(`the archive is of ${archived}, not the pinned ${commit}`)
}
