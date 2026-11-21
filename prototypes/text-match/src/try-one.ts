// PROTOTYPE. Matches one ad's blocks, Light and Medium, and writes side-by-side pictures to .data/try.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { DATA_DIR, loadCatalogue } from './catalogue.ts'
import { loadAd } from './deltax.ts'
import { makeDrawer } from './draw.ts'
import { loadFingerprints, openModel } from './fingerprint.ts'
import { matchBlock } from './match.ts'
import { measure } from './measure.ts'
import { writePng } from './png.ts'
import { sideBySide } from './sheet.ts'
const [adName = 'bakery_crumb', modelDir = join(DATA_DIR, 'models', 'smoke')] = process.argv.slice(2)
const ck = await loadCanvasKit()
const drawer = makeDrawer(ck, loadCatalogue().filter((f) => f.source === 'shipped'))
const catalogue = loadCatalogue(join(DATA_DIR, 'fonts', 'library.json'))
const ctx = { ck, drawer, catalogue, subset: process.argv[4] === 'subset', model: await openModel(join(modelDir, 'model.onnx')), fingerprints: loadFingerprints(modelDir) }
const out = join(DATA_DIR, 'try'); mkdirSync(out, { recursive: true })
for (const b of loadAd(adName).blocks) {
  const m = measure(b.block)
  const res = []
  for (const v of ['light', 'medium'] as const) {
    const r = await matchBlock(ctx, b.block, v)
    res.push(r)
    console.log(b.ad, b.index, JSON.stringify(b.block.text), v, r.look.family, r.look.weight, r.look.size.toFixed(1), r.look.spacing.toFixed(1), r.look.lineHeight?.toFixed(2), r.look.color, r.look.outline ?? '', 'ssim', r.score.ssim.toFixed(3), 'dE', r.score.deltaE.toFixed(2), r.keepAsPicture ? 'KEEP' : 'live', r.draws, 'draws', r.ms.toFixed(0), 'ms')
  }
  const draws = res.map((r) => ({ width: b.block.rgba.width, height: b.block.rgba.height, data: drawer.draw(b.block.rgba.width, b.block.rgba.height, null, r.layer) }))
  writePng(join(out, `${b.ad}-${b.index}.png`), sideBySide([b.block.rgba, ...draws], m.background))
}
