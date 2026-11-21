// PROTOTYPE. Copies Dazbee's font catalogue into .data/fonts the way `fonts:google` copies it into
// storage (same CSS URL, same faces, SVG table taken out), plus the shipped faces, and writes
// .data/fonts/catalogue.json: one entry per face with its family, weight, style, category and file.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { FONT_FACES, GOOGLE_FONTS, googleCssUrl, googleFaces, SCRIPT_FONTS } from '@dazbee/fonts'
import { FONT_FILES_DIR } from '@dazbee/fonts/node'

import { withoutSvgTable } from '../../../apps/api/src/fonts/font-file.ts'
import { DATA_DIR, type CatalogueFace } from './catalogue.ts'

const dir = join(DATA_DIR, 'fonts')
mkdirSync(join(dir, 'files'), { recursive: true })
const faces: CatalogueFace[] = []

for (const face of FONT_FACES) {
  copyFileSync(join(FONT_FILES_DIR, face.file), join(dir, 'files', face.file))
  faces.push({
    family: face.family,
    weight: face.weight,
    style: face.style,
    category: 'sans-serif',
    file: face.file,
    source: 'shipped',
    menu: true,
  })
}

const families = [
  ...GOOGLE_FONTS.map((f) => ({ ...f, menu: true })),
  ...SCRIPT_FONTS.map((f) => ({ ...f, menu: false })),
]
let next = 0
async function work() {
  while (next < families.length) {
    const family = families[next++]!
    const css = await fetch(googleCssUrl(family))
    if (!css.ok) throw new Error(`${family.family}: ${css.status}`)
    for (const face of googleFaces(await css.text())) {
      const name = `${family.family.replace(/\s+/g, '_')}_${face.weight}${face.style === 'italic' ? 'i' : ''}.ttf`
      const path = join(dir, 'files', name)
      if (!existsSync(path)) {
        const file = await fetch(face.url)
        if (!file.ok) throw new Error(`${family.family} ${face.weight}: ${file.status}`)
        writeFileSync(path, withoutSvgTable(new Uint8Array(await file.arrayBuffer())))
      }
      faces.push({
        family: family.family,
        weight: face.weight,
        style: face.style,
        category: family.category,
        file: name,
        source: 'google',
        menu: family.menu,
      })
    }
    process.stdout.write('.')
  }
}
await Promise.all(Array.from({ length: 8 }, work))
faces.sort((a, b) => a.family.localeCompare(b.family) || a.weight - b.weight || a.style.localeCompare(b.style))
for (const face of faces) {
  face.sha256 = createHash('sha256')
    .update(readFileSync(join(dir, 'files', face.file)))
    .digest('hex')
}
writeFileSync(join(dir, 'catalogue.json'), JSON.stringify(faces, null, 1))
console.log(`\n${faces.length} faces`)
