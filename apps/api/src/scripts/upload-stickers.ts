// Stores the picture stickers the repository doesn't hold (Fluent Emoji's 3D pictures) in Dazbee's storage, under
// `bundled/<sha256>`, read from Fluent Emoji's GitHub archive at the commit @dazbee/graphics pins and checked against
// the SHA-256 its manifest (`sticker-pictures.json`) lists. Run it once per environment, and again after
// `pnpm --filter @dazbee/graphics stickers` writes the manifest anew: files stored before are skipped, and a run with
// nothing to store doesn't download the archive. Settings come from the environment, as the API's do.
import { readStickerPictures } from '@dazbee/graphics/archive'
import { stickerPictures } from '@dazbee/graphics/pictures'
import { openStorage, storageSettings } from '@dazbee/storage'

import { storeBundled } from '../assets/bundled.ts'

const storage = openStorage(storageSettings())
if (process.env.STORAGE_CREATE_BUCKET === 'on') await storage.ensureBucket()
const pictures = stickerPictures()
const megabytes = (pictures.reduce((sum, picture) => sum + picture.byteSize, 0) / 1_000_000).toFixed(1)
console.log(`${pictures.length} picture stickers, ${megabytes} MB, listed`)
const started = Date.now()
const { stored, already } = await storeBundled(storage, pictures, readStickerPictures)
const seconds = ((Date.now() - started) / 1000).toFixed(0)
console.log(`Stored ${stored} in ${seconds} s; ${already} were stored before.`)
