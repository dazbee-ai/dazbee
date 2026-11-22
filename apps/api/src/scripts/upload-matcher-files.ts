// Stores the matchers' files in Dazbee's storage under `matchers/<sha256>`, each downloaded from the GitHub release
// `@dazbee/matchers/release` names and checked against its SHA-256 there, so the API can answer them at their
// permanent addresses. Run it once per environment, and again after a change to that release is deployed: files
// stored before are skipped. Settings come from the environment, as the API's do.
import { RELEASE_FILES, RELEASE_TAG } from '@dazbee/matchers/release-files'
import { openStorage, storageSettings } from '@dazbee/storage'

import { storeMatcherFiles } from '../matchers/matcher-files.ts'

const storage = openStorage(storageSettings())
if (process.env.STORAGE_CREATE_BUCKET === 'on') await storage.ensureBucket()
const megabytes = (RELEASE_FILES.reduce((sum, file) => sum + file.size, 0) / 1_000_000).toFixed(1)
console.log(`${RELEASE_FILES.length} matcher files of ${RELEASE_TAG}, ${megabytes} MB, listed`)
const started = Date.now()
const { stored, already } = await storeMatcherFiles(storage)
const seconds = ((Date.now() - started) / 1000).toFixed(0)
console.log(`Stored ${stored} in ${seconds} s; ${already} were stored before.`)
