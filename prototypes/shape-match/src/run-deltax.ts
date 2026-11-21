// PROTOTYPE. Runs Light and/or Medium over the DeltaX test ads' blocks and writes one JSON line per
// block to out/deltax-<level>.jsonl. Usage: node src/run-deltax.ts light|medium [ad ...]
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { LIGHT, matchBlock, MEDIUM } from './match.ts'
import { decodeFile } from './pixels.ts'

import { ADS, isFrozenAd } from './paths.ts'
export { ADS }
/** The kinds the old worker converts (its `convert` list), and the kinds that must stay pictures. */
export const CONVERT = ['shape', 'graphic', 'background']
export const PICTURE = ['photo', 'cutout']

const t0 = performance.now()
const ck = await loadCanvasKit()
const startup = performance.now() - t0
const level = process.argv[2] === 'medium' ? 'medium' : 'light'
const cfg = level === 'medium' ? MEDIUM : LIGHT
// dev: the 32 ads developed on; frozen: the 16 held out from round 2; all, or ad names.
const set = ['dev', 'frozen', 'all'].includes(process.argv[3] ?? '') ? process.argv[3]! : 'all'
const only = set === 'all' && process.argv[3] ? process.argv.slice(3) : []
mkdirSync('out', { recursive: true })
const lines: string[] = []
const allAds = readdirSync(ADS).sort()
const ads = allAds.filter(
  (d) => (only.length === 0 || only.includes(d)) && (set === 'all' || (set === 'frozen') === isFrozenAd(allAds, d)),
)
for (const ad of ads) {
  const blocks = JSON.parse(readFileSync(`${ADS}/${ad}/blocks.json`, 'utf8')) as {
    blocks: { file: string; kind: string; name: string; element: string; rect: number[] }[]
  }
  for (const [index, b] of blocks.blocks.entries()) {
    if (![...CONVERT, ...PICTURE, 'logo'].includes(b.kind)) continue
    const img = decodeFile(ck, `${ADS}/${ad}/${b.file}`)
    const r = matchBlock(ck, img, cfg)
    const row = {
      ad,
      index,
      element: b.element,
      file: b.file,
      kind: b.kind,
      name: b.name,
      w: img.w,
      h: img.h,
      decision: r.decision,
      why: r.why,
      ssim: r.score?.ssim ?? null,
      deltaE: r.score?.deltaE ?? null,
      deltaEContent: r.score?.deltaEContent ?? null,
      ssimV2: r.score?.v2?.ssim ?? null,
      deltaEV2: r.score?.v2?.deltaE ?? null,
      lostV2: r.score?.v2?.lost ?? null,
      same: r.score?.same ?? false,
      layers: r.layers.length,
      names: r.layers.map((l) => l.name),
      kinds: r.layers.map((l) => (l.props.shape as { kind: string }).kind),
      gradients: r.layers.filter((l) => (l.props.fills as { type: string }[]).some((f) => f.type !== 'solid')).length,
      shadows: r.layers.filter((l) => Array.isArray(l.props.effects) && (l.props.effects as unknown[]).length > 0)
        .length,
      ms: r.ms,
      renders: r.renders,
    }
    lines.push(JSON.stringify(row))
    // Free one block's buffers before the next: a worker does the same between blocks.
    ;(globalThis as { gc?: () => void }).gc?.()
    console.log(
      `${ad.padEnd(24)} ${b.file} ${b.kind.padEnd(10)} ${r.decision.padEnd(7)} ${r.score ? r.score.ssim.toFixed(3) + ' ' + r.score.deltaE.toFixed(2) : '-'} L${r.layers.length} ${r.ms.toFixed(0)}ms ${r.why}`,
    )
  }
}
const usage = process.resourceUsage()
writeFileSync(
  `out/deltax-${level}${process.env.RULE === 'v2' ? '-v2' : ''}${set !== 'all' ? '-' + set : ''}${only.length ? '-part' : ''}.jsonl`,
  lines.join('\n') + '\n',
)
writeFileSync(
  `out/deltax-${level}${process.env.RULE === 'v2' ? '-v2' : ''}${set !== 'all' ? '-' + set : ''}${only.length ? '-part' : ''}-run.json`,
  JSON.stringify({
    startupMs: startup,
    maxRssMB: usage.maxRSS / 1024,
    userCpuMs: usage.userCPUTime / 1000,
    wallMs: performance.now() - t0,
  }),
)
console.log('startup ms', startup.toFixed(0), 'max RSS MB', (usage.maxRSS / 1024).toFixed(0))
