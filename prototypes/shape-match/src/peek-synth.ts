import { loadCanvasKit } from '@dazbee/renderer/node'
import { decodeFile, savePng, sheet } from './pixels.ts'
const ck = await loadCanvasKit()
const ids = process.argv.slice(2).map(Number)
savePng(ck, sheet(ids.map((i) => decodeFile(ck, `data/synth/${i}.png`))), 'out/synth-peek.png')
