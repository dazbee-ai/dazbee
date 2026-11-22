// Stores the illustrations' SVG files, which the repository doesn't hold, in Dazbee's storage under
// `bundled/<sha256>`, read from the sources @dazbee/graphics pins (a repository's GitHub archive at a commit, or a
// gallery's links) and checked against the SHA-256 its manifest (`illustrations.json`) lists. Run it once per
// environment, and again after `pnpm --filter @dazbee/graphics illustrations` writes the manifest anew: files stored
// before are skipped, and a run with nothing to store reads no source. Settings come from the environment, as the
// API's do.
import { readIllustrationFiles } from '@dazbee/graphics/illustration-sources'
import { illustrations } from '@dazbee/graphics/illustrations'
import { openStorage, storageSettings } from '@dazbee/storage'

import { storeBundled } from '../assets/bundled.ts'

const storage = openStorage(storageSettings())
if (process.env.STORAGE_CREATE_BUCKET === 'on') await storage.ensureBucket()
const files = illustrations()
const megabytes = (files.reduce((sum, file) => sum + file.byteSize, 0) / 1_000_000).toFixed(1)
console.log(`${files.length} illustrations, ${megabytes} MB, listed`)
const started = Date.now()
const { stored, already } = await storeBundled(storage, files, (wanted, onFile) =>
  readIllustrationFiles(wanted, onFile),
)
const seconds = ((Date.now() - started) / 1000).toFixed(0)
console.log(`Stored ${stored} in ${seconds} s; ${already} were stored before.`)
