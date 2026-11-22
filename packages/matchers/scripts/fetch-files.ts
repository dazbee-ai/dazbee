// Puts the matchers' files that `src/release.json` names into the git-ignored `.files/`, each checked against its
// SHA-256, for the tests and scripts that read them: `pnpm --filter @dazbee/matchers files`, run by hand, by CI
// before the tests and by an image that needs them, never on install. A file already there and whole is kept; a
// missing or different one is downloaded again. Offline, it fails with a sentence naming the file it lacks.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  type DownloadFile,
  downloadReleaseFile,
  isReleaseFile,
  RELEASE_FILES,
  type ReleaseFile,
} from '../src/release-files.ts'

/** Where the files are put, each under its name. */
export const FILES_DIR = join(import.meta.dirname, '..', '.files')

/** Puts each of `files` whole into `dir`, downloading only those missing or different; answers which it downloaded. */
export async function fetchFiles({
  dir = FILES_DIR,
  files = RELEASE_FILES,
  download,
}: { dir?: string; files?: readonly ReleaseFile[]; download?: DownloadFile } = {}): Promise<{
  fetched: string[]
  kept: string[]
}> {
  mkdirSync(dir, { recursive: true })
  const fetched: string[] = []
  const kept: string[] = []
  for (const file of files) {
    const path = join(dir, file.name)
    if (existsSync(path) && isReleaseFile(readFileSync(path), file)) {
      kept.push(file.name)
      continue
    }
    const bytes = await downloadReleaseFile(file, download)
    writeFileSync(`${path}.part`, bytes)
    renameSync(`${path}.part`, path)
    fetched.push(file.name)
  }
  return { fetched, kept }
}

if (import.meta.main) {
  try {
    const { fetched, kept } = await fetchFiles()
    console.log(
      `@dazbee/matchers: ${fetched.length} files downloaded, ${kept.length} already in place, into ${FILES_DIR}`,
    )
  } catch (e) {
    console.error(`@dazbee/matchers: ${(e as Error).message}`)
    process.exit(1)
  }
}
