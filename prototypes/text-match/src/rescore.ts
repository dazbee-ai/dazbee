// PROTOTYPE. Scores stored results again by the proposed rule v2 (score.ts ruleV2), drawing each
// stored text layer with Dazbee's renderer: .data/results/<name>.json → <name>-v2.json, one entry per
// result with the v2 score beside the shared rule's. A new rule is added here and in score.ts, and
// every stored result scored again with it; nothing is matched again.
//   node src/rescore.ts testads-lib-final r3-own-test
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { DATA_DIR, fallbackFaces, LIBRARY } from './catalogue.ts'
import { loadAd } from './testads.ts'
import { makeDrawer } from './draw.ts'
import { hasTransparency } from './match.ts'
import type { Block } from './measure.ts'
import { measure } from './measure.ts'
import { ruleV2 } from './score.ts'
import { loadSet, type SetName } from './sets.ts'

const ck = await loadCanvasKit()
const drawer = makeDrawer(ck, fallbackFaces(LIBRARY))
for (const name of process.argv.slice(2)) {
  const file = JSON.parse(readFileSync(join(DATA_DIR, 'results', `${name}.json`), 'utf8')) as {
    set: string
    results: { id: string; version: string; same: boolean; look: { family: string }; layer: Record<string, unknown> }[]
  }
  const blocks = new Map<string, Block>()
  const blockOf = (id: string): Block => {
    let b = blocks.get(id)
    if (b) return b
    if (file.set === 'testads') {
      const [ad, index] = id.split('#')
      for (const x of loadAd(ad!).blocks) blocks.set(`${ad}#${x.index}`, x.block)
    } else for (const it of loadSet(file.set as SetName, 'all')) blocks.set(it.id, it.block)
    b = blocks.get(id)!
    return b
  }
  const out = file.results.map((r) => {
    const block = blockOf(r.id)
    const m = measure(block)
    drawer.use(LIBRARY.filter((f) => f.family === r.look.family && f.weight === (r.look as { weight?: number }).weight))
    const drawn = {
      width: block.rgba.width,
      height: block.rgba.height,
      data: drawer.draw(block.rgba.width, block.rgba.height, null, r.layer),
    }
    const flat = !hasTransparency(block.rgba)
    return {
      id: r.id,
      version: r.version,
      same: r.same,
      v2: ruleV2(block.rgba, drawn, m.background, flat ? m.ink.data : undefined),
    }
  })
  writeFileSync(join(DATA_DIR, 'results', `${name}-v2.json`), JSON.stringify(out, null, 1))
  for (const v of ['light', 'medium']) {
    const rs = out.filter((x) => x.version === v)
    console.log(
      name,
      v,
      rs.length,
      'shared rule',
      rs.filter((x) => x.same).length,
      'v2',
      rs.filter((x) => x.v2.same).length,
    )
  }
}
