// PROTOTYPE, never merged. Times the command bar in Node through Cactus's WebAssembly engine
// (cactus.js and cactus.wasm from `cactus download wasm`), one request at a time, both turns.
//
//   node bench_wasm.cjs <wasm folder> <archive.cact> <queries.jsonl> [count] [shared|per-toolset]
//
// shared: one engine; each turn sets its tools with cactus_init, then cactus_complete.
// per-toolset: one engine per toolset (router and five areas), each set up once; a turn is
// cactus_reset and cactus_complete on that toolset's engine.
// TOOLS=<file> takes the toolsets from a file {router, areas} instead; with no router it is one
// turn on the toolset "all" (round 2's one-turn schema: one engine).
const fs = require('node:fs')
const path = require('node:path')

const [dir, archive, queriesPath, countArg, mode = 'shared'] = process.argv.slice(2)
const createCactus = require(path.resolve(dir, 'cactus.js'))
const tools = JSON.parse(fs.readFileSync(process.env.TOOLS || path.join(__dirname, 'data', 'tools.json'), 'utf8'))
const oneTurn = Boolean(process.env.TOOLS) && !tools.router
const toolsets = process.env.TOOLS
  ? { ...(tools.router ? { router: tools.router } : {}), ...tools.areas }
  : { router: tools.areas, ...tools.actions }
const queries = fs
  .readFileSync(queriesPath, 'utf8')
  .trim()
  .split('\n')
  .map((l) => JSON.parse(l))
  .slice(0, Number(countArg ?? 50))

function cstr(M, s) {
  const b = Buffer.from(s + '\0', 'utf8')
  const p = M._malloc(b.length)
  M.HEAPU8.set(b, p)
  return p
}

async function engine(bytes) {
  const M = await createCactus({ locateFile: (f) => path.resolve(dir, f) })
  const p = M._malloc(bytes.length)
  M.HEAPU8.set(bytes, p)
  if (M._cactus_load(p, BigInt(bytes.length)) < 0) throw new Error('load failed')
  M.out = M._malloc(1 << 16)
  M.empty = cstr(M, '')
  return M
}

function init(M, key) {
  const tp = cstr(M, JSON.stringify(toolsets[key]))
  const t = performance.now()
  if (M._cactus_init(M.empty, tp, 0) < 0) throw new Error('init failed')
  M._free(tp)
  return performance.now() - t
}

function complete(M, q) {
  const qp = cstr(M, q)
  const t = performance.now()
  const rc = M._cactus_complete(qp, 0, 0, 160, M.out, 1 << 16)
  const ms = performance.now() - t
  M._free(qp)
  if (rc < 0) throw new Error('complete failed ' + M.UTF8ToString(M._cactus_last_error()))
  return [JSON.parse(M.UTF8ToString(M.out)), ms]
}

async function main() {
  const bytes = fs.readFileSync(archive)
  const t0 = performance.now()
  const engines = {}
  if (mode === 'per-toolset') {
    for (const key of Object.keys(toolsets)) {
      engines[key] = await engine(bytes)
      init(engines[key], key)
    }
  } else engines.shared = await engine(bytes)
  const setupMs = performance.now() - t0
  const total = []
  const inits = []
  const completes = []
  for (const row of queries) {
    const t = performance.now()
    const turn = (key) => {
      let M = engines[key]
      if (mode === 'per-toolset') M._cactus_reset()
      else {
        M = engines.shared
        inits.push(init(M, key))
      }
      const [r, ms] = complete(M, row.query)
      completes.push(ms)
      return r
    }
    if (oneTurn) turn('all')
    else {
      const r1 = turn('router')
      const area = r1.function_calls?.[0]?.name
      if (area && toolsets[area]) turn(area)
    }
    total.push(performance.now() - t)
  }
  const stat = (xs) => {
    const s = [...xs].sort((a, b) => a - b)
    return {
      mean: Math.round(s.reduce((a, b) => a + b, 0) / Math.max(1, s.length)),
      p50: Math.round(s[Math.floor(s.length / 2)] ?? 0),
      p95: Math.round(s[Math.floor(s.length * 0.95)] ?? 0),
    }
  }
  const heaps = Object.values(engines).reduce((a, M) => a + M.HEAPU8.length, 0)
  console.log(
    JSON.stringify({
      archive: path.basename(path.dirname(archive)) + '/' + path.basename(archive),
      mode,
      bytes: bytes.length,
      setup_ms: Math.round(setupMs),
      requests: total.length,
      request_ms: stat(total),
      init_ms: stat(inits),
      complete_ms: stat(completes),
      wasm_heaps_mb: Math.round(heaps / 1e6),
      node_rss_mb: Math.round(process.memoryUsage().rss / 1e6),
    }),
  )
}
main()
