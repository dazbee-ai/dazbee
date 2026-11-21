// PROTOTYPE. The whole Google Fonts library as a face list, read from a clone of github.com/google/fonts:
// every family under ofl/, apache/ and ufl/ (other licences skipped), each static file as one face and
// each variable file as one face per hundred of weight its weight axis reaches. Dazbee's current
// catalogue (GOOGLE_FONTS and SCRIPT_FONTS, 321 families, and the shipped Noto faces, in the weights
// and styles it offers) is marked `menu: true`, the subset matches can be limited to.
//   node src/library.ts .data/google-fonts
// Writes .data/fonts/library.json.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { FONT_FACES, GOOGLE_FONTS, SCRIPT_FONTS } from '@dazbee/fonts'
import { loadCanvasKit } from '@dazbee/renderer/node'

import {
  type CatalogueFace,
  type Category,
  faceId,
  FONTS_DIR,
  loadCatalogue,
  SCRIPT_PROBES,
  SCRIPTS,
} from './catalogue.ts'

const repo = resolve(process.argv[2]!)
const subset = new Set([...GOOGLE_FONTS, ...SCRIPT_FONTS].map((f) => f.family).concat(FONT_FACES.map((f) => f.family)))
// The faces Dazbee offers today (fetch-fonts.ts): the subset is these faces, not every weight of their families.
const offered = new Set(loadCatalogue().map(faceId))
const CATEGORIES: Record<string, Category> = {
  SANS_SERIF: 'sans-serif',
  SERIF: 'serif',
  DISPLAY: 'display',
  HANDWRITING: 'handwriting',
  MONOSPACE: 'monospace',
}
const ck = await loadCanvasKit()
const faces: (CatalogueFace & { license: string; variable: boolean })[] = []
const skipped: string[] = []
let families = 0
for (const license of ['ofl', 'apache', 'ufl']) {
  for (const dir of readdirSync(join(repo, license)).sort()) {
    const meta = join(repo, license, dir, 'METADATA.pb')
    if (!existsSync(meta)) continue
    const pb = readFileSync(meta, 'utf8')
    const family = /^name:\s*"(.+)"/m.exec(pb)?.[1]
    const category = CATEGORIES[/^category:\s*"(\w+)"/m.exec(pb)?.[1] ?? ''] ?? 'sans-serif'
    if (!family) continue
    const wght = /axes\s*{\s*tag:\s*"wght"\s*min_value:\s*([\d.]+)\s*max_value:\s*([\d.]+)/m.exec(pb)
    let added = 0
    for (const [block] of pb.matchAll(/fonts\s*{[^}]*}/g)) {
      const style = /style:\s*"(\w+)"/.exec(block)?.[1] === 'italic' ? 'italic' : 'normal'
      const filename = /filename:\s*"([^"]+)"/.exec(block)?.[1]
      const weight = Number(/weight:\s*(\d+)/.exec(block)?.[1] ?? 400)
      if (!filename) continue
      const file = join(repo, license, dir, filename)
      if (!existsSync(file)) continue
      const variable = filename.includes('[') && !!wght
      const weights = variable
        ? [100, 200, 300, 400, 500, 600, 700, 800, 900].filter((w) => w >= Number(wght![1]) && w <= Number(wght![2]))
        : [weight]
      const bytes = new Uint8Array(readFileSync(file))
      const typeface = ck.Typeface.MakeTypefaceFromData(bytes.buffer as ArrayBuffer)
      if (!typeface) {
        skipped.push(`${family}: ${filename} unreadable`)
        continue
      }
      const font = new ck.Font(typeface, 20)
      const scripts = SCRIPTS.filter((s) => [...font.getGlyphIDs(SCRIPT_PROBES[s])].every((g) => g !== 0))
      font.delete()
      typeface.delete()
      for (const w of weights) {
        if (faces.some((f) => f.family === family && f.weight === w && f.style === style)) continue
        faces.push({
          family,
          weight: w,
          style,
          category,
          file,
          source: 'google',
          menu: offered.has(faceId({ family, weight: w, style })),
          scripts,
          license,
          variable,
        })
        added++
      }
    }
    if (added > 0) families++
  }
}
writeFileSync(join(FONTS_DIR, 'library.json'), JSON.stringify(faces, null, 1))
const inSubset = faces.filter((f) => f.menu)
console.log(
  `${families} families, ${faces.length} faces (${faces.filter((f) => f.variable).length} from variable files); ` +
    `subset ${new Set(inSubset.map((f) => f.family)).size} families, ${inSubset.length} faces; ` +
    `missing from the clone: ${[...subset].filter((f) => !faces.some((x) => x.family === f)).join(', ') || 'none'}; skipped ${skipped.length}`,
)
