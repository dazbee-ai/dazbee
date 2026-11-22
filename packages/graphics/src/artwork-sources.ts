// The artwork sets' files read from their pinned sources: a repository set's files in its folder from its GitHub
// archive at the commit `artwork-sets.ts` pins (for Pattern Monster, each pattern's tile written from the site's index
// file), a link set's files one at a time from their links, and a zip set's files from its pack, checked against the
// pack's SHA-256. `write-artwork.ts` reads every file to write the manifest, and the API's `artwork:upload` reads the
// files storage lacks, each checked against the SHA-256 the manifest lists.
import { createHash } from 'node:crypto'

import type { ArtworkStyleFile } from './artwork.ts'
import { ARTWORK_SETS, type ArtworkSetId } from './artwork-sets.ts'
import { fetchLink } from './illustration-sources.ts'
import { type PatternEntry, patternsOf, patternTile } from './pattern-tile.ts'
import { readGitHubArchive, type TarFile } from './read-tar.ts'
import { readZip } from './read-zip.ts'

/** How to reach the sources: a repository's archive, and a file at its link. Tests give stand-ins. */
export interface ArtworkReaders {
  archive: (source: { repository: string; commit: string }, onFile: TarFile) => Promise<void>
  link: (url: string, options?: { maxBytes?: number }) => Promise<Uint8Array>
}

/** A file of a set as its source gives it: its path or link, and its bytes; for a pattern, the pattern too. */
export interface SourceFile {
  path: string
  bytes: Uint8Array
  pattern?: PatternEntry
}

/** The most bytes a set's zip pack may have. */
const MAX_ZIP_BYTES = 50_000_000

const READERS: ArtworkReaders = { archive: readGitHubArchive, link: fetchLink }

/**
 * Tells `onFile` each file of the repository set `set` in its folder, its path from the repository's root, waiting for
 * each; for a pattern set, each pattern's tile, its path the index file's and `#` and the pattern's slug.
 */
export async function readRepositoryArtwork(
  set: ArtworkSetId,
  onFile: (file: SourceFile) => Promise<void>,
  readers: ArtworkReaders = READERS,
): Promise<void> {
  const { source, kind } = ARTWORK_SETS[set]
  if (!('repository' in source)) throw new Error(`${set} is not taken from a repository`)
  await readers.archive(source, async (path, bytes) => {
    if (kind === 'background' && path === source.folder) {
      for (const file of patternFiles(path, bytes.toString('utf8'))) await onFile(file)
    } else if (path.startsWith(`${source.folder}/`)) await onFile({ path, bytes: new Uint8Array(bytes) })
  })
}

/** The files of the zip set `set` in its folder, read from its pack, which must have the pinned SHA-256. */
export async function readZipArtwork(set: ArtworkSetId, readers: ArtworkReaders = READERS): Promise<SourceFile[]> {
  const { source } = ARTWORK_SETS[set]
  if (!('zip' in source)) throw new Error(`${set} is not taken from a zip pack`)
  const pack = await readers.link(source.zip, { maxBytes: MAX_ZIP_BYTES })
  const sha256 = createHash('sha256').update(pack).digest('hex')
  if (sha256 !== source.sha256) throw new Error(`${source.zip} has SHA-256 ${sha256}, not the pinned ${source.sha256}`)
  return readZip(pack).filter(({ path }) => path.startsWith(`${source.folder}/`))
}

/**
 * Reads the files of `wanted` from their sources and tells `onFile` each one's bytes, waiting for each: a repository
 * set's archive once, a zip set's pack once, and a link set's files one at a time. Throws when a file's bytes aren't
 * the ones the manifest pins, a link isn't one to its set's files, or a source lacks one.
 */
export async function readArtworkFiles<F extends Pick<ArtworkStyleFile, 'set' | 'source' | 'sha256'>>(
  wanted: readonly F[],
  onFile: (file: F, bytes: Uint8Array) => Promise<void>,
  readers: ArtworkReaders = READERS,
): Promise<void> {
  const told = new Set<F>()
  const tell = async (file: F, bytes: Uint8Array) => {
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== file.sha256) throw new Error(`${file.source} has SHA-256 ${sha256}, not the pinned ${file.sha256}`)
    await onFile(file, bytes)
    told.add(file)
  }
  for (const set of new Set(wanted.map((file) => file.set))) {
    const ofSet = wanted.filter((file) => file.set === set)
    const bySource = new Map(ofSet.map((file) => [file.source, file]))
    const { source } = ARTWORK_SETS[set]
    if ('repository' in source)
      await readRepositoryArtwork(
        set,
        async ({ path, bytes }) => {
          const file = bySource.get(path)
          if (file) await tell(file, bytes)
        },
        readers,
      )
    else if ('zip' in source)
      for (const { path, bytes } of await readZipArtwork(set, readers)) {
        const file = bySource.get(path)
        if (file) await tell(file, bytes)
      }
    else
      for (const file of ofSet) {
        if (!linksInto(file.source, source.files)) throw new Error(`${file.source} is not a link to ${set}'s files`)
        await tell(file, await readers.link(file.source))
      }
  }
  const missing = wanted.filter((file) => !told.has(file))
  if (missing.length > 0) throw new Error(`the sources lack ${missing.map(({ source }) => source).join(', ')}`)
}

/** Whether the link is one to a file under `files`, as it is written: no `..` or other step a fetch would resolve. */
function linksInto(link: string, files: string): boolean {
  try {
    const url = new URL(link)
    return url.href === link && url.protocol === 'https:' && link.startsWith(files)
  } catch {
    return false
  }
}

/** Each pattern's tile of the pattern index file at `path`, its path `path#slug`. */
function patternFiles(path: string, index: string): SourceFile[] {
  return patternsOf(index).map((pattern) => ({
    path: `${path}#${pattern.slug}`,
    bytes: new TextEncoder().encode(patternTile(pattern)),
    pattern,
  }))
}
