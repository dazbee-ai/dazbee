// Packs the text matcher's files from the text prototype's round-3 output, for the release `release.json` names:
//   node scripts/pack-text-files.ts <the prototype's .data folder> <folder to write the files to>
// It reads the ConvNeXt-Atto model (epoch 14) and its 128-number projection, the gallery of font fingerprints (8
// clean and 8 realistic samples a face) and the novelty list; keeps only the keys that name a face of
// `GOOGLE_FONTS` (`faceOfKey`); builds the coverage index from each kept key's file in the google/fonts checkout
// beside them, at the list's commit, and measures from each face which the shortlist leaves out
// (`letter-shapes.ts`, and its colour tables); writes the files and prints the manifest and the faces left out.
// Run it again when the model is retrained. The files it writes, all little-endian:
// - `text-model.onnx`: the model; a 1×64×256 window of ink (0 to 1) in, `fingerprint` (512 numbers) out.
// - `text-projection.f32`: the 512-number mean, then the 512×128 directions, row by row: a fingerprint less the mean,
//   times the directions, made unit length again, is the 128 numbers the gallery holds.
// - `text-fingerprints.f32`: 128 numbers a key, unit length, in the keys' order.
// - `text-keys.json`: the keys (`family|weight|style`), one a fingerprint.
// - `text-coverage.bin`: for each key in order, a bit for each of `MATCH_CHARACTERS` in order (bit i of byte i ÷ 8,
//   from the lowest), set when the key's file draws it itself; 232 bytes a key.
// - `text-left-out.json`: the kept keys the shortlist leaves out, by why (`LeftOutKeys`): the novelty list's; the
//   faces whose letters are not distinct shapes; the colour faces; and, shortlisted only for words with no lowercase
//   letter, the faces that draw their lowercase letters as capitals.
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { MATCH_CHARACTERS } from '@dazbee/fonts'
import { GOOGLE_FONTS, GOOGLE_FONTS_COMMIT, googleFaces } from '@dazbee/fonts/google'
import { loadCanvasKit } from '@dazbee/renderer/node'

import { faceOfKey, parseFontKey } from '../src/text/font-key.ts'
import { SCRIPT_LETTERS, SCRIPTS } from '../src/text/scripts.ts'
import type { LeftOutKeys } from '../src/text/text-files.ts'
import { drawsLetters, drawsOnlyCapitals, letterShapes } from './letter-shapes.ts'

const [data, out] = process.argv.slice(2)
if (!data || !out) {
  console.error('Usage: node scripts/pack-text-files.ts <the prototype’s .data folder> <folder to write the files to>')
  process.exit(1)
}
const model = join(data, 'models', 'r3l-convnext_atto')
const checkout = join(data, 'google-fonts')
const COVERAGE_BYTES = Math.ceil(MATCH_CHARACTERS.length / 8)
/** Each character's bit in a file's coverage bits. */
const BIT_OF: ReadonlyMap<number, number> = new Map(MATCH_CHARACTERS.map((code, i) => [code, i]))
/** The tables that draw a face's glyphs in colours of its own. */
const COLOUR_TABLES: ReadonlySet<string> = new Set(['COLR', 'CBDT', 'sbix', 'SVG '])

const keys = JSON.parse(readFileSync(join(model, 'fingerprint-faces-pca128.json'), 'utf8')) as string[]
const gallery = floats(readFileSync(join(model, 'fingerprints-pca128.f32')))
const numbers = gallery.length / keys.length
const novelty = new Set(JSON.parse(readFileSync(join(data, 'fonts', 'novelty.json'), 'utf8')) as string[])
const families = new Map(GOOGLE_FONTS.map((family) => [family.family, family]))

const kept = keys.flatMap((key, row) => {
  const parsed = parseFontKey(key)
  const family = parsed && families.get(parsed.family)
  const named = parsed && family && faceOfKey(parsed, googleFaces(family))
  return named && family
    ? [{ key, face: parsed, row, file: join(checkout, family.path, named.face.file), blob: named.face.blob }]
    : []
})

const ck = await loadCanvasKit()
const everyCharacter = String.fromCodePoint(...MATCH_CHARACTERS)
/** Each file's coverage bits, read once. */
const coverageOf = new Map<string, Uint8Array>()
const fingerprints = new Float32Array(kept.length * numbers)
const coverage = new Uint8Array(kept.length * COVERAGE_BYTES)
const leftOut: LeftOutKeys = { novelty: [], patterns: [], colour: [], capitals: [] }
kept.forEach(({ key, face, row, file, blob }, at) => {
  fingerprints.set(gallery.subarray(row * numbers, (row + 1) * numbers), at * numbers)
  let bits = coverageOf.get(file)
  if (!bits) {
    bits = drawnCharacters(file, blob)
    coverageOf.set(file, bits)
  }
  coverage.set(bits, at * COVERAGE_BYTES)
  const bytes = new Uint8Array(readFileSync(file))
  if (novelty.has(key)) leftOut.novelty.push(key)
  if (isColourFace(bytes)) leftOut.colour.push(key)
  const draws = (character: string) => drawsByBits(bits, character)
  const script = SCRIPTS.find((s) => [...SCRIPT_LETTERS[s]].every(draws))
  if (!script) return
  const shapes = letterShapes(ck, bytes, face, script, draws)
  if (!drawsLetters(shapes)) leftOut.patterns.push(key)
  if (drawsOnlyCapitals(shapes)) leftOut.capitals.push(key)
})

mkdirSync(out, { recursive: true })
const files: Record<string, Uint8Array> = {
  'text-model.onnx': readFileSync(join(model, 'model.onnx')),
  'text-projection.f32': readFileSync(join(model, 'pca-128.f32')),
  'text-fingerprints.f32': new Uint8Array(fingerprints.buffer),
  'text-keys.json': json(kept.map(({ key }) => key)),
  'text-coverage.bin': coverage,
  'text-left-out.json': json(leftOut),
}
const manifest: Record<string, { sha256: string; size: number }> = {}
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(join(out, name), bytes)
  manifest[name] = { sha256: sha256(bytes), size: bytes.length }
}
const hash = sha256(
  new TextEncoder().encode(
    Object.entries(manifest)
      .map(([name, file]) => `${name} ${file.sha256}\n`)
      .join(''),
  ),
).slice(0, 16)
console.error(
  `${kept.length} of ${keys.length} keys name a face of GOOGLE_FONTS; ${coverageOf.size} files read for coverage`,
)
for (const [why, keysLeftOut] of Object.entries(leftOut)) console.error(`${why}: ${keysLeftOut.join(', ')}`)
console.log(JSON.stringify({ repo: 'dazbee-ai/dazbee', tag: `matchers-${hash}`, files: manifest }, null, 2))

/** A file's bytes as 32-bit floats, copied so they start on a float's boundary. */
function floats(bytes: Uint8Array): Float32Array {
  return new Float32Array(Uint8Array.from(bytes).buffer)
}

/** The coverage bits of a font file, checked against its git blob at the list's commit. */
function drawnCharacters(file: string, blob: string): Uint8Array {
  const bytes = readFileSync(file)
  const actual = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  if (actual !== blob) throw new Error(`${file} is not the file of google/fonts at ${GOOGLE_FONTS_COMMIT}`)
  const typeface = ck.Typeface.MakeTypefaceFromData(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length),
  )
  if (!typeface) throw new Error(`CanvasKit can't read ${file}`)
  const font = new ck.Font(typeface, 20)
  const glyphs = font.getGlyphIDs(everyCharacter)
  if (glyphs.length !== MATCH_CHARACTERS.length)
    throw new Error(`CanvasKit read ${glyphs.length} characters, not ${MATCH_CHARACTERS.length}`)
  font.delete()
  typeface.delete()
  const bits = new Uint8Array(COVERAGE_BYTES)
  glyphs.forEach((glyph, i) => {
    if (glyph !== 0) bits[i >> 3] = (bits[i >> 3] ?? 0) | (1 << (i & 7))
  })
  return bits
}

/** Whether a file's coverage bits say it draws `character`; false for a character they don't hold. */
function drawsByBits(bits: Uint8Array, character: string): boolean {
  const bit = BIT_OF.get(character.codePointAt(0) ?? -1)
  return bit !== undefined && ((bits[bit >> 3] ?? 0) & (1 << (bit & 7))) !== 0
}

/** Whether a font file has a table that draws its glyphs in colours of its own. */
function isColourFace(bytes: Uint8Array): boolean {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tables = view.getUint16(4)
  for (let i = 0; i < tables; i++) {
    const at = 12 + i * 16
    if (COLOUR_TABLES.has(String.fromCharCode(...bytes.subarray(at, at + 4)))) return true
  }
  return false
}

function json(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`)
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}
