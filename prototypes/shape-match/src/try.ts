// PROTOTYPE. Runs Light and Medium on named DeltaX blocks and writes block | Light | Medium sheets.
import { mkdirSync, readFileSync } from 'node:fs'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { drawLayers } from './draw.ts'
import { LIGHT, matchBlock, MEDIUM } from './match.ts'
import { decodeFile, savePng, sheet } from './pixels.ts'
const ck = await loadCanvasKit()
const root = 'C:/Users/imkes/Desktop/ming-setup/test_ads'
mkdirSync('out/try', { recursive: true })
for (const arg of process.argv.slice(2)) {
  const [ad, file] = arg.startsWith('synth:') ? ['synth', `${arg.slice(6)}.png`] : arg.split('/')
  const img = decodeFile(ck, ad === 'synth' ? `data/synth/${file}` : `${root}/${ad}/${file}`)
  const row = [img]
  for (const cfg of [LIGHT, MEDIUM]) {
    const r = matchBlock(ck, img, cfg)
    console.log(
      arg,
      cfg.level,
      r.decision,
      r.why,
      r.score ? `ssim ${r.score.ssim.toFixed(3)} dE ${r.score.deltaE.toFixed(2)}` : '',
      `layers ${r.layers.length}`,
      `${r.ms.toFixed(0)}ms`,
      `renders ${r.renders}`,
    )
    for (const l of r.layers)
      console.log(
        '   ',
        l.name,
        JSON.stringify(l.props.shape),
        JSON.stringify(l.props.fills).slice(0, 120),
        l.props.effects ? JSON.stringify(l.props.effects) : '',
      )
    row.push(drawLayers(ck, r.layers, img.w, img.h))
  }
  savePng(ck, sheet(row), `out/try/${ad}_${file}`)
}
