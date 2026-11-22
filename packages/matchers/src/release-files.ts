// The matchers' files as the GitHub release `release.json` names them: each file's name, SHA-256 and size, where the
// release serves it, and its bytes downloaded and checked. Node only, for the fetch script, CI and `matchers:upload`;
// the browser reads the files at their permanent addresses.
import { createHash } from 'node:crypto'

import release from './release.json' with { type: 'json' }

/** One file of the release. */
export interface ReleaseFile {
  name: string
  sha256: string
  size: number
}

/** Fetches a file's bytes; whatever it gives back is checked against the file. */
export type DownloadFile = (file: ReleaseFile) => Promise<Uint8Array>

/** The release's tag, `matchers-<hash>`. */
export const RELEASE_TAG: string = release.tag
export const RELEASE_FILES: readonly ReleaseFile[] = Object.entries(release.files).map(([name, file]) => ({
  name,
  ...file,
}))

/** How long one file's download may take before it counts as failed. */
const DOWNLOAD_MS = 5 * 60_000

/**
 * The file's bytes from the release, or from `download`, checked against its SHA-256 and size. It throws a sentence
 * naming the file when the download fails, as when offline, or gives other bytes.
 */
export async function downloadReleaseFile(
  file: ReleaseFile,
  download: DownloadFile = fromRelease,
): Promise<Uint8Array> {
  let bytes: Uint8Array
  try {
    bytes = await download(file)
  } catch (e) {
    throw new Error(
      `Couldn't download ${file.name}, a matcher file, from the release ${RELEASE_TAG} (${(e as Error).message}); check the connection and run it again`,
      { cause: e },
    )
  }
  if (!isReleaseFile(bytes, file))
    throw new Error(`${file.name} as downloaded from the release ${RELEASE_TAG} is not the file release.json lists`)
  return bytes
}

/** Whether `bytes` are the file: its size and SHA-256. */
export function isReleaseFile(bytes: Uint8Array, file: ReleaseFile): boolean {
  return bytes.length === file.size && createHash('sha256').update(bytes).digest('hex') === file.sha256
}

/** The file from the release's public download address. */
async function fromRelease(file: ReleaseFile): Promise<Uint8Array> {
  const url = `https://github.com/${release.repo}/releases/download/${RELEASE_TAG}/${encodeURIComponent(file.name)}`
  const response = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_MS) })
  if (!response.ok) throw new Error(`GitHub answered ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}
