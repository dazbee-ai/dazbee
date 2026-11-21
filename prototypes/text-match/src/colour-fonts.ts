// PROTOTYPE. Marks the colour fonts in the library (a COLR, CBDT, sbix or SVG table), which Dazbee's
// catalogue leaves out (packages/fonts google.ts) and the matcher leaves out too: writes `colour: true`
// into .data/fonts/library.json.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { FONTS_DIR, fontBytes, LIBRARY } from './catalogue.ts'

const COLOUR_TABLES = new Set(['COLR', 'CBDT', 'sbix', 'SVG '])
const tags = new Map<string, string[]>()
for (const face of LIBRARY) {
  if (!tags.has(face.file)) {
    const b = fontBytes(face)
    const view = new DataView(b.buffer, b.byteOffset, b.byteLength)
    const n = view.getUint16(4)
    tags.set(
      face.file,
      Array.from({ length: n }, (_, i) => String.fromCharCode(...b.subarray(12 + i * 16, 16 + i * 16))),
    )
  }
  ;(face as { colour?: boolean }).colour = tags.get(face.file)!.some((t) => COLOUR_TABLES.has(t))
}
writeFileSync(join(FONTS_DIR, 'library.json'), JSON.stringify(LIBRARY, null, 1))
const colour = LIBRARY.filter((f) => (f as { colour?: boolean }).colour)
console.log(
  `${colour.length} colour faces in ${new Set(colour.map((f) => f.family)).size} families: ${[...new Set(colour.map((f) => f.family))].join(', ')}`,
)
