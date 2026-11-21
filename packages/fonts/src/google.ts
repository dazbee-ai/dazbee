// Every Google Fonts family Dazbee offers, as `pnpm --filter @dazbee/fonts google-fonts` writes them
// into `google-fonts.json` from Google's own metadata (`google-metadata.ts`). The files are copied
// into our storage by `pnpm --filter @dazbee/api fonts:google`, and from then on loaded from there
// like any other font file: never from Google, the system or the browser at render time.
import list from './google-fonts.json' with { type: 'json' }

/** A family's kind of letter, as Google Fonts sorts it. */
export type FontCategory = 'sans-serif' | 'serif' | 'display' | 'handwriting' | 'monospace'

/** The licences Dazbee takes a Google family under; a family under any other is left out. */
export type GoogleLicence = 'OFL' | 'Apache-2.0' | 'UFL'

/** One font file of a Google family, in its folder of google/fonts. */
export interface GoogleFile {
  /** Its name in the family's folder, such as `Inter[opsz,wght].ttf`. */
  file: string
  /** Its git blob SHA-1, which the bytes copied are checked against. */
  blob: string
  /** Its size in bytes. */
  bytes: number
  /** Its weight; a variable file's default, which its own `fvar` table confirms. */
  weight: number
  style: 'normal' | 'italic'
}

/** A Google Fonts family: what the chooser lists it by, and the files the import copies. */
export interface GoogleFamily {
  family: string
  category: FontCategory
  /** Its place in Google Fonts' popularity order, 1 the most used. */
  rank: number
  licence: GoogleLicence
  /** Its folder in google/fonts, such as `ofl/inter`. */
  path: string
  /** The writing systems it draws, as ISO 15924 codes such as `Latn`, `Arab` or `Jpan`, most families' first. */
  scripts: string[]
  /** Its variable axes, such as `wght` from 100 to 900; none for a family of static files. */
  axes: { tag: string; min: number; max: number }[]
  faces: GoogleFile[]
}

/** The commit of google/fonts the list was written from, which the import copies the files of. */
export const GOOGLE_FONTS_COMMIT: string = list.commit

/**
 * Every family Google Fonts serves under the OFL, Apache 2.0 or UFL, in its popularity order, but
 * the families we ship (`FONT_FACES`), which the catalog has from our own files.
 */
export const GOOGLE_FONTS: readonly GoogleFamily[] = list.families as GoogleFamily[]

/** Where google/fonts serves a family's file, at the commit the list was written from. */
export function googleFileUrl(family: Pick<GoogleFamily, 'path'>, face: Pick<GoogleFile, 'file'>): string {
  return `https://raw.githubusercontent.com/google/fonts/${GOOGLE_FONTS_COMMIT}/${family.path}/${encodeURIComponent(face.file)}`
}
