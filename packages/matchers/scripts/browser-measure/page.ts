// The browser measurement's page, never shipped. `measure.run(options)` matches the held-out pieces of one
// kind one of two ways: through the editor's own match client and pool, whose workers run the editor's worker
// module (`worker.ts`), with the pool held at a number of workers or sized to this device; or on the page thread,
// through the editor's matcher worker module itself (`matchMessage`, which runs `matchText` or `matchShapes`),
// because DevTools' CPU throttling doesn't reach workers. It sends an ad's pieces at once, each a job of its own,
// one ad after another, and answers each ad's time, every answer against Node's to 1e-9, each heap's peak, the
// files loaded under each ad and, when asked, the renderer's memory, which it also writes to the server as
// `results/<name>.json`. The editor's modules are imported by path: the editor depends on this package.
import type { FontFamily, MatchAnswer } from '@dazbee/schema'

import { matchClient, thisBrowser } from '../../../editor/src/matching/match-client.ts'
import type { MatchMessage, MatchReply } from '../../../editor/src/matching/match-pool.ts'
import {
  type Device,
  documentShown,
  type MatchFonts,
  matchPool,
  type MatchWorker,
  poolLimit,
} from '../../../editor/src/matching/match-pool.ts'
import { compileMatcherModule, MATCHER_CACHE } from '../../../editor/src/matching/matcher-files.ts'
import type { BrowserPiece, BrowserPieces, NodeAnswers } from './build.ts'
import { type Heaps, watchHeaps } from './heaps.ts'
import type { MeasuredReply } from './worker.ts'

/** What a run matches, and how. */
export interface RunOptions {
  /** The results' name, `results/<name>.json`. */
  name: string
  kind: 'text' | 'shape'
  /** For shapes, the 47 shape pieces (`shapes`, the default), the 25 photos and cutouts, or all 72. */
  blocks?: 'shapes' | 'photos' | 'all'
  /** In the editor's pool of workers, or on the page thread. */
  where: 'pool' | 'page'
  /** How many workers the pool is held at; this device's own pool when left out. */
  workers?: number
  /** Only the first this many ads. */
  ads?: number
  /** Whether the renderer's memory is sampled, until 25 s after the last answer. */
  memory?: boolean
  /** Whether the matcher's files kept in Cache Storage are deleted first. */
  cold?: boolean
  /** Whether all the pieces are sent at once, as one ad (`all`), so every worker the pool takes matches at once. */
  together?: boolean
}

/** A worker the pool started, as the page saw it. */
interface SeenWorker {
  started: number
  ready?: number
  ended?: number
  pieces: number
  /** The most the worker said it holds after a piece: its WebAssembly memories and the faces it read. */
  held: number
  heaps: Heaps
}

/** When each of a piece's steps began, in ms from its first step. */
type Steps = Record<string, number>

/** A piece matched: its answer, when its first step and its answer came, and how it compares with Node's. */
interface Matched {
  id: string
  ad: string
  ms: number
  /** When each of the matcher's steps began, in ms from the first. */
  steps: Steps
  answer: MatchAnswer
  sameAsNode: boolean
  differs?: string
  diff: number
}

/** A piece's answer, the time it took from its first step, and its steps. */
interface Answered {
  answer: MatchAnswer
  ms: number
  steps: Steps
}

/** The files the server sent since the job's start, under each of the page's marks. */
type Downloads = Record<string, { url: string; bytes: number; sent: number }[]>

/** Scores and layers count as Node's when no number is further apart than this. */
const TOLERANCE = 1e-9
/** How long memory is sampled before the job and after its last answer. */
const BEFORE_MS = 3_000
const AFTER_MS = 25_000

const heaps = watchHeaps()
/** The matcher the page thread started, which a page keeps until it is loaded again. */
let pageMatcher: RunOptions['kind'] | undefined
const data = Promise.all([
  json<BrowserPieces>('pieces.json'),
  json<NodeAnswers>('node-answers.json').catch((): NodeAnswers => ({})),
  json<FontFamily[]>('catalog.json'),
])

Object.assign(globalThis, { measure: { run } })

/** Matches the pieces as `options` say, and answers the measurements, also written to the server. */
export async function run(options: RunOptions) {
  const [pieces, node, catalog] = await data
  const fonts = { catalog, uploadPath: '/uploads/' }
  const chosen = choose(pieces, options)
  const adOf = (piece: BrowserPiece) => (options.together ? 'all' : piece.ad)
  const ads = [...new Set(chosen.map(adOf))].slice(0, options.ads ?? Infinity)
  if (options.cold) await caches.delete(MATCHER_CACHE)
  if (options.memory) {
    await call('memory/start')
    await wait(BEFORE_MS)
  }
  await call('mark?label=job-start')
  const t0 = performance.now()
  const way = options.where === 'page' ? await onPage(options.kind, fonts) : inPool(options, fonts)
  const startMs = performance.now() - t0
  const matched: Matched[] = []
  const perAd: { ad: string; ms: number; pieces: number }[] = []
  for (const ad of ads) {
    const ofAd = chosen.filter((piece) => adOf(piece) === ad)
    await call(`mark?label=ad:${ad}`)
    const started = performance.now()
    const answers = await way.match(ofAd)
    perAd.push({ ad, ms: performance.now() - started, pieces: ofAd.length })
    answers.forEach(({ answer, ms, steps }, i) => {
      const piece = ofAd[i] as BrowserPiece
      const nodeAnswer = node[piece.id]?.answer
      const compared = nodeAnswer ? compare(answer, nodeAnswer) : { diff: NaN, differs: 'no Node answer' }
      matched.push({ id: piece.id, ad, ms, steps, answer, ...compared, sameAsNode: !compared.differs })
    })
  }
  await call('mark?label=last-answer')
  const memory = options.memory
    ? ((await wait(AFTER_MS).then(() => call('memory/stop'))) as Record<string, unknown>)
    : undefined
  const downloads = (await call('downloads?from=job-start')) as Downloads
  way.destroy()
  const times = (list: readonly number[]) => ({ median: middle(list), slowest: Math.max(...list) })
  const result = {
    options,
    at: new Date().toISOString(),
    browser: { userAgent: navigator.userAgent, ...thisBrowser() },
    startMs,
    perAd: times(perAd.map((ad) => ad.ms)),
    perPiece: times(matched.map((piece) => piece.ms)),
    parity: {
      same: matched.filter((piece) => piece.sameAsNode).length,
      of: matched.length,
      largestDiff: Math.max(0, ...matched.map((piece) => (Number.isNaN(piece.diff) ? 0 : piece.diff))),
      differing: matched.filter((piece) => !piece.sameAsNode).map(({ id, differs }) => ({ id, differs })),
    },
    decisions: tally(matched.map((piece) => decision(piece.answer))),
    workers: way.workers(),
    heaps: peaks([...way.workers().map((worker) => worker.heaps), heaps.read()]),
    memory,
    downloads,
    ads: perAd,
    pieces: matched.map(({ id, ms, steps, answer, sameAsNode, diff }) => ({
      id,
      ms,
      steps,
      decision: decision(answer),
      sameAsNode,
      diff,
    })),
    answers: Object.fromEntries(matched.map((piece) => [piece.id, piece.answer])),
  }
  await fetch(`/harness/result?name=${encodeURIComponent(options.name)}`, {
    method: 'POST',
    body: JSON.stringify(result),
  })
  return {
    ...pick(result, ['startMs', 'perAd', 'perPiece', 'parity', 'decisions', 'heaps', 'ads']),
    workers: { started: result.workers.length, ...pick(result.browser, ['cores', 'memoryGb']) },
    memory: memory && { ...memory, samples: undefined },
    downloads: downloadsOf(downloads),
  }
}

/** A file the build wrote, or the server's catalog. */
async function json<T>(name: string): Promise<T> {
  const response = await fetch(`/harness/data/${name}`)
  if (!response.ok) throw new Error(`${name}: ${response.status}`)
  return (await response.json()) as T
}

/** The run's pieces: the text pieces, or the shape pieces of the blocks asked for. */
function choose(pieces: BrowserPieces, { kind, blocks = 'shapes' }: RunOptions): BrowserPiece[] {
  if (kind === 'text') return pieces.text
  const photos = ['photo', 'cutout']
  return pieces.shape.filter((piece) => blocks === 'all' || photos.includes(piece.block) === (blocks === 'photos'))
}

/** A call to the measurement's server. */
async function call(path: string): Promise<unknown> {
  return (await fetch(`/harness/${path}`)).json()
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * The editor's matcher worker module run on the page thread: started from the modules compiled on the page, as a
 * worker is, then each piece matched in turn. The worker module keeps the matcher it started, so a page loaded
 * once runs one kind there.
 */
async function onPage(kind: RunOptions['kind'], fonts: MatchFonts) {
  if (pageMatcher && pageMatcher !== kind) throw new Error(`this page's thread runs the ${pageMatcher} matcher`)
  pageMatcher = kind
  const { matchMessage } = await import('../../../editor/src/matching/match-worker.ts')
  const canvasKit = await compileMatcherModule('canvasKit')
  heaps.know(canvasKit, 'canvasKit')
  let start: MatchMessage = { kind: 'matchStart', matcher: 'shape', canvasKit }
  if (kind === 'text') {
    const onnxRuntime = await compileMatcherModule('onnxRuntime')
    heaps.know(onnxRuntime, 'onnxRuntime')
    start = { kind: 'matchStart', matcher: 'text', canvasKit, onnxRuntime }
  }
  const replies: MatchReply[] = []
  await matchMessage(start, (reply) => replies.push(reply))
  if (replies[0]?.kind !== 'matchReady') throw new Error(`the matcher didn't start: ${JSON.stringify(replies[0])}`)
  /** The next piece's id. */
  let next = 0

  /** An ad's pieces, one after another. */
  async function match(ofAd: readonly BrowserPiece[]): Promise<Answered[]> {
    const answers: Answered[] = []
    for (const piece of ofAd) {
      const id = next++
      let answer: MatchAnswer | undefined
      const started = performance.now()
      const began: Steps = {}
      const message: MatchMessage = { kind: 'matchPiece', id, jobId: id, index: 0, job: { id, job: piece.job, fonts } }
      await matchMessage(message, (reply) => {
        if (reply.kind === 'matchStep') began[reply.step] = performance.now()
        if (reply.kind === 'matchAnswer') answer = reply.answer
        if (reply.kind === 'matchBroken') throw new Error(`${piece.id} broke the matcher: ${reply.message}`)
      })
      await matchMessage({ kind: 'matchForget', jobId: id }, () => undefined)
      if (!answer) throw new Error(`${piece.id} was not answered`)
      answers.push(answered(answer, started, began))
    }
    return answers
  }

  return { match, workers: (): SeenWorker[] => [], destroy: () => undefined }
}

/**
 * The editor's match client and pool, workers running the measurement's worker; held at `workers`, the pool's
 * device says one more core than that. A text pool held past what one pool's memory budget allows (4 text workers
 * past 1.5 GB) is that many workers in pools side by side, an ad's pieces dealt between them.
 */
function inPool({ kind, workers }: RunOptions, fonts: MatchFonts) {
  /** Every worker the pools started. */
  const seen: SeenWorker[] = []
  const real = thisBrowser()
  let perPool = workers ?? 0
  let pools = 1
  if (workers) {
    const most = poolLimit({ cores: workers + 1, memoryGb: real.memoryGb }, kind)
    pools = Math.ceil(workers / most)
    perPool = workers / pools
    if (!Number.isInteger(perPool)) throw new Error(`${workers} workers don't split into pools of at most ${most}`)
  }
  const device: Device = workers ? { cores: perPool + 1, memoryGb: real.memoryGb } : real
  const clients = Array.from({ length: pools }, () =>
    matchClient({
      makePool: () =>
        matchPool({
          start: () => startWorker(seen),
          device,
          compile: (module) => compileMatcherModule(module),
          page: documentShown(),
        }),
    }),
  )
  /** An ad's pieces, all at once, dealt between the pools. */
  function match(ofAd: readonly BrowserPiece[]): Promise<Answered[]> {
    return Promise.all(
      ofAd.map(async (piece, i) => {
        const sent = performance.now()
        const began: Steps = {}
        const client = clients[i % clients.length]
        if (!client) throw new Error('no pool')
        const step = (_: number, told: string) => (began[told] = performance.now())
        const [answer] = await client.match(piece.job, { fonts, step })
        if (!answer) throw new Error(`${piece.id} was not answered`)
        return answered(answer, sent, began)
      }),
    )
  }

  function destroy() {
    for (const client of clients) client.destroy()
  }

  return { match, workers: () => seen, destroy }
}

/** A worker of the measurement, watched: when it started, was ready and ended, its pieces, what it held and its heaps. */
function startWorker(seen: SeenWorker[]): MatchWorker {
  const worker = new Worker('/harness/worker.js', { type: 'module' })
  const watched: SeenWorker = { started: performance.now(), pieces: 0, held: 0, heaps: {} }
  seen.push(watched)
  worker.addEventListener('message', ({ data: reply }: MessageEvent<MeasuredReply>) => {
    if (reply.kind === 'matchReady') watched.ready = performance.now()
    if (reply.kind !== 'matchAnswer') return
    watched.pieces++
    watched.held = Math.max(watched.held, reply.memory)
    watched.heaps = peaks([watched.heaps, reply.heaps ?? {}])
  })
  const terminate = worker.terminate.bind(worker)
  worker.terminate = () => {
    watched.ended = performance.now()
    terminate()
  }
  return worker as unknown as MatchWorker
}

/** A piece's answer, timed from its first step (from `sent` when it told none), with its steps from the first. */
function answered(answer: MatchAnswer, sent: number, began: Steps): Answered {
  const first = Math.min(...Object.values(began), performance.now())
  const start = Object.keys(began).length ? first : sent
  const steps = Object.fromEntries(Object.entries(began).map(([step, at]) => [step, at - start]))
  return { answer, ms: performance.now() - start, steps }
}

/** How two answers differ: the largest gap between their numbers, and the first place they differ past 1e-9. */
function compare(a: unknown, b: unknown, at = ''): { diff: number; differs?: string } {
  if (typeof a === 'number' && typeof b === 'number') {
    const diff = Math.abs(a - b)
    return diff > TOLERANCE ? { diff, differs: `${at}: ${a} against Node's ${b}` } : { diff }
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null)
    return a === b
      ? { diff: 0 }
      : { diff: 0, differs: `${at}: ${JSON.stringify(a)} against Node's ${JSON.stringify(b)}` }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  let diff = 0
  for (const key of keys) {
    const inner = compare((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key], `${at}.${key}`)
    diff = Math.max(diff, inner.diff)
    if (inner.differs) return { diff, differs: inner.differs }
  }
  return { diff }
}

/** The middle value, the higher of the two middle ones for an even count, as the Node measurements take it. */
function middle(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? 0
}

/** How many decisions there are of each kind, by their first word. */
function tally(values: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const value of values) counts[value.split(' ')[0] ?? value] = (counts[value.split(' ')[0] ?? value] ?? 0) + 1
  return counts
}

/** An answer's decision: text or approximate text and its face, shapes and how many, or a picture and why. */
function decision(answer: MatchAnswer): string {
  if (answer.kind === 'picture') return `picture ${answer.why}`
  const [layer] = answer.layers
  if (layer?.type === 'text') {
    const { fontFamily, fontWeight, fontStyle } = layer.props.style
    return `${answer.approximate ? 'approximate' : 'text'} ${fontFamily}|${fontWeight}|${fontStyle}`
  }
  return `shapes ${answer.layers.length}`
}

/** Each heap's largest value over several readings. */
function peaks(readings: readonly Heaps[]): Heaps {
  const most: Heaps = {}
  for (const reading of readings)
    for (const [name, bytes] of Object.entries(reading) as [keyof Heaps, number][])
      most[name] = Math.max(most[name] ?? 0, bytes)
  return most
}

/** The named fields of an object. */
function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  return Object.fromEntries(keys.map((key) => [key, value[key]])) as Pick<T, K>
}

/**
 * What a run fetched: the files under the job's start and its first ad by kind, as stored and as sent, and their
 * sum without faces (the first open); and each ad's faces, each counted once in its ad.
 */
function downloadsOf(byMark: Downloads) {
  const [firstAd] = Object.keys(byMark).filter((mark) => mark.startsWith('ad:'))
  const fetched = [...(byMark['job-start'] ?? []), ...(firstAd ? (byMark[firstAd] ?? []) : [])]
  // A file each worker fetched counts once, as a browser keeping it would fetch it.
  const first = [...new Map(fetched.map((file) => [file.url, file])).values()]
  const kinds: Record<string, { files: number; bytes: number; sent: number }> = {}
  const firstOpen = { bytes: 0, sent: 0 }
  for (const file of first) {
    const kind = kindOfFile(file.url)
    const sum = (kinds[kind] ??= { files: 0, bytes: 0, sent: 0 })
    sum.files++
    sum.bytes += file.bytes
    sum.sent += file.sent
    if (kind === 'faces') continue
    firstOpen.bytes += file.bytes
    firstOpen.sent += file.sent
  }
  const fontsPerAd = Object.entries(byMark)
    .filter(([mark]) => mark.startsWith('ad:'))
    .map(([mark, files]) => {
      const faces = new Map(
        files.filter((file) => kindOfFile(file.url) === 'faces').map((file) => [file.url, file.bytes]),
      )
      return { mark, faces: faces.size, bytes: [...faces.values()].reduce((sum, bytes) => sum + bytes, 0) }
    })
  return { first: kinds, firstOpen, fontsPerAd }
}

/** What a file is, by its address: the worker's code, a WebAssembly, the text matcher's files, or faces. */
function kindOfFile(url: string): string {
  if (url.startsWith('/harness/')) return 'worker code'
  if (url.startsWith('/vendor/canvaskit')) return 'CanvasKit'
  if (url.startsWith('/vendor/onnxruntime/')) return 'ONNX Runtime'
  if (url.startsWith('/matchers/')) return 'matcher files'
  if (url.startsWith('/fonts/') || url.startsWith('/vendor/fonts/')) return 'faces'
  return url
}
