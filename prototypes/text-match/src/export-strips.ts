// PROTOTYPE. A set's blocks as the fingerprint model reads them, for choosing checkpoints by face and
// family accuracy on realistic blocks without running the whole matcher: each block measured as the
// matcher measures it, each line's strip cut at `--height`, labelled with the block's face (an index
// into the library's faces, as the sample sets list them; -1 when only the family is known).
//   node src/export-strips.ts --set own --part dev --height 64 --out own-dev64
// Writes .data/samples/<out>/: strips.u8 (lines × height × width), widths.u16, meta.json (faces,
// families, and per block its label, family and lines). `--set testads` takes the test-ad development ads'
// blocks (never the held-out ads), unlabelled: for adapting a model's batch statistics (AdaBN).
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { DATA_DIR, faceId, LIBRARY } from './catalogue.ts'
import { lineStrips } from './fingerprint.ts'
import { measure } from './measure.ts'
import { adNames, isHeldOut, loadAd } from './testads.ts'
import { type Item, loadSet, type SetName } from './sets.ts'

const { values } = parseArgs({
  options: {
    set: { type: 'string', default: 'own' },
    part: { type: 'string', default: 'dev' },
    height: { type: 'string', default: '64' },
    width: { type: 'string', default: '1536' },
    out: { type: 'string' },
  },
})
const height = Number(values.height)
const width = Number(values.width)
const faces = LIBRARY.filter((f) => (f.scripts ?? []).length > 0).map(faceId)
const index = new Map(faces.map((f, i) => [f, i]))
const items: Pick<Item, 'id' | 'block' | 'truth'>[] =
  values.set === 'testads'
    ? adNames()
        .filter((a) => !isHeldOut(a))
        .flatMap((a) =>
          loadAd(a).blocks.map((b) => ({
            id: `${a}#${b.index}`,
            block: b.block,
            truth: { face: '', family: '' } as Item['truth'],
          })),
        )
    : loadSet(values.set as SetName, values.part!)
const chunks: Uint8Array[] = []
const widths: number[] = []
const blocks: { id: string; label: number; family: string; first: number; count: number }[] = []
for (const it of items) {
  const m = measure(it.block)
  const strips = lineStrips(m.level, m.lines, height, 1, width)
  blocks.push({
    id: it.id,
    label: it.truth.face ? (index.get(it.truth.face) ?? -1) : -1,
    family: it.truth.family,
    first: widths.length,
    count: strips.length,
  })
  for (const s of strips) {
    const padded = new Uint8Array(height * width)
    for (let y = 0; y < height; y++) padded.set(s.data.subarray(y * s.width, (y + 1) * s.width), y * width)
    chunks.push(padded)
    widths.push(s.width)
  }
}
const dir = join(DATA_DIR, 'samples', values.out!)
mkdirSync(dir, { recursive: true })
const all = new Uint8Array(chunks.length * height * width)
chunks.forEach((c, i) => all.set(c, i * height * width))
writeFileSync(join(dir, 'strips.u8'), all)
writeFileSync(join(dir, 'widths.u16'), new Uint16Array(widths))
writeFileSync(
  join(dir, 'meta.json'),
  JSON.stringify({ set: values.set, part: values.part, height, width, faces, blocks }),
)
console.log(
  `${blocks.length} blocks, ${widths.length} lines; ${blocks.filter((b) => b.label < 0).length} with the family only`,
)
