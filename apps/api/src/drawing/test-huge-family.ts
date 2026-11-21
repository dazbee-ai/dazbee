// A family of faces each padded to the size of a large CJK face's file, uploaded straight into a
// brand's catalogue, for tests of how much of a family drawing reads.
import { newId } from '@dazbee/db'
import { restyledTestFont, variableTestFont } from '@dazbee/fonts/test-fonts'
import type { Storage } from '@dazbee/storage'

import { replaceFace } from '../fonts/fonts.ts'
import { uploadedFontKey } from '../storage-keys.ts'
import { db } from '../test-api.ts'
import { fontFile, sha256 } from '../test-files.ts'

/** The size of each face: Chiron Sung HK's two files are 49.5 and 48.3 MB. */
export const HUGE_FACE_BYTES = 50 * 1024 * 1024

/**
 * Uploads `family` to the brand: five upright static faces, 100 to 900, and an italic variable one,
 * each padded with `padding` bytes. Gives back the storage key of each face's file by its weight and style.
 */
export async function uploadHugeFamily(
  storage: Storage,
  workspaceId: string,
  brandId: string,
  family: string,
  padding = HUGE_FACE_BYTES,
): Promise<Map<string, string>> {
  const keys = new Map<string, string>()
  const faces = [
    ...[100, 300, 400, 700, 900].map((weight) => ({ weight, style: 'normal' as const, weights: null })),
    { weight: 400, style: 'italic' as const, weights: { min: 100, max: 900 } },
  ]
  for (const face of faces) {
    const source = face.weights ? variableTestFont() : fontFile('NotoSans-Regular.ttf')
    const bytes = restyledTestFont(source, {
      weight: face.weight,
      italic: face.style === 'italic',
      padding,
    })
    const hash = sha256(bytes)
    const key = uploadedFontKey(workspaceId, hash)
    await storage.put(key, bytes, 'font/ttf')
    await replaceFace(db, {
      id: newId(),
      workspaceId,
      brandId,
      source: 'upload',
      family,
      weight: face.weight,
      weightMin: face.weights?.min ?? null,
      weightMax: face.weights?.max ?? null,
      style: face.style,
      category: null,
      sha256: hash,
      byteSize: bytes.length,
    })
    keys.set(`${face.weight} ${face.style}`, key)
  }
  return keys
}
