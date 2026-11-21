// PROTOTYPE. A sheet of chosen Crello elements, for looking only; kept in the git-ignored out/ and deleted with the data.
import { loadCanvasKit } from '@dazbee/renderer/node'
import { decodeFile, resize, savePng, sheet } from './pixels.ts'
const ck = await loadCanvasKit()
const imgs = process.argv.slice(3).map((k) => {
  const img = decodeFile(ck, `data/crello/blocks/${k}.png`)
  const s = Math.min(1, 160 / Math.max(img.w, img.h))
  return resize(img, Math.max(1, Math.round(img.w * s)), Math.max(1, Math.round(img.h * s)))
})
savePng(ck, sheet(imgs), process.argv[2]!)
