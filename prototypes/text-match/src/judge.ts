// PROTOTYPE. Twenty pairs for checking the "looks the same" threshold by eye: DeltaX blocks with their
// Medium result, picked evenly across the results' SSIM range, written as .data/judge/NN.png (block |
// result, on the block's background) with judge.json holding each pair's scores. After looking, write
// the verdicts into .data/judge/verdicts.json ({ "01": true, ... }) and run with --agree.
//   node src/judge.ts --results deltax-lib
//   node src/judge.ts --agree
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { DATA_DIR, loadCatalogue } from './catalogue.ts'
import { loadAd } from './deltax.ts'
import { makeDrawer, textProps } from './draw.ts'
import { measure } from './measure.ts'
import { writePng } from './png.ts'
import { sideBySide } from './sheet.ts'

const { values } = parseArgs({ options: { results: { type: 'string', default: 'deltax-lib' }, agree: { type: 'boolean', default: false } } })
const dir = join(DATA_DIR, 'judge')
mkdirSync(dir, { recursive: true })

if (values.agree) {
  const pairs = JSON.parse(readFileSync(join(dir, 'judge.json'), 'utf8')) as { n: string; same: boolean; ssim: number; deltaE: number }[]
  const verdicts = JSON.parse(readFileSync(join(dir, 'verdicts.json'), 'utf8')) as Record<string, boolean>
  const agree = pairs.filter((p) => verdicts[p.n] === p.same).length
  console.log(`${agree} of ${pairs.length} agree`)
  for (const p of pairs) console.log(p.n, 'rule', p.same, 'eye', verdicts[p.n], p.ssim.toFixed(3), p.deltaE.toFixed(1))
} else {
  const results = (JSON.parse(readFileSync(join(DATA_DIR, 'results', `${values.results}.json`), 'utf8')).results as {
    id: string
    version: string
    ssim: number
    deltaE: number
    same: boolean
    text: string
    look: import('./draw.ts').TextLook
    place: import('./draw.ts').Placed
  }[]).filter((r) => r.version === 'medium')
  const sorted = [...results].sort((a, b) => a.ssim - b.ssim)
  const picks = Array.from({ length: 20 }, (_, i) => sorted[Math.round((i * (sorted.length - 1)) / 19)]!)
  const ck = await loadCanvasKit()
  const library = loadCatalogue(join(DATA_DIR, 'fonts', 'library.json'))
  const drawer = makeDrawer(ck, loadCatalogue().filter((f) => f.source === 'shipped'))
  const out: unknown[] = []
  for (const [i, r] of picks.entries()) {
    const [ad, index] = r.id.split('#')
    const b = loadAd(ad!).blocks.find((x) => x.index === Number(index))!
    const m = measure(b.block)
    drawer.use(library.filter((f) => f.family === r.look.family))
    const drawn = { width: b.block.rgba.width, height: b.block.rgba.height, data: drawer.draw(b.block.rgba.width, b.block.rgba.height, null, textProps(r.text, r.look, r.place)) }
    const n = String(i + 1).padStart(2, '0')
    writePng(join(dir, `${n}.png`), sideBySide([b.block.rgba, drawn], m.background))
    out.push({ n, id: r.id, family: r.look.family, ssim: r.ssim, deltaE: r.deltaE, same: r.same })
  }
  writeFileSync(join(dir, 'judge.json'), JSON.stringify(out, null, 1))
  if (!existsSync(join(dir, 'verdicts.json'))) writeFileSync(join(dir, 'verdicts.json'), '{}')
  console.log(`wrote ${picks.length} pairs to ${dir}`)
}
