// Makes the match copy of every Google face in storage that has none, under `fonts/google/match/v<version>/<sha256>`,
// so the API can answer it at the face's permanent match address. Run it once per environment for the faces copied
// before `fonts:google` made match copies, and again after `MATCH_COPY_VERSION` is raised; `fonts:google` makes the
// copy of each face it copies. A run stopped part way picks up where it stopped when run again, and copies made before
// are left as they are. Settings come from the environment, as the API's do.
import { openDatabase } from '@dazbee/db'
import { openStorage, storageSettings } from '@dazbee/storage'

import { facesWithoutMatchCopy, makeMatchCopy } from '../fonts/google.ts'

/** How many copies are made at once: reading and storing wait on storage, and cutting a big face takes memory. */
const AT_ONCE = 2

const databaseUrl = process.env.DATABASE_URL
if (!databaseUrl) throw new Error('DATABASE_URL is not set')
const storage = openStorage(storageSettings())
const { db, close } = openDatabase(databaseUrl)
const started = Date.now()
const total = { made: 0, faceBytes: 0, copyBytes: 0, whole: 0, missing: [] as string[], failed: [] as string[] }
try {
  const wanted = await facesWithoutMatchCopy(db, storage)
  console.log(`Making the match copies of ${wanted.length} Google face files`)
  let next = 0
  const makeNext = async (): Promise<void> => {
    const sha256 = wanted[next++]
    if (!sha256) return
    try {
      const made = await makeMatchCopy(storage, sha256)
      if (!made) total.missing.push(sha256)
      else {
        total.made++
        total.faceBytes += made.faceBytes
        total.copyBytes += made.copyBytes
        if (made.whole) total.whole++
      }
    } catch (reason) {
      total.failed.push(sha256)
      console.log(`${sha256}: ${reason instanceof Error ? reason.message : String(reason)}`)
    }
    const done = total.made + total.missing.length + total.failed.length
    if (done % 100 === 0 || done === wanted.length) console.log(`[${done}/${wanted.length}]`)
    return makeNext()
  }
  await Promise.all(Array.from({ length: AT_ONCE }, makeNext))
  const left = (await facesWithoutMatchCopy(db, storage)).length
  console.log(`${left} Google face files have no match copy now.`)
} finally {
  await close()
}
const minutes = ((Date.now() - started) / 60_000).toFixed(1)
console.log(
  `Made ${total.made} match copies, ${megabytes(total.copyBytes)} of faces of ${megabytes(total.faceBytes)}, in ${minutes} min; ${total.whole} kept whole, as HarfBuzz could not cut them.`,
)
if (total.missing.length > 0)
  console.log(`${total.missing.length} faces are not in storage: ${total.missing.join(', ')}`)
if (total.failed.length > 0) {
  console.log(`${total.failed.length} failed; run again to make them.`)
  process.exitCode = 1
}

/** Bytes as megabytes, for people. */
function megabytes(bytes: number): string {
  return `${(bytes / 1e6).toFixed(1)} MB`
}
