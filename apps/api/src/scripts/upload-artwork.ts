// Stores the artwork sets' files (objects, 3D objects, shapes, accents, effects and backgrounds), which the repository
// doesn't hold, in Dazbee's storage under `bundled/<sha256>`, read from the sources @dazbee/graphics pins (a
// repository's GitHub archive at a commit, links, or a zip pack) and checked against the SHA-256 its manifest
// (`artwork.json`) lists. Run it once per environment, and again after `pnpm --filter @dazbee/graphics artwork` writes
// the manifest anew: files stored before are skipped, and a run with nothing to store reads no source. Settings come
// from the environment, as the API's do.
import { artworkFiles } from '@dazbee/graphics/artwork'
import { readArtworkFiles } from '@dazbee/graphics/artwork-sources'
import { openStorage, storageSettings } from '@dazbee/storage'

import { storeBundled } from '../assets/bundled.ts'

const storage = openStorage(storageSettings())
if (process.env.STORAGE_CREATE_BUCKET === 'on') await storage.ensureBucket()
const files = artworkFiles()
const megabytes = (files.reduce((sum, file) => sum + file.byteSize, 0) / 1_000_000).toFixed(1)
console.log(`${files.length} artwork files, ${megabytes} MB, listed`)
const started = Date.now()
const { stored, already } = await storeBundled(storage, files, (wanted, onFile) => readArtworkFiles(wanted, onFile))
const seconds = ((Date.now() - started) / 1000).toFixed(0)
console.log(`Stored ${stored} in ${seconds} s; ${already} were stored before.`)
