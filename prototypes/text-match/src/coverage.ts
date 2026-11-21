// PROTOTYPE. Which characters each font file draws itself, read once from the files and kept as a bitset
// per file over the characters ads use (Latin with its extensions, Greek, Cyrillic, Arabic, Devanagari,
// punctuation, currency), so checking a candidate needs no font loaded. A character outside those is
// checked by loading the face (rare).
//   node src/coverage.ts            builds .data/fonts/coverage.bin and coverage.json from the library
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CanvasKit } from '@dazbee/canvaskit'

import { type CatalogueFace, FONTS_DIR, fontBytes, LIBRARY, loadCatalogue } from './catalogue.ts'

const RANGES: [number, number][] = [
  [0x20, 0x7e],
  [0xa0, 0x24f],
  [0x370, 0x3ff],
  [0x400, 0x4ff],
  [0x600, 0x6ff],
  [0x750, 0x77f],
  [0x900, 0x97f],
  [0x1e00, 0x1eff],
  [0x2000, 0x206f],
  [0x20a0, 0x20cf],
  [0x2100, 0x214f],
]
const CODEPOINTS = RANGES.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a + i))
const SLOT = new Map(CODEPOINTS.map((c, i) => [c, i]))
const BYTES = Math.ceil(CODEPOINTS.length / 8)

let index: { slot: Map<string, number>; bits: Uint8Array } | null | undefined

function load() {
  if (index !== undefined) return index
  const meta = join(FONTS_DIR, 'coverage.json')
  if (!existsSync(meta)) return (index = null)
  const { files } = JSON.parse(readFileSync(meta, 'utf8')) as { files: string[] }
  index = {
    slot: new Map(files.map((f, i) => [f, i])),
    bits: new Uint8Array(readFileSync(join(FONTS_DIR, 'coverage.bin'))),
  }
  return index
}

/**
 * Whether a face draws every character of `text` itself: from the index when it has the face's file
 * and every character, else (`null`) the caller must load the face to check.
 */
export function coversFromIndex(face: CatalogueFace, text: string): boolean | null {
  const ix = load()
  const at = ix?.slot.get(face.file)
  if (!ix || at === undefined) return null
  for (const ch of new Set(text.replace(/\s/g, ''))) {
    const s = SLOT.get(ch.codePointAt(0)!)
    if (s === undefined || ch.length > 2) return null
    if (!(ix.bits[at * BYTES + (s >> 3)]! & (1 << (s & 7)))) return false
  }
  return true
}

if (import.meta.main) {
  const { loadCanvasKit } = await import('@dazbee/renderer/node')
  const ck: CanvasKit = await loadCanvasKit()
  const faces = [...LIBRARY, ...loadCatalogue()]
  const files = [...new Set(faces.map((f) => f.file))]
  const byFile = new Map(faces.map((f) => [f.file, f]))
  const bits = new Uint8Array(files.length * BYTES)
  const all = String.fromCodePoint(...CODEPOINTS)
  files.forEach((file, i) => {
    const tf = ck.Typeface.MakeTypefaceFromData(fontBytes(byFile.get(file)!).buffer as ArrayBuffer)
    if (!tf) return
    const font = new ck.Font(tf, 20)
    const ids = font.getGlyphIDs(all)
    ids.forEach((g, s) => {
      if (g !== 0) bits[i * BYTES + (s >> 3)]! |= 1 << (s & 7)
    })
    font.delete()
    tf.delete()
  })
  writeFileSync(join(FONTS_DIR, 'coverage.bin'), bits)
  writeFileSync(join(FONTS_DIR, 'coverage.json'), JSON.stringify({ files, codepoints: CODEPOINTS.length }))
  console.log(`${files.length} files, ${CODEPOINTS.length} characters, ${bits.length} bytes`)
}
