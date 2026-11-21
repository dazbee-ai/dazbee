// PROTOTYPE. Adds to each catalogue face the scripts it draws, read from its cmap with CanvasKit.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { FONTS_DIR, fontBytes, loadCatalogue, SCRIPT_PROBES, SCRIPTS } from './catalogue.ts'

const ck = await loadCanvasKit()
const faces = loadCatalogue()
for (const face of faces) {
  const typeface = ck.Typeface.MakeTypefaceFromData(fontBytes(face).buffer as ArrayBuffer)
  if (!typeface) throw new Error(`can't read ${face.file}`)
  const font = new ck.Font(typeface, 20)
  face.scripts = SCRIPTS.filter((s) => [...font.getGlyphIDs(SCRIPT_PROBES[s])].every((g) => g !== 0))
  font.delete()
  typeface.delete()
}
writeFileSync(join(FONTS_DIR, 'catalogue-scripts.json'), JSON.stringify(faces, null, 1))
for (const s of SCRIPTS)
  console.log(
    s,
    faces.filter((f) => f.scripts!.includes(s)).length,
    'faces',
    new Set(faces.filter((f) => f.scripts!.includes(s)).map((f) => f.family)).size,
    'families',
  )
