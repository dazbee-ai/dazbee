// The matchers' files in our storage: each file the release lists, downloaded from the release and checked against
// its SHA-256, stored once under `matchers/<sha256>`, where the matchers' permanent addresses read it.
import { type DownloadFile, downloadReleaseFile, RELEASE_FILES, type ReleaseFile } from '@dazbee/matchers/release-files'
import type { Storage } from '@dazbee/storage'

import { matcherFileKey } from '../storage-keys.ts'

/**
 * Stores each of `files` that storage doesn't hold yet, its bytes from the release (or `download`) checked first;
 * answers how many it stored and how many were stored before.
 */
export async function storeMatcherFiles(
  storage: Storage,
  files: readonly ReleaseFile[] = RELEASE_FILES,
  download?: DownloadFile,
): Promise<{ stored: number; already: number }> {
  let stored = 0
  for (const file of files) {
    const key = matcherFileKey(file.sha256)
    if (await storage.exists(key)) continue
    await storage.put(key, await downloadReleaseFile(file, download), 'application/octet-stream')
    stored++
  }
  return { stored, already: files.length - stored }
}
