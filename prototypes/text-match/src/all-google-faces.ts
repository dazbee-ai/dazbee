// PROTOTYPE. A face list for a bigger training run: Dazbee's catalogue plus every other Google face the
// old worker's font folder holds (its `served` files, one per family, weight and style). Only the
// fingerprint model trains on the extra faces; matches still come from the catalogue alone.
//   node src/all-google-faces.ts C:\Users\imkes\Desktop\ming-setup\fonts\served
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { type CatalogueFace, faceId, FONTS_DIR, loadCatalogue, SCRIPT_PROBES, SCRIPTS } from './catalogue.ts'

const served = process.argv[2]!
const ck = await loadCanvasKit()
const catalogue = loadCatalogue()
const have = new Set(catalogue.map(faceId))
const extra: CatalogueFace[] = []
for (const file of readdirSync(served).sort()) {
  const m = /^(.+)_(\d+)(i?)\.ttf$/.exec(file)
  if (!m) continue
  const face: CatalogueFace = {
    family: m[1]!.replace(/_/g, ' '),
    weight: Number(m[2]),
    style: m[3] ? 'italic' : 'normal',
    category: 'sans-serif',
    file: join(served, file),
    source: 'google',
    menu: false,
  }
  if (have.has(faceId(face))) continue
  const typeface = ck.Typeface.MakeTypefaceFromData(new Uint8Array(readFileSync(face.file)).buffer as ArrayBuffer)
  if (!typeface) continue
  const font = new ck.Font(typeface, 20)
  face.scripts = SCRIPTS.filter((s) => [...font.getGlyphIDs(SCRIPT_PROBES[s])].every((g) => g !== 0))
  font.delete()
  typeface.delete()
  extra.push(face)
}
writeFileSync(join(FONTS_DIR, 'all-google-faces.json'), JSON.stringify([...catalogue, ...extra], null, 1))
console.log(`${catalogue.length} catalogue faces + ${extra.length} more`)
