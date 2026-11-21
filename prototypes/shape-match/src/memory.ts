// PROTOTYPE. Where the memory goes: process RSS (and CanvasKit's wasm heap) after each stage of
// matching one ad's blocks, one block at a time. Usage: node src/memory.ts <ad> [light|medium]
import { readFileSync } from 'node:fs'

const mb = (b: number) => Math.round(b / 2 ** 20)
const rows: string[] = []
const mark = (stage: string, extra = '') => {
  const m = process.memoryUsage()
  rows.push(
    `${stage.padEnd(34)} rss ${mb(m.rss)} MB, max rss ${Math.round(process.resourceUsage().maxRSS / 1024)} MB, JS heap ${mb(m.heapUsed)} MB, array buffers ${mb(m.arrayBuffers)} MB ${extra}`,
  )
}
mark('node started')
const { loadCanvasKit } = await import('@dazbee/renderer/node')
const { matchBlock, LIGHT, MEDIUM } = await import('./match.ts')
const { decodeFile } = await import('./pixels.ts')
const { ADS } = await import('./paths.ts')
const { pairCacheSize } = await import('./score.ts')
mark('modules loaded')
const ck = await loadCanvasKit()
const wasm = () => `, wasm heap ${mb((ck as unknown as { HEAPU8?: Uint8Array }).HEAPU8?.buffer.byteLength ?? 0)} MB`
mark('CanvasKit loaded', wasm())
const ad = process.argv[2]!
const cfg = process.argv[3] === 'light' ? LIGHT : MEDIUM
const blocks = (
  JSON.parse(readFileSync(`${ADS}/${ad}/blocks.json`, 'utf8')) as { blocks: { file: string; kind: string }[] }
).blocks
for (const b of blocks.filter((x) => ['shape', 'graphic', 'background'].includes(x.kind))) {
  const img = decodeFile(ck, `${ADS}/${ad}/${b.file}`)
  mark(`decoded ${b.file} ${img.w}x${img.h}`, `(${mb(img.d.byteLength)} MB as float RGBA)`)
  const r = matchBlock(ck, img, cfg)
  ;(globalThis as { gc?: () => void }).gc?.()
  mark(`matched ${b.file}`, `${r.decision} ${Math.round(r.ms)} ms${wasm()}, ΔE pair memo ${pairCacheSize()} entries`)
}
console.log(rows.join('\n'))
