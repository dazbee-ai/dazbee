// PROTOTYPE. Startup cost: from the process starting to the first block matched (CanvasKit loaded,
// modules compiled, one small block through Medium). performance.now() counts from the process start.
import { loadCanvasKit } from '@dazbee/renderer/node'
import { matchBlock, MEDIUM } from './match.ts'
import { decodeFile } from './pixels.ts'
const imported = performance.now()
const ck = await loadCanvasKit()
const loaded = performance.now()
const img = decodeFile(ck, `${process.env.TESTADS_ADS ?? '../../../../ming-setup/test_ads'}/bakery_crumb/block_07.png`)
matchBlock(ck, img, MEDIUM)
const first = performance.now()
console.log(
  JSON.stringify({
    toModulesMs: imported,
    toCanvasKitMs: loaded,
    toFirstBlockMs: first,
    rssMB: process.memoryUsage().rss / 2 ** 20,
  }),
)
