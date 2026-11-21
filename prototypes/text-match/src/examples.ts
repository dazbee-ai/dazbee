// PROTOTYPE. Side-by-side pictures of test-ad blocks: the block | the old worker's choice | Light | Medium,
// each drawn by Dazbee's renderer on the block's background. The old worker's answer (its regression
// results) is turned into Dazbee's units (size and position from the ad's pixels to the block's,
// charSpacing in thousandths of an em to percent, Fabric's line height × 1.13) and placed by its ink
// centre as ours are. Also scores the old worker's answers by the shared rule.
//   node src/examples.ts --results testads-lib --old .data/old-worker/four-core-regression/results
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { type CatalogueFace, DATA_DIR, fallbackFaces, LIBRARY } from './catalogue.ts'
import { loadAd } from './testads.ts'
import { makeDrawer, type TextLook, textProps } from './draw.ts'
import { placeAndRank, untilt } from './match.ts'
import { measure } from './measure.ts'
import { type Rgba, writePng } from './png.ts'
import { ruleV2, score } from './score.ts'
import { sideBySide } from './sheet.ts'

const { values } = parseArgs({
  options: {
    results: { type: 'string', default: 'testads-lib' },
    old: { type: 'string', default: join(DATA_DIR, 'old-worker', 'four-core-regression', 'results') },
    pick: { type: 'string' },
    out: { type: 'string', default: 'examples' },
  },
})
const ck = await loadCanvasKit()
const library = LIBRARY
const drawer = makeDrawer(ck, fallbackFaces(LIBRARY))
const results = JSON.parse(readFileSync(join(DATA_DIR, 'results', `${values.results}.json`), 'utf8')).results as {
  id: string
  version: string
  text: string
  look: TextLook
  place: { x: number; y: number; width: number; height: number; rotation: number }
}[]
const out = join(DATA_DIR, values.out!)
mkdirSync(out, { recursive: true })
const picked = values.pick ? new Set(values.pick.split(',')) : null
const oldScores: Record<string, unknown>[] = []
const ads = [...new Set(results.map((r) => r.id.split('#')[0]!))]
for (const ad of ads) {
  const { blocks } = loadAd(ad)
  const oldFile = join(values.old!, `${ad}.json`)
  const old = existsSync(oldFile)
    ? (JSON.parse(readFileSync(oldFile, 'utf8')) as { blocks: { index: number; keep_as_image: boolean; layer: Record<string, unknown> }[] }).blocks
    : null
  for (const b of blocks) {
    const id = `${ad}#${b.index}`
    const m = measure(b.block)
    const size = { width: b.block.rgba.width, height: b.block.rgba.height }
    const drawLook = (faces: CatalogueFace[], look: TextLook, place: typeof results[0]['place']): Rgba => {
      drawer.use(faces)
      return { ...size, data: drawer.draw(size.width, size.height, null, textProps(b.block.text, look, place)) }
    }
    let oldImg: Rgba | null = null
    const o = old?.find((x) => x.index === b.index)
    if (o) {
      const L = o.layer
      const family = String(L.fontFamily)
      const faces = library.filter((f) => f.family === family)
      if (faces.length > 0) {
        const look: TextLook = {
          family,
          weight: Number(L.fontWeight),
          style: L.fontStyle === 'italic' ? 'italic' : 'normal',
          size: Number(L.fontSize) / b.scale,
          spacing: Number(L.charSpacing) / 10,
          ...(b.block.text.includes('\n') ? { lineHeight: Number(L.lineHeight) * 1.13 } : {}),
          align: L.textAlign === 'center' ? 'center' : L.textAlign === 'right' ? 'end' : 'start',
          color: `${String(L.fill).toUpperCase()}FF`,
          ...(Number(L.strokeWidth) > 0 && L.stroke ? { outline: { width: Number(L.strokeWidth) / b.scale, color: `${String(L.stroke).toUpperCase()}FF` } } : {}),
        }
        drawer.use(faces)
        const fit = placeAndRank(drawer, { ...m }, b.block.text, faces[0]!, look, () => {})
        if (fit) {
          const place = untilt({ ...fit.place }, { ...m, angle: Number(L.angle ?? 0) })
          oldImg = drawLook(faces, look, place)
          const s = score(b.block.rgba, oldImg, m.background)
          oldScores.push({ id, family, keep: o.keep_as_image, ...s, v2: ruleV2(b.block.rgba, oldImg, m.background) })
        }
      }
    }
    if (picked && !picked.has(id)) continue
    const ours = ['light', 'medium'].map((v) => results.find((r) => r.id === id && r.version === v))
    const imgs: Rgba[] = [b.block.rgba, oldImg ?? { ...size, data: new Uint8Array(size.width * size.height * 4) }]
    for (const r of ours) if (r) imgs.push(drawLook(library.filter((f) => f.family === r.look.family), r.look, r.place))
    writePng(join(out, `${ad}-${b.index}.png`), sideBySide(imgs, m.background))
  }
}
writeFileSync(join(out, 'old-worker-scores.json'), JSON.stringify(oldScores, null, 1))
const same = oldScores.filter((s) => s.same).length
console.log(`old worker: ${oldScores.length} blocks drawn, ${same} look the same by the shared rule, ${oldScores.filter((s) => (s.v2 as { same: boolean }).same).length} by rule v2`)
