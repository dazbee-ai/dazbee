// The browser measurement's server, never shipped: it stands in for the web app and the API, serving the
// page and every file the matchers load at its production path, from local folders: CanvasKit's and ONNX Runtime's
// WebAssembly and the shipped faces under `/vendor/`, the release's files at `/matchers/<sha256>.bin`, and the
// Google faces at `/fonts/google/faces/` and their match copies at `/fonts/google/match/`, cut from a checkout of
// google/fonts as the Node measurements cut them. Code, WebAssembly and the matcher's files are sent gzipped, as a
// CDN sends them; faces as stored. Faces, the matcher's files and ONNX Runtime are never kept by the browser's HTTP
// cache, so each ad's fonts are fetched cold and a second open that fetches no matcher file shows Cache Storage
// kept it; CanvasKit, the editor's own, is kept for good as production keeps it. It answers this machine only, logs the
// bytes of every response under the page's latest mark, and samples Chrome's renderer processes' private memory
// every 250 ms while the page asks it to (Windows only).
//   GOOGLE_FONTS_DIR=<google/fonts checkout> node scripts/browser-measure/server.ts [--port 8793] [--profile <dir>]
// `--profile` names the folder of the Chrome profile whose renderers are sampled (chrome-mcp-profile, the profile
// chrome-devtools' Chrome runs in). Then open http://localhost:8793/ and call `measure.run(…)` (page.ts).
import { type ChildProcess, spawn } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { createRequire } from 'node:module'
import { dirname, extname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { gzipSync } from 'node:zlib'

import { WASM_FILE } from '@dazbee/canvaskit/wasm'
import { GOOGLE_FONTS, googleFaces } from '@dazbee/fonts/google'
import { matchCopy } from '@dazbee/fonts/match-copy'
import { FONT_FILES_DIR } from '@dazbee/fonts/node'
import { type FontFamily, GOOGLE_FONT_PATH, GOOGLE_MATCH_PATH, MATCHER_FILE_PATH } from '@dazbee/schema'

import release from '../../src/release.json' with { type: 'json' }
import { FILES_DIR } from '../fetch-files.ts'
import { OUT_DIR } from './build.ts'

/** A response as the log keeps it: when, what, its bytes as stored and as sent, and the page's mark it fell under. */
interface Logged {
  t: number
  url: string
  status: number
  bytes: number
  sent: number
  mark: string
}

/** A renderer's private bytes at a moment. */
interface Sample {
  t: number
  pid: number
  bytes: number
}

/** Responses sent gzipped, by their extension, as a CDN sends them; faces go as stored. */
const GZIPPED = new Set(['.js', '.wasm', '.bin', '.json', '.html'])
const TYPES: Record<string, string> = {
  '.js': 'text/javascript',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.json': 'application/json',
  '.html': 'text/html',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}
/** How production answers a file kept for good, and how the harness's own and the faces are sent. */
const KEPT = 'public, max-age=31536000, immutable'
const NO_STORE = 'no-store'
const PAGE =
  '<!doctype html><meta charset="utf-8"><title>Browser measurement</title><script type="module" src="/harness/page.js"></script>'
/** How often the renderers' memory is read. */
const SAMPLE_MS = 250

const { values } = parseArgs({
  options: { port: { type: 'string', default: '8793' }, profile: { type: 'string', default: 'chrome-mcp-profile' } },
})
const checkout = process.env.GOOGLE_FONTS_DIR
if (!checkout) {
  console.error('Usage: GOOGLE_FONTS_DIR=<google/fonts checkout> node server.ts [--port 8793] [--profile <dir>]')
  process.exit(1)
}
const require = createRequire(import.meta.url)
const editorRequire = createRequire(join(import.meta.dirname, '..', '..', '..', 'editor', 'package.json'))
const ortWasm = editorRequire.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm')
const ortVersion = (
  JSON.parse(readFileSync(join(dirname(ortWasm), '..', 'package.json'), 'utf8')) as { version: string }
).version

/** Each Google face's file in the checkout, by the id the catalog gives it, and the catalog the page sends jobs with. */
const faceFiles = new Map<string, string>()
const catalog: FontFamily[] = GOOGLE_FONTS.map((family, i) => ({
  family: family.family,
  source: 'google',
  category: family.category,
  rank: family.rank,
  scripts: family.scripts,
  faces: googleFaces(family).map((face, j) => {
    const id = `g${i}-${j}`
    faceFiles.set(id, join(checkout, family.path, face.file))
    return {
      id,
      family: family.family,
      weight: face.weight,
      ...(face.weights ? { weights: face.weights } : {}),
      style: face.style,
      source: 'google' as const,
      byteSize: face.bytes,
    }
  }),
}))
const matcherFiles = new Map(Object.entries(release.files).map(([name, { sha256 }]) => [sha256, join(FILES_DIR, name)]))
const copies = new Map<string, Buffer>()
const gzipped = new Map<string, Buffer>()

const log: Logged[] = []
const marks: { t: number; label: string }[] = []
let sampler: ChildProcess | undefined
let samples: Sample[] = []

mkdirSync(join(OUT_DIR, 'results'), { recursive: true })
const logFile = join(OUT_DIR, 'requests.jsonl')
createServer((request, response) => {
  void answer(request, response).catch((error: unknown) => {
    console.error(error)
    if (!response.headersSent) response.writeHead(500)
    response.end()
  })
}).listen(Number(values.port), '127.0.0.1', () => console.log(`http://localhost:${values.port}/`))

/** Answers a request: a harness call, or a file at its production path. */
async function answer(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? '/', 'http://localhost')
  const path = decodeURIComponent(url.pathname)
  if (path.startsWith('/harness/') && !extname(path)) return harness(path, url, request, response)
  if (path === '/') return send(request, response, '/', Buffer.from(PAGE))
  if (path === '/harness/data/catalog.json') return send(request, response, path, Buffer.from(JSON.stringify(catalog)))
  const file = fileAt(path)
  if (!file || !existsSync(file.path)) {
    response.writeHead(404, { 'cache-control': NO_STORE })
    response.end()
    return logResponse(path, 404, 0, 0)
  }
  const bytes = file.copy ? matchCopyOf(file.path) : readFileSync(file.path)
  send(request, response, path, bytes, file.kept ? KEPT : NO_STORE)
}

/**
 * The page's calls: a mark the responses after it are logged under; the responses since a mark, by mark; memory
 * sampling started, and stopped with its summary; and a run's results written to `results/<name>.json`.
 */
async function harness(path: string, url: URL, request: IncomingMessage, response: ServerResponse) {
  const json = (value: unknown) => {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': NO_STORE })
    response.end(JSON.stringify(value))
  }
  if (path === '/harness/mark') {
    marks.push({ t: Date.now(), label: url.searchParams.get('label') ?? '' })
    return json({ t: marks.at(-1)?.t })
  }
  if (path === '/harness/downloads') return json(downloadsSince(url.searchParams.get('from') ?? ''))
  if (path === '/harness/memory/start') {
    startSampling(values.profile)
    return json({ sampling: true })
  }
  if (path === '/harness/memory/stop') return json(stopSampling())
  if (path === '/harness/result' && request.method === 'POST') {
    const name = (url.searchParams.get('name') ?? 'run').replace(/[^\w.-]/g, '_')
    const chunks: Buffer[] = []
    for await (const chunk of request) chunks.push(chunk as Buffer)
    writeFileSync(join(OUT_DIR, 'results', `${name}.json`), Buffer.concat(chunks))
    return json({ written: name })
  }
  response.writeHead(404)
  response.end()
}

/** The responses since the latest mark labelled `from`, each mark's files with their bytes as stored and as sent. */
function downloadsSince(from: string) {
  const start = marks.findLast((mark) => mark.label === from)?.t ?? 0
  const byMark: Record<string, { url: string; bytes: number; sent: number }[]> = {}
  for (const logged of log)
    if (logged.t >= start && logged.status === 200 && !logged.url.startsWith('/harness/data/'))
      (byMark[logged.mark] ??= []).push({ url: logged.url, bytes: logged.bytes, sent: logged.sent })
  return byMark
}

/** Starts reading the private bytes of every renderer of the Chrome profile, every 250 ms, in PowerShell. */
function startSampling(profile: string) {
  sampler?.kill()
  samples = []
  const script = `
$ids = @(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match '${profile.replace(/'/g, '')}' -and $_.CommandLine -match '--type=renderer' } | ForEach-Object { $_.ProcessId })
while ($true) {
  $t = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  foreach ($p in Get-Process -Id $ids -ErrorAction SilentlyContinue) { [Console]::Out.WriteLine("$t $($p.Id) $($p.PrivateMemorySize64)") }
  [Console]::Out.Flush()
  Start-Sleep -Milliseconds ${SAMPLE_MS}
}`
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', script], { stdio: ['ignore', 'pipe', 'inherit'] })
  let rest = ''
  child.stdout.on('data', (chunk: Buffer) => {
    const lines = (rest + chunk.toString()).split(/\r?\n/)
    rest = lines.pop() ?? ''
    for (const line of lines) {
      const [t, pid, bytes] = line.trim().split(' ').map(Number)
      if (t && pid && bytes) samples.push({ t, pid, bytes })
    }
  })
  sampler = child
}

/**
 * Stops sampling and sums up the renderer that grew most, the page's: its memory when the job started (the page's
 * `job-start` mark), its peak, 20 s after the last answer (the `last-answer` mark), the level it settles at after it
 * and when it got there (every later sample within 2% or 4 MB of the last), and every sample, in MB from the job's start.
 */
function stopSampling() {
  sampler?.kill()
  sampler = undefined
  const MB = 2 ** 20
  const pids = [...new Set(samples.map((sample) => sample.pid))]
  const growth = (pid: number) => {
    const own = samples.filter((sample) => sample.pid === pid)
    return Math.max(...own.map((sample) => sample.bytes)) - (own[0]?.bytes ?? 0)
  }
  const pid = pids.sort((a, b) => growth(b) - growth(a))[0]
  if (pid === undefined) return { error: 'no renderer of the profile was sampled' }
  const own = samples.filter((sample) => sample.pid === pid)
  const started = marks.findLast((mark) => mark.label === 'job-start')?.t ?? own[0]?.t ?? 0
  const last = marks.findLast((mark) => mark.label === 'last-answer')?.t ?? own.at(-1)?.t ?? 0
  const before = own.filter((sample) => sample.t <= started).at(-1) ?? own[0]
  const start = before?.bytes ?? 0
  const during = own.filter((sample) => sample.t >= started)
  const peak = during.reduce(
    (most, sample) => (sample.bytes > most.bytes ? sample : most),
    during[0] ?? { t: 0, bytes: 0 },
  )
  const after = own.filter((sample) => sample.t >= last)
  const at20 = after.find((sample) => sample.t >= last + 20_000)
  const final = after.at(-1)?.bytes ?? 0
  const settled = after.find((sample, i) =>
    after.slice(i).every((later) => Math.abs(later.bytes - final) <= Math.max(final * 0.02, 4 * MB)),
  )
  const mb = (bytes: number) => Math.round(bytes / MB)
  return {
    pid,
    renderers: pids.length,
    startMb: mb(start),
    peakMb: mb(peak.bytes),
    peakAtS: (peak.t - started) / 1000,
    lastAnswerAtS: (last - started) / 1000,
    at20sMb: at20 ? mb(at20.bytes) : null,
    settledMb: mb(final),
    settledS: settled ? (settled.t - last) / 1000 : null,
    samples: during.map((sample) => [(sample.t - started) / 1000, mb(sample.bytes)]),
  }
}

/** Sends bytes, gzipped when they are code, WebAssembly or the matcher's files and the browser takes gzip, and logs them. */
function send(request: IncomingMessage, response: ServerResponse, path: string, bytes: Buffer, cache = NO_STORE) {
  const extension = path === '/' ? '.html' : extname(path)
  const gzip = GZIPPED.has(extension) && /\bgzip\b/.test(String(request.headers['accept-encoding'] ?? ''))
  let body = bytes
  if (gzip) {
    body = gzipped.get(path) ?? gzipSync(bytes)
    if (cache === KEPT) gzipped.set(path, body)
  }
  response.writeHead(200, {
    'content-type': TYPES[extension] ?? 'application/octet-stream',
    'content-length': body.byteLength,
    'cache-control': cache,
    ...(gzip ? { 'content-encoding': 'gzip' } : {}),
  })
  response.end(body)
  logResponse(path, 200, bytes.byteLength, body.byteLength)
}

function logResponse(url: string, status: number, bytes: number, sent: number) {
  const logged: Logged = { t: Date.now(), url, status, bytes, sent, mark: marks.at(-1)?.label ?? '' }
  log.push(logged)
  appendFileSync(logFile, `${JSON.stringify(logged)}\n`)
}

/**
 * The file served at a production path, a name in one of the folders and no further; whether the browser may keep
 * it for good, as production lets it; and whether it is a match copy.
 */
function fileAt(path: string): { path: string; kept: boolean; copy?: boolean } | null {
  const named = (prefix: string, dir: string) => {
    const name = path.slice(prefix.length)
    return /^[\w.-]+$/.test(name) && !name.startsWith('.') ? join(dir, name) : null
  }
  if (path.startsWith('/harness/')) {
    const found = path.startsWith('/harness/data/')
      ? named('/harness/data/', OUT_DIR)
      : named('/harness/', join(OUT_DIR, 'build'))
    return found ? { path: found, kept: false } : null
  }
  if (path === `/vendor/${WASM_FILE}`) return { path: require.resolve('@dazbee/canvaskit/canvaskit.wasm'), kept: true }
  if (path === `/vendor/onnxruntime/${ortVersion}/ort-wasm-simd-threaded.wasm`) return { path: ortWasm, kept: false }
  if (path.startsWith('/vendor/fonts/')) {
    const found = named('/vendor/fonts/', FONT_FILES_DIR)
    return found ? { path: found, kept: true } : null
  }
  const sha = path.startsWith(MATCHER_FILE_PATH) ? path.slice(MATCHER_FILE_PATH.length, -'.bin'.length) : undefined
  if (sha) return matcherFiles.has(sha) ? { path: matcherFiles.get(sha) ?? '', kept: false } : null
  const face = (prefix: string) =>
    path.startsWith(prefix) ? faceFiles.get(path.slice(prefix.length, -'.ttf'.length)) : undefined
  const copy = face(GOOGLE_MATCH_PATH)
  if (copy) return { path: copy, kept: false, copy: true }
  const whole = face(GOOGLE_FONT_PATH)
  return whole ? { path: whole, kept: false } : null
}

/** A face's match copy, cut once as the Node measurements cut it; the whole face when HarfBuzz can't cut it. */
function matchCopyOf(path: string): Buffer {
  let copy = copies.get(path)
  if (!copy) {
    const whole = new Uint8Array(readFileSync(path))
    copy = Buffer.from(matchCopy(whole) ?? whole)
    copies.set(path, copy)
  }
  return copy
}
