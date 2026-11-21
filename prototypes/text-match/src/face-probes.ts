// PROTOTYPE. Each face's probe: its script's test letters (SCRIPT_PROBES) drawn by Dazbee's renderer at
// one size in one place, kept as alpha. Faces whose probes are near-identical draw the same pixels, so
// no picture can tell them apart; training merges them into one class (train/train2.py --merge).
//   node src/face-probes.ts --faces .data/fonts/library.json --out .data/samples/lib-probes
// Writes <out>/probes.u8 (faces × 48 × 512) and meta.json (faces, each face's probe script).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { faceId, loadCatalogue, SCRIPT_PROBES } from './catalogue.ts'
import { makeDrawer, textProps } from './draw.ts'

const H = 48
const W = 512
const { values } = parseArgs({ options: { faces: { type: 'string' }, out: { type: 'string' } } })
const faces = loadCatalogue(values.faces).filter((f) => (f.scripts ?? []).length > 0)
const ck = await loadCanvasKit()
const drawer = makeDrawer(ck, [])
const all = new Uint8Array(faces.length * H * W)
faces.forEach((face, i) => {
  drawer.use([face])
  const look = {
    family: face.family,
    weight: face.weight,
    style: face.style,
    size: 28,
    spacing: 0,
    align: 'start' as const,
    color: '#000000FF',
  }
  const px = drawer.draw(
    W,
    H,
    null,
    textProps(SCRIPT_PROBES[face.scripts![0]!], look, { x: 4, y: 6, width: W - 8, height: 36, rotation: 0 }),
  )
  for (let k = 0; k < H * W; k++) all[i * H * W + k] = px[k * 4 + 3]!
})
mkdirSync(values.out!, { recursive: true })
writeFileSync(join(values.out!, 'probes.u8'), all)
writeFileSync(
  join(values.out!, 'meta.json'),
  JSON.stringify({ faces: faces.map(faceId), scripts: faces.map((f) => f.scripts![0]), height: H, width: W }),
)
console.log(`${faces.length} probes`)
