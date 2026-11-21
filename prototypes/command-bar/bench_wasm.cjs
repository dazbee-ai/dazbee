// PROTOTYPE, never merged. Times the command bar in Node through Cactus's WebAssembly engine
// (cactus.js and cactus.wasm from `cactus download wasm`): load an archive, then for each request
// the two turns, each a cactus_init with that turn's tools and a cactus_complete.
//
//   node bench_wasm.cjs <wasm folder> <archive.cact> <queries.jsonl> [count]
const fs = require('node:fs')
const path = require('node:path')

const [dir, archive, queriesPath, countArg] = process.argv.slice(2)
const createCactus = require(path.resolve(dir, 'cactus.js'))
const tools = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'tools.json'), 'utf8'))
const queries = fs
  .readFileSync(queriesPath, 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l))
  .slice(0, Number(countArg ?? 50))

function cstr(M, s) {
  const n = Buffer.byteLength(s, 'utf8') + 1
  const p = M._malloc(n)
  M.stringToUTF8 ? M.stringToUTF8(s, p, n) : M.HEAPU8.set(Buffer.from(s + '\0', 'utf8'), p)
  return p
}

async function main() {
  const t0 = performance.now()
  const M = await createCactus({ locateFile: (f) => path.resolve(dir, f) })
  const bytes = fs.readFileSync(archive)
  const p = M._malloc(bytes.length)
  M.HEAPU8.set(bytes, p)
  if (M._cactus_load(p, BigInt(bytes.length)) < 0 && M._cactus_load(p, bytes.length) < 0)
    throw new Error('load failed')
  const loadMs = performance.now() - t0
  const cap = 1 << 16
  const out = M._malloc(cap)
  const empty = cstr(M, '')
  const toolPtr = {}
  for (const [k, v] of Object.entries({ router: tools.areas, ...tools.actions })) toolPtr[k] = cstr(M, JSON.stringify(v))
  function complete(toolsKey, q) {
    if (M._cactus_init(empty, toolPtr[toolsKey], 0) < 0) throw new Error('init failed')
    const qp = cstr(M, q)
    const rc = M._cactus_complete(qp, 0, 0, 160, out, cap)
    M._free(qp)
    if (rc < 0) throw new Error('complete failed ' + M.UTF8ToString(M._cactus_last_error()))
    return JSON.parse(M.UTF8ToString(out))
  }
  const times = []
  let peak = 0
  for (const row of queries) {
    const t = performance.now()
    const r1 = complete('router', row.query)
    const area = r1.function_calls?.[0]?.name
    if (area && toolPtr[area]) {
      const r2 = complete(area, row.query)
      peak = Math.max(peak, r2.peak_ram_mb ?? 0)
    }
    times.push(performance.now() - t)
  }
  times.sort((a, b) => a - b)
  const mean = times.reduce((a, b) => a + b, 0) / times.length
  console.log(
    JSON.stringify({
      archive: path.basename(archive),
      bytes: bytes.length,
      load_ms: Math.round(loadMs),
      requests: times.length,
      mean_ms: Math.round(mean),
      p50_ms: Math.round(times[Math.floor(times.length / 2)]),
      p95_ms: Math.round(times[Math.floor(times.length * 0.95)]),
      engine_peak_ram_mb: peak,
      wasm_heap_mb: Math.round(M.HEAPU8.length / 1e6),
      node_rss_mb: Math.round(process.memoryUsage().rss / 1e6),
    }),
  )
}
main()
