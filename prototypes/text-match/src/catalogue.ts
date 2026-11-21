// PROTOTYPE. The font catalogue as the matcher sees it: every face Dazbee can draw, with its file,
// and the scripts each face covers (read from its own cmap with CanvasKit).
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'

export const PROTOTYPE_DIR = join(import.meta.dirname, '..')
export const DATA_DIR = join(PROTOTYPE_DIR, '.data')
export const FONTS_DIR = join(DATA_DIR, 'fonts')

export type Category = 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace'
export type Script = 'latin' | 'arabic' | 'devanagari'
export const SCRIPTS: readonly Script[] = ['latin', 'arabic', 'devanagari']

export interface CatalogueFace {
  family: string
  weight: number
  style: 'normal' | 'italic'
  category: Category
  file: string
  source: 'shipped' | 'google'
  /** Offered in the font menu: script fonts are not. */
  menu: boolean
  sha256?: string
  /** The scripts whose test letters the face draws all of. */
  scripts?: Script[]
}

/** The letters a face must draw to count as covering a script. */
export const SCRIPT_PROBES: Readonly<Record<Script, string>> = {
  latin: 'AaBbEeGgMmRrSsWwZz019$%&',
  arabic: 'ابتثجحخدذرزسشصضطظعغفقكلمنهوي',
  devanagari: 'अआइईउऊएऐओऔकखगघचछजझटठडढणतथदधनपफबभमयरलवशषसह',
}

/** The script a text is written in, by its letters; Latin when it has none of the others. */
export function scriptOf(text: string): Script {
  if (/\p{Script=Arabic}/u.test(text)) return 'arabic'
  if (/\p{Script=Devanagari}/u.test(text)) return 'devanagari'
  return 'latin'
}

export function loadCatalogue(path?: string): CatalogueFace[] {
  if (path) return JSON.parse(readFileSync(path, 'utf8')) as CatalogueFace[]
  const withScripts = join(FONTS_DIR, 'catalogue-scripts.json')
  const file = existsSync(withScripts) ? withScripts : join(FONTS_DIR, 'catalogue.json')
  return JSON.parse(readFileSync(file, 'utf8')) as CatalogueFace[]
}

export const faceId = (f: Pick<CatalogueFace, 'family' | 'weight' | 'style'>) => `${f.family}|${f.weight}|${f.style}`

export function fontBytes(face: CatalogueFace): Uint8Array {
  return new Uint8Array(readFileSync(isAbsolute(face.file) ? face.file : join(FONTS_DIR, 'files', face.file)))
}

/** The whole Google Fonts library (library.ts), loaded on first use. */
export const LIBRARY: CatalogueFace[] = existsSync(join(FONTS_DIR, 'library.json'))
  ? loadCatalogue(join(FONTS_DIR, 'library.json'))
  : []

/** The faces of the families text falls back to, from a face list, for a drawer to keep registered. */
export const fallbackFaces = (faces: readonly CatalogueFace[]) =>
  faces.filter((f) => FALLBACK_FAMILIES.includes(f.family))
