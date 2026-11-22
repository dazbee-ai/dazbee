// The file of a checkout of google/fonts, at `GOOGLE_FONTS`'s commit, that draws a font key, for the
// scripts that read faces from one.

import { join } from 'node:path'

import { GOOGLE_FONTS, googleFaces,type GoogleFamily } from '@dazbee/fonts/google'

import { faceOfKey, parseFontKey } from '../src/text/font-key.ts'

/** The face's family and the path of its file in `checkout`; null when no face of the catalog draws `key`. */
export function googleFaceFile(checkout: string, key: string): { family: GoogleFamily; path: string } | null {
  const parsed = parseFontKey(key)
  const family = parsed && GOOGLE_FONTS.find((f) => f.family === parsed.family)
  const found = parsed && family ? faceOfKey(parsed, googleFaces(family)) : null
  return family && found ? { family, path: join(checkout, family.path, found.face.file) } : null
}
