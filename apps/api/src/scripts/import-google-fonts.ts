// Copies the Google Fonts families Dazbee offers (`GOOGLE_FONTS`, the script fonts among them) from
// google/fonts into our storage: every family, or only those named, as in
// `pnpm --filter @dazbee/api fonts:google Inter "Noto Color Emoji"`. Run it once per environment, and
// again after `google-fonts.json` is written anew; a run stopped part way, or one with families that
// failed, picks up where it stopped when run again, and files copied before are not fetched again.
// From then on fonts load from our storage only. Settings come from the environment, as the API's do.
import { migrateDatabase, openDatabase } from '@dazbee/db'
import type { GoogleFamily } from '@dazbee/fonts'
import { GOOGLE_FONTS, GOOGLE_FONTS_COMMIT } from '@dazbee/fonts/google'
import { openStorage, storageSettings } from '@dazbee/storage'

import { copiedSources, type FamilyCopy, importGoogleFamily } from '../fonts/google.ts'

/** How many families are copied at once. */
const AT_ONCE = 2

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is not set')
const named = process.argv.slice(2)
const unknown = named.filter((family) => !GOOGLE_FONTS.some((f) => f.family === family))
if (unknown.length > 0) throw new Error(`not in packages/fonts' GOOGLE_FONTS: ${unknown.join(', ')}`)
const wanted = named.length > 0 ? GOOGLE_FONTS.filter((f) => named.includes(f.family)) : GOOGLE_FONTS
const files = wanted.flatMap((family) => family.faces)
console.log(
  `Copying ${wanted.length} families, ${files.length} files, ${megabytes(files.reduce((sum, f) => sum + f.bytes, 0))}, from google/fonts ${GOOGLE_FONTS_COMMIT.slice(0, 12)}`,
)

const storage = openStorage(storageSettings())
if (process.env.STORAGE_CREATE_BUCKET === 'on') await storage.ensureBucket()
const { db, close } = openDatabase(databaseUrl)
const started = Date.now()
const total = { copied: 0, bytes: 0, upToDate: 0 }
const failed: string[] = []
try {
  await migrateDatabase(db)
  const copied = await copiedSources(storage)
  let next = 0
  let finished = 0
  const copyNext = async (): Promise<void> => {
    const family = wanted[next++]
    if (!family) return
    const line = await copy(family, copied)
    console.log(`[${++finished}/${wanted.length}] ${line}`)
    return copyNext()
  }
  await Promise.all(Array.from({ length: AT_ONCE }, copyNext))
} finally {
  await close()
}
const minutes = ((Date.now() - started) / 60_000).toFixed(1)
console.log(
  `Copied ${total.copied} files, ${megabytes(total.bytes)}, in ${minutes} min; ${total.upToDate} files were already copied.`,
)
if (failed.length > 0) {
  console.log(`${failed.length} families failed; run again to copy them: ${failed.join(', ')}`)
  process.exitCode = 1
}

/** Copies one family, adding to the totals, and says what it did; a family that fails is noted and the run goes on. */
async function copy(family: GoogleFamily, copied: Map<string, string>): Promise<string> {
  const done = await importGoogleFamily(db, storage, family, { copied }).catch((reason: unknown): FamilyCopy => ({
    copied: 0,
    bytes: 0,
    upToDate: 0,
    failed: reason instanceof Error ? reason.message : String(reason),
  }))
  total.copied += done.copied
  total.bytes += done.bytes
  total.upToDate += done.upToDate
  const did =
    done.copied === 0
      ? 'up to date'
      : `${done.copied} file${done.copied === 1 ? '' : 's'} copied, ${megabytes(done.bytes)}`
  if (!done.failed) return `${family.family}: ${did}`
  failed.push(family.family)
  return `${family.family}: failed at ${done.failed}${done.copied > 0 ? ` (${did} before it)` : ''}`
}

/** Bytes as megabytes, for people. */
function megabytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`
}
