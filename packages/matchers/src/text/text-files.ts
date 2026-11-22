// The text matcher's files from the release `release.json` names, read from their bytes: the font
// fingerprints and their keys, the projection that turns the model's numbers into a fingerprint, the
// coverage index and the faces the shortlist leaves out. The model itself is opened by a model runtime.

import { MATCH_CHARACTERS } from '@dazbee/fonts'

import { type FontKey, parseFontKey } from './font-key.ts'
import { MODEL_NUMBERS } from './model-runtime.ts'
import { type Script, SCRIPT_LETTERS, SCRIPTS } from './scripts.ts'

/** The name in the release of a file the text matcher reads, besides the model. */
export type TextFileName =
  'text-projection.f32' | 'text-fingerprints.f32' | 'text-keys.json' | 'text-coverage.bin' | 'text-left-out.json'

/** The files' bytes by their names in the release. */
export type TextFileBytes = Readonly<Record<TextFileName, Uint8Array>>

/**
 * `text-left-out.json`: the keys the shortlist leaves out, by why. `pack-text-files.ts` measures all but the novelty
 * keys from each face itself.
 */
export interface LeftOutKeys {
  /** The prototype's novelty list: faces that draw a pattern or a decoration rather than plain letters. */
  novelty: string[]
  /** Faces whose letters are not distinct shapes (bars, lines, blocks, stripes). */
  patterns: string[]
  /** Colour faces: a COLR, CBDT, sbix or SVG table, drawing their letters in colours of their own. */
  colour: string[]
  /** Faces that draw their lowercase letters as their capitals' shapes, or as smaller capitals. */
  capitals: string[]
}

/** The text matcher's files, read. */
export interface TextFiles {
  /** Each fingerprint's key, `family|weight|style`, in the files' order: a key's row. */
  keys: readonly string[]
  /** Each row's family, weight and style. */
  faces: readonly FontKey[]
  /** The row of each key. */
  rows: ReadonlyMap<string, number>
  /** `FINGERPRINT_NUMBERS` a row, each row unit length. */
  fingerprints: Float32Array
  /** The model's numbers' mean, `MODEL_NUMBERS` of them. */
  mean: Float32Array
  /** The projection's directions, `MODEL_NUMBERS` × `FINGERPRINT_NUMBERS`, row by row. */
  directions: Float32Array
  /** Rows whose faces are never shortlisted: they draw a pattern rather than letters, or letters in colours of their own. */
  leftOut: ReadonlySet<number>
  /** Rows whose faces draw their lowercase letters as capitals, shortlisted only for words with no lowercase letter. */
  capitals: ReadonlySet<number>
  /** For each row, the scripts whose letters its face draws every one of. */
  scripts: readonly ReadonlySet<Script>[]
  /** A bit a character of `MATCH_CHARACTERS` a row, set when the row's face draws it itself. */
  coverage: Uint8Array
}

/** The release's files the text matcher reads, besides the model. */
export const TEXT_FILES: readonly TextFileName[] = [
  'text-projection.f32',
  'text-fingerprints.f32',
  'text-keys.json',
  'text-coverage.bin',
  'text-left-out.json',
]

/** How many numbers a font fingerprint holds. */
export const FINGERPRINT_NUMBERS = 128

/** The coverage index's bytes a row. */
const COVERAGE_BYTES = Math.ceil(MATCH_CHARACTERS.length / 8)
/** Each character's bit in a row of the coverage index. */
const BIT_OF: ReadonlyMap<number, number> = new Map(MATCH_CHARACTERS.map((code, i) => [code, i]))

/** The text matcher's files read from their bytes; throws when they don't fit together. */
export function readTextFiles(bytes: TextFileBytes): TextFiles {
  const keys = JSON.parse(new TextDecoder().decode(bytes['text-keys.json'])) as string[]
  const faces = keys.map((key) => {
    const face = parseFontKey(key)
    if (!face) throw new Error(`${key} in text-keys.json is not a font key`)
    return face
  })
  const rows = new Map(keys.map((key, row) => [key, row]))
  const fingerprints = floats(bytes['text-fingerprints.f32'])
  const projection = floats(bytes['text-projection.f32'])
  const coverage = bytes['text-coverage.bin']
  if (fingerprints.length !== keys.length * FINGERPRINT_NUMBERS)
    throw new Error('text-fingerprints.f32 does not hold a fingerprint for each key')
  if (projection.length !== MODEL_NUMBERS * (1 + FINGERPRINT_NUMBERS))
    throw new Error('text-projection.f32 is not a mean and its directions')
  if (coverage.length !== keys.length * COVERAGE_BYTES) throw new Error('text-coverage.bin does not cover each key')
  const leftOut = JSON.parse(new TextDecoder().decode(bytes['text-left-out.json'])) as LeftOutKeys
  const rowsOf = (list: readonly string[]) => new Set(list.flatMap((key) => rows.get(key) ?? []))
  const scripts = keys.map(
    (_, row) =>
      new Set(SCRIPTS.filter((script) => [...SCRIPT_LETTERS[script]].every((letter) => hasBit(coverage, row, letter)))),
  )
  return {
    keys,
    faces,
    rows,
    fingerprints,
    mean: projection.subarray(0, MODEL_NUMBERS),
    directions: projection.subarray(MODEL_NUMBERS),
    leftOut: rowsOf([...leftOut.novelty, ...leftOut.patterns, ...leftOut.colour]),
    capitals: rowsOf(leftOut.capitals),
    scripts,
    coverage,
  }
}

/**
 * Whether the face of `row` draws every character of `words` but white space itself, by the coverage
 * index: false at the first character it lacks, null at the first that is not one of
 * `MATCH_CHARACTERS`, so the face must be loaded to tell.
 */
export function coversByIndex(files: TextFiles, row: number, words: string): boolean | null {
  for (const character of new Set(words.replace(/\s/gu, ''))) {
    if (!BIT_OF.has(character.codePointAt(0) ?? -1)) return null
    if (!hasBit(files.coverage, row, character)) return false
  }
  return true
}

/** The cosine similarity of a fingerprint to the fingerprint of `row`. */
export function similarity(files: TextFiles, row: number, fingerprint: Float32Array): number {
  let s = 0
  for (let i = 0; i < FINGERPRINT_NUMBERS; i++)
    s += (files.fingerprints[row * FINGERPRINT_NUMBERS + i] ?? 0) * (fingerprint[i] ?? 0)
  return s
}

/** Little-endian 32-bit floats, copied so they start on a float's boundary. */
function floats(bytes: Uint8Array): Float32Array {
  return new Float32Array(Uint8Array.from(bytes).buffer)
}

/** Whether the coverage index says the face of `row` draws `character`. */
function hasBit(coverage: Uint8Array, row: number, character: string): boolean {
  const bit = BIT_OF.get(character.codePointAt(0) ?? -1)
  if (bit === undefined) return false
  return ((coverage[row * COVERAGE_BYTES + (bit >> 3)] ?? 0) & (1 << (bit & 7))) !== 0
}
