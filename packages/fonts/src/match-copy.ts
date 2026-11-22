// A font's match copy: the font cut to the characters ads use (`MATCH_CHARACTERS`) with HarfBuzz's subsetter
// (harfbuzzjs, MIT), keeping every table, layout feature and variation axis, so the glyphs those characters reach shape
// and draw as in the whole font. Exported only as `@dazbee/fonts/match-copy`, so HarfBuzz stays out of the bundles
// that import the package's other parts.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

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
/** The cmap subtables that map Unicode: platform, then encoding, `-1` for any. */
const UNICODE_SUBTABLES: readonly (readonly [number, number])[] = [
  [0, -1],
  [3, 1],
  [3, 10],
]
const ASKED: ReadonlySet<number> = new Set(MATCH_CHARACTERS)

/** The subsetter, started on the first copy and kept for the next. */
let subsetter: Subsetter | undefined

/**
 * The font's match copy, made by HarfBuzz from the whole font's bytes; null when HarfBuzz can't read or cut the font,
 * or has no memory left for it. Besides the characters ads use, the copy maps every other character of the font whose
 * glyph it keeps anyway, such as a ligature's presentation form: FreeType's autohinter sorts glyphs into scripts by the
 * characters that map to them, so a glyph that lost one would draw a little apart from the whole font's.
 */
export function matchCopy(font: Uint8Array): Uint8Array | null {
  const numbered = cut(font, MATCH_CHARACTERS, RETAIN_GLYPH_IDS)
  if (!numbered) return null
  return cut(font, [...MATCH_CHARACTERS, ...charactersOfKeptGlyphs(font, numbered)], 0)
}

/** The font cut by HarfBuzz to `characters` and the glyphs they reach, with these subset flags; null when it can't be. */
function cut(font: Uint8Array, characters: readonly number[], flags: number): Uint8Array | null {
  const hb = (subsetter ??= startSubsetter())
  const pointer = hb.malloc(font.length)
  if (pointer === 0) return null
  new Uint8Array(hb.memory.buffer).set(font, pointer)
  const blob = hb.hb_blob_create(pointer, font.length, MEMORY_MODE_WRITABLE, 0, 0)
  const face = hb.hb_face_create(blob, 0)
  hb.hb_blob_destroy(blob)
  const input = hb.hb_subset_input_create_or_fail()
  let copy: Uint8Array | null = null
  if (input !== 0) {
    hb.hb_subset_input_keep_everything(input)
    hb.hb_subset_input_set_flags(input, hb.hb_subset_input_get_flags(input) | flags)
    hb.hb_set_clear(hb.hb_subset_input_glyph_set(input))
    const unicodes = hb.hb_subset_input_unicode_set(input)
    hb.hb_set_clear(unicodes)
    for (const character of characters) hb.hb_set_add(unicodes, character)
    const cutFace = hb.hb_subset_or_fail(face, input)
    if (cutFace !== 0) {
      const cutBlob = hb.hb_face_reference_blob(cutFace)
      const length = hb.hb_blob_get_length(cutBlob)
      if (length > 0) copy = new Uint8Array(hb.memory.buffer, hb.hb_blob_get_data(cutBlob, 0), length).slice()
      hb.hb_blob_destroy(cutBlob)
      hb.hb_face_destroy(cutFace)
    }
    hb.hb_subset_input_destroy(input)
  }
  hb.hb_face_destroy(face)
  hb.free(pointer)
  return copy
}

/** HarfBuzz's subsetter, compiled from harfbuzzjs's WebAssembly, which imports nothing. */
function startSubsetter(): Subsetter {
  const path = createRequire(import.meta.url).resolve('harfbuzzjs/dist/harfbuzz-subset.wasm')
  const { WebAssembly } = globalThis as unknown as { WebAssembly: WebAssemblyApi }
  const module = new WebAssembly.Module(readFileSync(path))
  return new WebAssembly.Instance(module, {}).exports as Subsetter
}

/**
 * The characters of the whole font beyond the ones ads use whose glyph has an outline that the copy `numbered` (cut
 * with each glyph keeping its number) kept. None for a font whose outlines are not TrueType's, or whose tables can't
 * be read.
 */
function charactersOfKeptGlyphs(font: Uint8Array, numbered: Uint8Array): number[] {
  const drawnWhole = hasOutline(font)
  const kept = hasOutline(numbered)
  const found: number[] = []
  for (const [character, glyph] of unicodeGlyphs(font))
    if (!ASKED.has(character) && drawnWhole(glyph) && kept(glyph)) found.push(character)
  return found
}

/** Whether a glyph of the font has an outline in `glyf`, by `loca`; never, without those tables. */
function hasOutline(font: Uint8Array): (glyph: number) => boolean {
  const head = table(font, 'head')
  const maxp = table(font, 'maxp')
  const loca = table(font, 'loca')
  if (!head || !maxp || !loca || !table(font, 'glyf') || head.byteLength < 54 || maxp.byteLength < 6) return () => false
  const long = head.getInt16(50) === 1
  const glyphs = maxp.getUint16(4)
  if (loca.byteLength < (glyphs + 1) * (long ? 4 : 2)) return () => false
  const offset = (glyph: number) => (long ? loca.getUint32(glyph * 4) : loca.getUint16(glyph * 2) * 2)
  return (glyph) => glyph < glyphs && offset(glyph + 1) > offset(glyph)
}

/** Each character the font's Unicode cmap subtables (formats 4 and 12) map, with its glyph. */
function unicodeGlyphs(font: Uint8Array): Map<number, number> {
  const glyphs = new Map<number, number>()
  const cmap = table(font, 'cmap')
  if (!cmap || cmap.byteLength < 4) return glyphs
  const subtables = cmap.getUint16(2)
  for (let i = 0; i < subtables; i++) {
    const record = 4 + i * 8
    if (record + 8 > cmap.byteLength) break
    const platform = cmap.getUint16(record)
    const encoding = cmap.getUint16(record + 2)
    if (!UNICODE_SUBTABLES.some(([p, e]) => p === platform && (e === -1 || e === encoding))) continue
    const at = cmap.getUint32(record + 4)
    if (at + 2 > cmap.byteLength) continue
    const format = cmap.getUint16(at)
    if (format === 4) readFormat4(cmap, at, glyphs)
    else if (format === 12) readFormat12(cmap, at, glyphs)
  }
  return glyphs
}

/** Adds the characters of the format 4 cmap subtable at `at` to `glyphs`. */
function readFormat4(cmap: DataView, at: number, glyphs: Map<number, number>) {
  if (at + 14 > cmap.byteLength) return
  const segments = cmap.getUint16(at + 6) / 2
  const ends = at + 14
  const starts = ends + segments * 2 + 2
  const deltas = starts + segments * 2
  const ranges = deltas + segments * 2
  if (ranges + segments * 2 > cmap.byteLength) return
  for (let s = 0; s < segments; s++) {
    const end = cmap.getUint16(ends + s * 2)
    const start = cmap.getUint16(starts + s * 2)
    const delta = cmap.getUint16(deltas + s * 2)
    const rangeOffset = cmap.getUint16(ranges + s * 2)
    for (let character = start; character <= end && character !== 0xffff; character++) {
      let glyph = (character + delta) & 0xffff
      if (rangeOffset !== 0) {
        const where = ranges + s * 2 + rangeOffset + (character - start) * 2
        if (where + 2 > cmap.byteLength) break
        const raw = cmap.getUint16(where)
        glyph = raw === 0 ? 0 : (raw + delta) & 0xffff
      }
      if (glyph !== 0 && !glyphs.has(character)) glyphs.set(character, glyph)
    }
  }
}

/** Adds the characters of the format 12 cmap subtable at `at` to `glyphs`. */
function readFormat12(cmap: DataView, at: number, glyphs: Map<number, number>) {
  if (at + 16 > cmap.byteLength) return
  const groups = cmap.getUint32(at + 12)
  for (let g = 0; g < groups; g++) {
    const group = at + 16 + g * 12
    if (group + 12 > cmap.byteLength) return
    const first = cmap.getUint32(group)
    const last = Math.min(cmap.getUint32(group + 4), 0x10ffff)
    const glyph = cmap.getUint32(group + 8)
    for (let character = first; character <= last; character++)
      if (!glyphs.has(character)) glyphs.set(character, glyph + character - first)
  }
}

/** The font's table of `tag`, read in place; undefined when it has none or the table runs past the file. */
function table(font: Uint8Array, tag: string): DataView | undefined {
  if (font.byteLength < 12) return undefined
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength)
  const count = view.getUint16(4)
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16
    if (record + 16 > font.byteLength) return undefined
    if (String.fromCharCode(...font.subarray(record, record + 4)) !== tag) continue
    const offset = view.getUint32(record + 8)
    const length = view.getUint32(record + 12)
    if (offset + length > font.byteLength) return undefined
    return new DataView(font.buffer, font.byteOffset + offset, length)
  }
  return undefined
}
