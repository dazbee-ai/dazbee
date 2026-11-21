// Reads Google Fonts' own metadata into the families Dazbee offers: each family's METADATA.pb in
// google/fonts (its licence, files, axes and subsets), the repository's git tree (each file's blob
// and size), Google Fonts' public family listing (what it serves, each family's category and
// popularity), and Unicode's script names, which turn Google's subsets into ISO 15924 codes.
import type { FontCategory, GoogleFamily, GoogleFile, GoogleLicence } from './google.ts'
import { messages, numberField, parseTextFormat, stringField } from './text-format.ts'

/** What a family's METADATA.pb says, of what the list keeps. */
export interface FamilyMetadata {
  name: string
  license: string
  fonts: { style: string; weight: number; filename: string }[]
  subsets: string[]
  axes: { tag: string; min: number; max: number }[]
  /** The ISO 15924 code of the script it is made for, when it names one. */
  primaryScript: string | null
}

/** A file in the git tree of google/fonts. */
export interface TreeEntry {
  path: string
  /** Its git blob SHA-1. */
  sha: string
  size: number
}

/** A family in Google Fonts' public listing (`https://fonts.google.com/metadata/fonts`). */
export interface ListedFamily {
  family: string
  category: string
  /** Lower is more used; families can share a value. */
  popularity: number
  /** Google Fonts' own order of its families, which settles a tie in popularity. */
  defaultSort: number
}

/** The families offered, and each family left out with why. */
export interface FontList {
  families: GoogleFamily[]
  leftOut: { family: string; reason: string }[]
}

/** The licences METADATA.pb names, as the list names them; a family under any other is left out. */
const LICENCES: Readonly<Record<string, GoogleLicence>> = { OFL: 'OFL', APACHE2: 'Apache-2.0', UFL: 'UFL' }

/** Google Fonts' categories, as the list names them. */
const CATEGORIES: Readonly<Record<string, FontCategory>> = {
  'Sans Serif': 'sans-serif',
  Serif: 'serif',
  Display: 'display',
  Handwriting: 'handwriting',
  Monospace: 'monospace',
}

/**
 * The scripts of Google's subsets that are not named for one Unicode script: a part of a script's
 * letters, a language, a set of CJK characters, or signs (ISO 15924's Zsye, Zsym and Zmth). The
 * menu subset and those of numerals alone name no script.
 */
const SUBSET_SCRIPTS: Readonly<Record<string, readonly string[]>> = {
  'latin-ext': ['Latn'],
  vietnamese: ['Latn'],
  'cyrillic-ext': ['Cyrl'],
  'greek-ext': ['Grek'],
  japanese: ['Jpan'],
  'kana-extended': ['Jpan'],
  korean: ['Kore'],
  'chinese-simplified': ['Hans'],
  'chinese-traditional': ['Hant'],
  'chinese-hongkong': ['Hant'],
  'tamil-supplement': ['Taml'],
  meroitic: ['Merc', 'Mero'],
  emoji: ['Zsye'],
  symbols: ['Zsym'],
  symbols2: ['Zsym'],
  music: ['Zsym'],
  znamenny: ['Zsym'],
  math: ['Zmth'],
  menu: [],
  'mayan-numerals': [],
  'indic-siyaq-numbers': [],
  'ottoman-siyaq-numbers': [],
}

/**
 * The families Dazbee offers: every family Google Fonts lists whose METADATA.pb names the OFL,
 * Apache 2.0 or UFL and whose files are all in the tree, but those named `shipped`, ranked by
 * the listing's popularity (then Google Fonts' own order, then name). Every other family is left out, saying why.
 */
export function googleFontList({
  metadata,
  tree,
  listing,
  aliases,
  shipped,
}: {
  /** Each METADATA.pb, by the path of the family's folder, such as `ofl/inter`. */
  metadata: readonly { path: string; text: string }[]
  tree: readonly TreeEntry[]
  listing: readonly ListedFamily[]
  /** Unicode's PropertyValueAliases.txt. */
  aliases: string
  shipped: ReadonlySet<string>
}): FontList {
  const codes = scriptCodes(aliases)
  const files = new Map(tree.map((entry) => [entry.path, entry]))
  const listed = new Map(listing.map((family) => [family.family, family]))
  const leftOut: FontList['leftOut'] = []
  const kept: {
    family: Omit<GoogleFamily, 'rank'>
    popularity: number
    defaultSort: number
    primaryScript: string | null
  }[] = []
  const seen = new Set<string>()
  for (const { path, text } of [...metadata].sort((a, b) => byCodeUnits(a.path, b.path))) {
    const meta = parseMetadata(text)
    const listedFamily = listed.get(meta.name)
    const refuse = (reason: string) => leftOut.push({ family: meta.name, reason })
    const licence = LICENCES[meta.license]
    const category = listedFamily && CATEGORIES[listedFamily.category]
    if (!licence) refuse(`its licence is ${meta.license}`)
    else if (!listedFamily) refuse('Google Fonts does not serve it')
    else if (shipped.has(meta.name)) refuse('we ship it')
    else if (seen.has(meta.name)) refuse(`another folder holds it too, so ${path} is left out`)
    else if (!category) refuse(`Google Fonts' category ${listedFamily.category} is not one we know`)
    else {
      const faces = facesOf(meta, path, files)
      if (typeof faces === 'string') refuse(faces)
      else {
        seen.add(meta.name)
        kept.push({
          family: {
            family: meta.name,
            category,
            licence,
            path,
            scripts: subsetScripts(meta.subsets, codes),
            axes: meta.axes,
            faces,
          },
          popularity: listedFamily.popularity,
          defaultSort: listedFamily.defaultSort,
          primaryScript: meta.primaryScript,
        })
      }
    }
  }
  for (const family of listing)
    if (!seen.has(family.family) && !leftOut.some((one) => one.family === family.family))
      leftOut.push({ family: family.family, reason: 'google/fonts has no METADATA.pb for it' })
  const drawnBy = new Map<string, number>()
  for (const { family } of kept) for (const code of family.scripts) drawnBy.set(code, (drawnBy.get(code) ?? 0) + 1)
  const families = kept
    .sort(
      (a, b) =>
        a.popularity - b.popularity || a.defaultSort - b.defaultSort || byCodeUnits(a.family.family, b.family.family),
    )
    .map(({ family, primaryScript }, i) => ({
      family: family.family,
      category: family.category,
      rank: i + 1,
      licence: family.licence,
      path: family.path,
      scripts: [...family.scripts].sort(
        (a, b) =>
          Number(b === primaryScript) - Number(a === primaryScript) ||
          (drawnBy.get(b) ?? 0) - (drawnBy.get(a) ?? 0) ||
          byCodeUnits(a, b),
      ),
      axes: family.axes,
      faces: family.faces,
    }))
  return { families, leftOut: leftOut.sort((a, b) => byCodeUnits(a.family, b.family)) }
}

/** Whether google/fonts names the file variable in its weight, as `Inter[opsz,wght].ttf`. */
export function variesInWeight(file: string): boolean {
  return /\[[^\]]*\bwght\b[^\]]*\]/.test(file)
}

/** Reads a METADATA.pb, protobuf's text format, into the fields the list keeps. */
export function parseMetadata(text: string): FamilyMetadata {
  const message = parseTextFormat(text)
  const name = stringField(message, 'name')
  const license = stringField(message, 'license')
  if (!name || !license) throw new Error('METADATA.pb names no family or no licence')
  return {
    name,
    license,
    fonts: messages(message, 'fonts').map((font) => {
      const filename = stringField(font, 'filename')
      const style = stringField(font, 'style')
      const weight = numberField(font, 'weight')
      if (!filename || !style || weight === null) throw new Error(`a file of ${name} has no filename, style or weight`)
      return { style, weight, filename }
    }),
    subsets: (message.get('subsets') ?? []).filter((v): v is string => typeof v === 'string'),
    axes: messages(message, 'axes').map((axis) => {
      const tag = stringField(axis, 'tag')
      const min = numberField(axis, 'min_value')
      const max = numberField(axis, 'max_value')
      if (!tag || min === null || max === null) throw new Error(`an axis of ${name} has no tag or range`)
      return { tag, min, max }
    }),
    primaryScript: stringField(message, 'primary_script'),
  }
}
/**
 * Each Unicode script's ISO 15924 code by its long name, in Google's spelling (`old-italic` for
 * Old_Italic), from Unicode's PropertyValueAliases.txt.
 */
export function scriptCodes(aliases: string): ReadonlyMap<string, string> {
  const codes = new Map<string, string>()
  for (const line of aliases.split('\n')) {
    const [property, code, name] = line
      .replace(/#.*/, '')
      .split(';')
      .map((part) => part.trim())
    if (property === 'sc' && code && name) codes.set(name.toLowerCase().replaceAll('_', '-'), code)
  }
  return codes
}
/** The ISO 15924 codes of Google's subsets, each once. Throws for a subset it can't name, so a new one is noticed. */
export function subsetScripts(subsets: readonly string[], codes: ReadonlyMap<string, string>): string[] {
  const scripts = subsets.flatMap((subset) => {
    const known = SUBSET_SCRIPTS[subset] ?? (codes.has(subset) ? [codes.get(subset) as string] : null)
    if (!known) throw new Error(`no script is known for Google's subset ${subset}`)
    return known
  })
  return [...new Set(scripts)]
}

/** Compares strings by their UTF-16 code units, the same order on every machine. */
function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * The family's files, upright first and each lightest first, or why it is left out: a file the
 * tree lacks, a weight past 1 to 1000, a style other than normal and italic, or two files of one
 * weight and style. The static files of a style that has a variable file are left out, as a
 * variable face is the only face of its family and style.
 */
function facesOf(meta: FamilyMetadata, path: string, files: ReadonlyMap<string, TreeEntry>): GoogleFile[] | string {
  if (meta.fonts.length === 0) return 'its METADATA.pb names no file'
  const variable = meta.fonts.filter((font) => variesInWeight(font.filename))
  const besideVariable = (font: FamilyMetadata['fonts'][number]) =>
    !variesInWeight(font.filename) && variable.some((one) => one.style === font.style)
  const faces: GoogleFile[] = []
  for (const font of meta.fonts.filter((one) => !besideVariable(one))) {
    const entry = files.get(`${path}/${font.filename}`)
    if (!entry) return `google/fonts has no file ${font.filename}`
    if (font.style !== 'normal' && font.style !== 'italic') return `${font.filename} has the style ${font.style}`
    if (!Number.isInteger(font.weight) || font.weight < 1 || font.weight > 1000)
      return `${font.filename} has the weight ${font.weight}`
    if (faces.some((face) => face.weight === font.weight && face.style === font.style))
      return `two files have the weight ${font.weight} and style ${font.style}`
    faces.push({ file: font.filename, blob: entry.sha, bytes: entry.size, weight: font.weight, style: font.style })
  }
  return faces.sort((a, b) => (a.style === b.style ? a.weight - b.weight : a.style === 'normal' ? -1 : 1))
}
