// Reads Google Fonts' own metadata into the families Dazbee offers: each family's METADATA.pb in
// google/fonts (its licence, files, axes and subsets), the repository's git tree (each file's blob
// and size), Google Fonts' public family listing (what it serves, each family's category and
// popularity), and Unicode's script names, which turn Google's subsets into ISO 15924 codes.
import type { FontCategory, GoogleFamily, GoogleFile, GoogleLicence } from './google.ts'

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

/** A value in protobuf's text format: a string, a number, or a message of fields. */
// eslint-disable-next-line @typescript-eslint/no-use-before-define -- the types refer to each other
type TextValue = string | number | TextMessage
/** A message in protobuf's text format: each field's values, in the order they appear. */
type TextMessage = Map<string, TextValue[]>
/** A piece of protobuf's text format. */
type Token = { kind: 'punctuation' | 'string' | 'word'; value: string } | { kind: 'number'; value: number }

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

/**
 * The family's files, upright first and each lightest first, or why it is left out: a file the
 * tree lacks, a weight past 1 to 1000, a style other than normal and italic, or two files of one
 * weight and style. A static file of a weight its style's variable file draws is left out, as the
 * catalog holds a variable face alone in its style.
 */
function facesOf(meta: FamilyMetadata, path: string, files: ReadonlyMap<string, TreeEntry>): GoogleFile[] | string {
  if (meta.fonts.length === 0) return 'its METADATA.pb names no file'
  const weightAxis = meta.axes.find((axis) => axis.tag === 'wght')
  const variesWeight = (filename: string) => /\[[^\]]*\bwght\b[^\]]*\]/.test(filename)
  const variable = meta.fonts.filter((font) => variesWeight(font.filename))
  const drawnByVariable = (font: FamilyMetadata['fonts'][number]) =>
    weightAxis !== undefined &&
    !variesWeight(font.filename) &&
    variable.some((one) => one.style === font.style) &&
    weightAxis.min <= font.weight &&
    font.weight <= weightAxis.max
  const faces: GoogleFile[] = []
  for (const font of meta.fonts.filter((one) => !drawnByVariable(one))) {
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

/** Compares strings by their UTF-16 code units, the same order on every machine. */
function byCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

/**
 * Reads protobuf's text format: `field: value` pairs and `field { … }` messages, `#` comments, and
 * quoted strings side by side read as one.
 */
function parseTextFormat(text: string): TextMessage {
  const tokens = tokenize(text)
  let at = 0
  const message = (): TextMessage => {
    const fields: TextMessage = new Map()
    while (at < tokens.length && !punctuation(tokens[at], '}')) {
      const name = tokens[at++]
      if (name?.kind !== 'word') throw new Error(`a field name was expected at ${name?.value}`)
      if (punctuation(tokens[at], ':')) at++
      let value: TextValue
      const token = tokens[at++]
      if (punctuation(token, '{')) {
        value = message()
        if (!punctuation(tokens[at++], '}')) throw new Error(`${name.value} is not closed`)
      } else if (token?.kind === 'string') {
        value = token.value
        while (tokens[at]?.kind === 'string') value += tokens[at++]?.value
      } else if (token?.kind === 'number' || token?.kind === 'word') value = token.value
      else throw new Error(`${name.value} has no value`)
      fields.set(String(name.value), [...(fields.get(String(name.value)) ?? []), value])
    }
    return fields
  }
  const top = message()
  if (at !== tokens.length) throw new Error('a } closes nothing')
  return top
}

/**
 * Splits text format into tokens: punctuation, quoted strings (their escapes read, an octal or hex
 * escape as a UTF-8 byte), numbers and bare words.
 */
function tokenize(text: string): Token[] {
  const tokens: Token[] = []
  const pattern = /\s+|#[^\n]*|([{}:])|"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([-+]?\d[\w.+-]*)|([A-Za-z_][\w.]*)/gy
  while (pattern.lastIndex < text.length) {
    const from = pattern.lastIndex
    const match = pattern.exec(text)
    if (!match) throw new Error(`METADATA.pb can't be read at ${text.slice(from, from + 20)}`)
    const [, mark, double, single, number, word] = match
    if (mark) tokens.push({ kind: 'punctuation', value: mark })
    else if (double !== undefined || single !== undefined)
      tokens.push({ kind: 'string', value: unescape(double ?? single ?? '') })
    else if (number) tokens.push({ kind: 'number', value: Number(number) })
    else if (word) tokens.push({ kind: 'word', value: word })
  }
  return tokens
}

/** Whether the token is the punctuation mark given. */
function punctuation(token: Token | undefined, mark: string): boolean {
  return token?.kind === 'punctuation' && token.value === mark
}

/** A quoted string's text, its escapes read: an octal or hex escape is one byte of UTF-8. */
function unescape(quoted: string): string {
  const bytes: number[] = []
  const simple: Record<string, number> = { n: 10, t: 9, r: 13, '"': 34, "'": 39, '\\': 92 }
  const encoder = new TextEncoder()
  for (let i = 0; i < quoted.length; i++) {
    const char = quoted[i] as string
    if (char !== '\\') {
      const code = quoted.codePointAt(i) as number
      bytes.push(...encoder.encode(String.fromCodePoint(code)))
      if (code > 0xffff) i++
      continue
    }
    const next = quoted[++i] ?? ''
    const octal = /^[0-7]{1,3}/.exec(quoted.slice(i))?.[0]
    const hex = next === 'x' ? /^[0-9a-fA-F]{1,2}/.exec(quoted.slice(i + 1))?.[0] : undefined
    if (octal) {
      bytes.push(parseInt(octal, 8))
      i += octal.length - 1
    } else if (hex) {
      bytes.push(parseInt(hex, 16))
      i += hex.length
    } else bytes.push(simple[next] ?? next.charCodeAt(0))
  }
  return new TextDecoder().decode(new Uint8Array(bytes))
}

/** A field's first value when it is a string, or null. */
function stringField(message: TextMessage, name: string): string | null {
  const value = message.get(name)?.[0]
  return typeof value === 'string' ? value : null
}

/** A field's first value when it is a number, or null. */
function numberField(message: TextMessage, name: string): number | null {
  const value = message.get(name)?.[0]
  return typeof value === 'number' ? value : null
}

/** A field's values that are messages. */
function messages(message: TextMessage, name: string): TextMessage[] {
  return (message.get(name) ?? []).filter((v): v is TextMessage => v instanceof Map)
}
