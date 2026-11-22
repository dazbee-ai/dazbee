// The illustration sets' files read from their pinned sources: a repository set's SVG files from its GitHub archive at
// the commit `sets.ts` pins, the accent written for the CSS variable the files paint it with; a gallery set's files from
// their links, one at a time. `write-illustrations.ts` reads every file to write the manifest, and the API's
// `illustrations:upload` reads the files storage lacks, each checked against the SHA-256 the manifest lists.
import { createHash } from 'node:crypto'

import type { Illustration } from './illustrations.ts'
import { readGitHubArchive, type TarFile } from './read-tar.ts'
import { ILLUSTRATION_SETS, type IllustrationSetId } from './sets.ts'

/** How to reach the sources: a repository's archive, and a gallery's file at its link. Tests give stand-ins. */
export interface IllustrationReaders {
  archive: (source: { repository: string; commit: string }, onFile: TarFile) => Promise<void>
  link: (url: string) => Promise<Uint8Array>
}

/** How fetching from a gallery names itself to the gallery's server. */
export const USER_AGENT = 'illustration-set-fetch/1.0 (node)'
/** How long to wait before each file fetched from a gallery, so its server is never pressed. */
const GALLERY_PAUSE_MS = 250
/** How long one fetch from a gallery may take before it fails. */
const FETCH_TIMEOUT_MS = 30_000
/** The most bytes a file fetched from a gallery may have: an SVG upload's most (MAX_SVG_BYTES in @dazbee/schema). */
const MAX_FILE_BYTES = 5_000_000

const READERS: IllustrationReaders = { archive: readGitHubArchive, link: fetchLink }

/**
 * Tells `onFile` each SVG file of the repository set `set` in its folder, its path from the repository's root and its
 * bytes with the accent written for the set's CSS variable, waiting for each.
 */
export async function readRepositorySet(
  set: IllustrationSetId,
  onFile: (path: string, bytes: Uint8Array) => Promise<void>,
  readers: IllustrationReaders = READERS,
): Promise<void> {
  const { source } = ILLUSTRATION_SETS[set]
  if (!('repository' in source)) throw new Error(`${set} is not taken from a repository`)
  await readers.archive(source, async (path, bytes) => {
    if (path.startsWith(`${source.folder}/`) && path.endsWith('.svg')) await onFile(path, withAccent(set, bytes))
  })
}

/**
 * Reads the files of `wanted` from their sources and tells `onFile` each one's bytes, waiting for each: a repository
 * set's archive once, and a gallery set's files one at a time. Throws when a file's bytes aren't the ones the manifest
 * pins, or a source lacks one.
 */
export async function readIllustrationFiles<I extends Pick<Illustration, 'set' | 'source' | 'sha256'>>(
  wanted: readonly I[],
  onFile: (illustration: I, bytes: Uint8Array) => Promise<void>,
  readers: IllustrationReaders = READERS,
): Promise<void> {
  const told = new Set<I>()
  const tell = async (illustration: I, bytes: Uint8Array) => {
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (sha256 !== illustration.sha256)
      throw new Error(`${illustration.source} has SHA-256 ${sha256}, not the pinned ${illustration.sha256}`)
    await onFile(illustration, bytes)
    told.add(illustration)
  }
  for (const set of new Set(wanted.map((illustration) => illustration.set))) {
    const ofSet = wanted.filter((illustration) => illustration.set === set)
    if ('repository' in ILLUSTRATION_SETS[set].source) {
      const byPath = new Map(ofSet.map((illustration) => [illustration.source, illustration]))
      await readRepositorySet(
        set,
        async (path, bytes) => {
          const illustration = byPath.get(path)
          if (illustration) await tell(illustration, bytes)
        },
        readers,
      )
    } else
      for (const illustration of ofSet) {
        const { source } = ILLUSTRATION_SETS[set]
        if (!('files' in source) || !illustration.source.startsWith(source.files))
          throw new Error(`${illustration.source} is not a link to ${set}'s files`)
        await tell(illustration, await readers.link(illustration.source))
      }
  }
  const missing = wanted.filter((illustration) => !told.has(illustration))
  if (missing.length > 0) throw new Error(`the sources lack ${missing.map(({ source }) => source).join(', ')}`)
}

/**
 * The bytes at a gallery's link, fetched after a pause of `pauseMs`; throws when the gallery doesn't give them within
 * FETCH_TIMEOUT_MS, or gives more than `maxBytes`.
 */
export async function fetchLink(
  url: string,
  { pauseMs = GALLERY_PAUSE_MS, maxBytes = MAX_FILE_BYTES }: { pauseMs?: number; maxBytes?: number } = {},
): Promise<Uint8Array> {
  await new Promise((resolve) => setTimeout(resolve, pauseMs))
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!response.ok || !response.body) throw new Error(`${url} answered ${response.status}`)
  const chunks: Uint8Array[] = []
  let length = 0
  for await (const chunk of response.body) {
    length += chunk.length
    if (length > maxBytes) throw new Error(`${url} gives more than ${maxBytes} bytes`)
    chunks.push(chunk)
  }
  return new Uint8Array(Buffer.concat(chunks))
}

/** A repository set's file with the accent written for the CSS variable it paints the accent with, if any. */
function withAccent(set: IllustrationSetId, bytes: Buffer): Uint8Array {
  const { source, accent } = ILLUSTRATION_SETS[set]
  const variable = 'accentVariable' in source ? source.accentVariable : undefined
  if (!variable) return new Uint8Array(bytes)
  return new TextEncoder().encode(bytes.toString('utf8').replaceAll(variable, accent))
}
