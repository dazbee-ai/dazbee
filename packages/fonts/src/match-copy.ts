// A font's match copy: the font cut to the characters ads use (`MATCH_CHARACTERS`) with HarfBuzz's subsetter
// (harfbuzzjs, MIT), keeping every table, layout feature and variation axis, so the glyphs those characters reach shape
// and draw as in the whole font. Exported only as `@dazbee/fonts/match-copy`, so HarfBuzz stays out of the bundles
// that import the package's other parts. A change to how a copy is made raises `MATCH_COPY_VERSION`.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { characterGlyphs, tableDirectory } from './font-tables.ts'
import { MATCH_CHARACTERS } from './match-characters.ts'

/** WebAssembly, as far as this module uses it: the package's types leave it out. */
interface WebAssemblyApi {
  Module: new (bytes: Uint8Array) => object
  Instance: new (module: object, imports: object) => { exports: unknown }
}

/** The exports of HarfBuzz's subsetter that a match copy calls. */
interface Subsetter {
  memory: { buffer: ArrayBuffer }
  malloc(size: number): number
  free(pointer: number): void
  hb_blob_create(data: number, length: number, mode: number, userData: number, destroy: number): number
  hb_blob_destroy(blob: number): void
  hb_blob_get_length(blob: number): number
  hb_blob_get_data(blob: number, length: number): number
  hb_face_create(blob: number, index: number): number
  hb_face_destroy(face: number): void
  hb_face_reference_blob(face: number): number
  hb_set_clear(set: number): void
  hb_set_add(set: number, codepoint: number): void
  hb_subset_input_create_or_fail(): number
  hb_subset_input_destroy(input: number): void
  hb_subset_input_keep_everything(input: number): void
  hb_subset_input_get_flags(input: number): number
  hb_subset_input_set_flags(input: number, flags: number): void
  hb_subset_input_unicode_set(input: number): number
  hb_subset_input_glyph_set(input: number): number
  hb_subset_or_fail(face: number, input: number): number
}

/** HarfBuzz's `HB_MEMORY_MODE_WRITABLE`: the blob may be read in place, and we free its bytes ourselves. */
const MEMORY_MODE_WRITABLE = 1
/** HarfBuzz's `HB_SUBSET_FLAGS_RETAIN_GIDS`: each kept glyph keeps its number, and the others are left empty. */
const RETAIN_GLYPH_IDS = 0x2
const ASKED: ReadonlySet<number> = new Set(MATCH_CHARACTERS)

/** The subsetter, started on the first copy and kept for the next, until one fails part way. */
let subsetter: Subsetter | undefined

/**
 * The font's match copy, made by HarfBuzz from the whole font's bytes; null when HarfBuzz can't read or cut the font,
 * or its copy lacks one of the characters ads use that the whole font has. Throws when HarfBuzz runs out of memory or
 * fails part way, which says nothing about the font, so the copy can be made again. Besides the characters ads use, the
 * copy maps every other character of the font whose glyph it keeps anyway, such as a ligature's presentation form:
 * FreeType's autohinter sorts glyphs into scripts by the characters that map to them, so a glyph that lost one would
 * draw a little apart from the whole font's. Given other `characters`, the copy is cut to those instead, as a test's
 * fonts are.
 */
export function matchCopy(font: Uint8Array, characters: readonly number[] = MATCH_CHARACTERS): Uint8Array | null {
  if (!tablesOf(font)) return null
  const asked = characters === MATCH_CHARACTERS ? ASKED : new Set(characters)
  const numbered = cut(font, characters, RETAIN_GLYPH_IDS)
  if (!numbered) return null
  const copy = cut(font, [...characters, ...charactersOfKeptGlyphs(font, numbered, asked)], 0)
  if (!copy) return null
  const kept = glyphsOf(copy)
  for (const character of glyphsOf(font).keys()) if (asked.has(character) && !kept.has(character)) return null
  return copy
}

/** The font cut by HarfBuzz to `characters` and the glyphs they reach, with these subset flags; null when it can't be. */
function cut(font: Uint8Array, characters: readonly number[], flags: number): Uint8Array | null {
  const hb = (subsetter ??= startSubsetter())
  try {
    return cutWith(hb, font, characters, flags)
  } catch (reason) {
    // A trap can leave HarfBuzz's memory half changed: the next copy starts a new subsetter.
    subsetter = undefined
    throw reason
  }
}

/** HarfBuzz's subsetter, compiled from harfbuzzjs's WebAssembly, which imports nothing. */
function startSubsetter(): Subsetter {
  const path = createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm')
  const { WebAssembly } = globalThis as unknown as { WebAssembly: WebAssemblyApi }
  const module = new WebAssembly.Module(readFileSync(path))
  return new WebAssembly.Instance(module, {}).exports as Subsetter
}

/** `cut` on the subsetter `hb`. */
function cutWith(hb: Subsetter, font: Uint8Array, characters: readonly number[], flags: number): Uint8Array | null {
  const pointer = hb.malloc(font.length)
  if (pointer === 0) throw new Error(`HarfBuzz has no memory left for a font of ${font.length} bytes`)
  new Uint8Array(hb.memory.buffer).set(font, pointer)
  const blob = hb.hb_blob_create(pointer, font.length, MEMORY_MODE_WRITABLE, 0, 0)
  const face = hb.hb_face_create(blob, 0)
  hb.hb_blob_destroy(blob)
  const input = hb.hb_subset_input_create_or_fail()
  if (input === 0) {
    hb.hb_face_destroy(face)
    hb.free(pointer)
    throw new Error('HarfBuzz has no memory left to start a cut')
  }
  hb.hb_subset_input_keep_everything(input)
  hb.hb_subset_input_set_flags(input, hb.hb_subset_input_get_flags(input) | flags)
  hb.hb_set_clear(hb.hb_subset_input_glyph_set(input))
  const unicodes = hb.hb_subset_input_unicode_set(input)
  hb.hb_set_clear(unicodes)
  for (const character of characters) hb.hb_set_add(unicodes, character)
  const cutFace = hb.hb_subset_or_fail(face, input)
  let copy: Uint8Array | null = null
  if (cutFace !== 0) {
    const cutBlob = hb.hb_face_reference_blob(cutFace)
    const length = hb.hb_blob_get_length(cutBlob)
    const data = hb.hb_blob_get_data(cutBlob, 0)
    if (length > 0) copy = new Uint8Array(hb.memory.buffer, data, length).slice()
    hb.hb_blob_destroy(cutBlob)
    hb.hb_face_destroy(cutFace)
  }
  hb.hb_subset_input_destroy(input)
  hb.hb_face_destroy(face)
  hb.free(pointer)
  return copy
}

/**
 * The characters of the whole font beyond those `asked` whose glyph has an outline that the copy `numbered` (cut with
 * each glyph keeping its number) kept. None for a font whose outlines are not TrueType's, or whose tables can't be read.
 */
function charactersOfKeptGlyphs(font: Uint8Array, numbered: Uint8Array, asked: ReadonlySet<number>): number[] {
  const drawnWhole = hasOutline(font)
  const kept = hasOutline(numbered)
  const found: number[] = []
  for (const [character, glyph] of glyphsOf(font))
    if (!asked.has(character) && drawnWhole(glyph) && kept(glyph)) found.push(character)
  return found
}

/** Each character the font's character map gives a glyph, with that glyph's ID; none when it can't be read. */
function glyphsOf(font: Uint8Array): Map<number, number> {
  const tables = tablesOf(font)
  const cmap = tables?.get('cmap')
  return tables && cmap ? characterGlyphs(tables.view, cmap.at, cmap.length) : new Map()
}

/** Whether a glyph of the font has an outline in `glyf`, by `loca`; never, without those tables. */
function hasOutline(font: Uint8Array): (glyph: number) => boolean {
  const tables = tablesOf(font)
  const [head, maxp, loca] = [tables?.get('head'), tables?.get('maxp'), tables?.get('loca')]
  if (!tables || !head || !maxp || !loca || !tables.get('glyf') || head.length < 54 || maxp.length < 6)
    return () => false
  const { view } = tables
  const long = view.getInt16(head.at + 50) === 1
  const glyphs = view.getUint16(maxp.at + 4)
  if (loca.length < (glyphs + 1) * (long ? 4 : 2)) return () => false
  const offset = (glyph: number) =>
    long ? view.getUint32(loca.at + glyph * 4) : view.getUint16(loca.at + glyph * 2) * 2
  return (glyph) => glyph < glyphs && offset(glyph + 1) > offset(glyph)
}

/** The font's tables by tag, with a view of its bytes they are read through; undefined when they can't be read. */
function tablesOf(
  font: Uint8Array,
): { view: DataView; get: (tag: string) => { at: number; length: number } | undefined } | undefined {
  if (font.length < 12) return undefined
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength)
  const directory = tableDirectory(view)
  if (!directory) return undefined
  return { view, get: (tag) => directory.find((table) => table.tag === tag) }
}
