// Measures what one agent tab costs on the big carousel: the heap and RSS each tab open on it adds, and how long
// an agent batch of 1,000 steps with its warnings, and a frame's check, take on it. Run by hand, from tests/pixels:
// `node --expose-gc src/agent-tab-cost.ts [tabs] [cards]` (10 tabs and 20 cards unless given). The tabs join one sync
// server in memory, in this process, which holds the design once; one tab is opened first, so what every tab shares
// (CanvasKit, the shipped fonts' files, the server's design) is counted before the tabs measured.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { type AgentStep } from '@dazbee/doc'
import { type AgentTab, openAgentTab } from '@dazbee/editor/agent-tab'
import { memorySync } from '@dazbee/editor/test-link'
import { frameWarnings, runAgentBatchWithWarnings } from '@dazbee/export'
import { loadCanvasKit } from '@dazbee/renderer/node'

import { bigCarousel } from './big-carousel.ts'

const tabs = Number(process.argv[2] ?? 10)
const cards = Number(process.argv[3] ?? 20)
const gc = (globalThis as { gc?: () => void }).gc
if (!gc) throw new Error('run with node --expose-gc')

const ASSETS = join(import.meta.dirname, '..', 'assets')
const mib = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MiB`
const ck = await loadCanvasKit()
const server = memorySync(bigCarousel(cards))

/** An agent tab on the carousel, as an editor's, its images read from the assets. */
const open = () =>
  openAgentTab({
    ck,
    designId: 'd1',
    url: 'ws://s',
    token: () => Promise.resolve('ann'),
    socket: (url) => server.socket(url),
    sources: { assetBytes: async (id) => new Uint8Array(readFileSync(join(ASSETS, `${id}.jpg`))) },
  })

/** The process's memory once what can be let go has been. */
async function memory() {
  for (let i = 0; i < 3; i++) {
    gc?.()
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  const { rss, heapUsed, external, arrayBuffers } = process.memoryUsage()
  return { rss, heapUsed, external, arrayBuffers }
}

const first = await open()
await first.fontsLoaded()
await server.settle()
const before = await memory()
const opened: AgentTab[] = []
for (let i = 0; i < tabs; i++) opened.push(await open())
await server.settle()
const after = await memory()
console.log(`the process with one agent tab open: ${mib(before.rss)} RSS, ${mib(before.heapUsed)} heap`)
console.log(`${tabs} agent tabs on ${cards} cards × 5 frames:`)
for (const key of ['rss', 'heapUsed', 'external', 'arrayBuffers'] as const)
  console.log(`  ${key}: ${mib((after[key] - before[key]) / tabs)} a tab`)

// Each tab then checks every frame of the design, as check_frame does: its fonts loaded, no image.
const frameIds = Object.keys(first.design().frames)
for (const each of opened) {
  await each.fontsLoaded()
  for (const frameId of frameIds) frameWarnings(ck, each.design(), frameId, each.bytes(), { cache: each.cache })
}
const checked = await memory()
console.log(`once each has checked every frame:`)
for (const key of ['rss', 'heapUsed', 'external', 'arrayBuffers'] as const)
  console.log(`  ${key}: ${mib((checked[key] - before[key]) / tabs)} a tab`)

// A batch of 1,000 steps over the cards: each card's title gets words, so its box grows, and its photo moves.
const steps: AgentStep[] = Array.from({ length: 1000 }, (_, i) => {
  const card = (i % cards) + 1
  return i % 2 === 0
    ? { command: 'text.edit', input: { id: `p${card}-title`, op: { kind: 'insert', at: 0, text: 'New ' } } }
    : { command: 'node.update', input: { ids: [`p${card}-photo`], patch: { x: i % 7 } } }
})
const tab = opened[0] ?? first
const started = performance.now()
const result = runAgentBatchWithWarnings(ck, tab.session, steps, tab.bytes(), tab.cache)
const batchMs = performance.now() - started
if (!result.kept) throw new Error(`the batch was not kept: ${JSON.stringify(result.steps.at(-1))}`)
const storeStarted = performance.now()
await server.settle()
const storedMs = performance.now() - storeStarted
console.log(
  `a batch of ${steps.length} steps with its warnings: ${batchMs.toFixed(0)} ms (${result.warnings.length} warnings)`,
)
console.log(`  its change set stored by the server in memory: ${storedMs.toFixed(0)} ms`)

const checkStarted = performance.now()
await tab.fontsLoaded()
const warnings = frameWarnings(ck, tab.design(), 'p1-sq', tab.bytes(), { cache: tab.cache })
console.log(
  `check_frame of a square card: ${(performance.now() - checkStarted).toFixed(0)} ms (${warnings.length} warnings)`,
)

for (const each of [first, ...opened]) await each.close()
process.exit(0)
