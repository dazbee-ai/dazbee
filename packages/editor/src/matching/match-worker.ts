// A matcher worker's jobs. Started as a text worker, it starts CanvasKit and ONNX Runtime Web from
// the modules the pool compiled and posted, ONNX Runtime on WebAssembly only, on one thread
// (ADR-0020), and opens the text matcher's model and files, kept in Cache Storage. It then runs
// `matchText` on one piece at a time, drawing on the CPU surface (ADR-0005), with each piece's
// shortlisted faces fetched at once: a Google face's match copy, or its whole face for characters ads
// rarely use, a brand's upload through the brand, and a shipped Noto face from the app's files.
// Started as a shape worker, it starts CanvasKit
// alone, loads no model, file or face, and runs `matchShapes` on one piece at a time. It runs in the
// editor's worker (`editor-worker`), loaded with the first match message. Each answer tells what the
// worker holds, so the pool can retire it.
import type { CanvasKit } from '@dazbee/canvaskit'
import { FONT_FACES } from '@dazbee/fonts'
import {
  faceOfKey,
  fontKey,
  type FontSource,
  matchShapes,
  matchText,
  MODEL_INPUT,
  MODEL_OUTPUT,
  type ModelRuntime,
  parseFontKey,
  readTextFiles,
  TEXT_FILES,
  type TextFileBytes,
  type TextFiles,
  type TextPieceOfJob,
  WINDOW_HEIGHT,
  WINDOW_WIDTH,
} from '@dazbee/matchers'
import { type FontFace, googleFacePaths, type MatchAnswer, type Piece } from '@dazbee/schema'

import { canvasKitFrom, instantiatingCompiled, shippedFontUrl } from '../vendor.ts'
import type { CompiledModules, MatchFonts, MatchMessage, MatchReply, MatchStep, WorkerJob } from './match-pool.ts'
import { fileBytes, textMatcherFile } from './matcher-files.ts'

/** What a started worker holds: a text worker CanvasKit, the matcher's files and its model; a shape worker CanvasKit. */
type Started =
  | {
      matcher: 'text'
      ck: CanvasKit
      files: TextFiles
      model: ModelRuntime
      /** The families the files hold fingerprints of. */
      fingerprinted: ReadonlySet<string>
    }
  | { matcher: 'shape'; ck: CanvasKit }

/** The posted message that starts a worker. */
type StartMessage = Extract<MatchMessage, { kind: 'matchStart' }>

let started: Promise<Started> | undefined
/** The jobs this worker was sent and not yet told to forget, by id. */
const jobs = new Map<number, WorkerJob>()
/** CanvasKit's WebAssembly memory, and ONNX Runtime's in a text worker, once they are instantiated. */
const memories = new Set<WebAssembly.Memory>()
/** The bytes of the faces this worker has read. */
let facesRead = 0

/** Answers a match message: starts the worker, matches a piece, or forgets a job. */
export async function matchMessage(message: MatchMessage, answer: (reply: MatchReply) => void): Promise<void> {
  if (message.kind === 'matchForget') {
    jobs.delete(message.jobId)
    return
  }
  if (message.kind === 'matchStart') {
    try {
      await (started ??= start(message))
      answer({ kind: 'matchReady' })
    } catch (error) {
      answer({ kind: 'matchStartFailed', message: messageOf(error) })
    }
    return
  }
  if (message.job) jobs.set(message.jobId, message.job)
  const sent = jobs.get(message.jobId)
  const piece = sent?.job.pieces[message.index]
  const { id } = message
  try {
    const worker = await started
    if (!worker || !sent || piece?.kind !== worker.matcher) {
      answer({ kind: 'matchAnswer', id, answer: { kind: 'picture', why: 'failed' }, memory: held() })
      return
    }
    const matched = await matchPiece(worker, sent, piece, (step) => answer({ kind: 'matchStep', id, step }))
    answer({ kind: 'matchAnswer', id, answer: matched, memory: held() })
  } catch (error) {
    // CanvasKit or ONNX Runtime out of memory, or aborted: its WebAssembly can't be trusted again.
    if (error instanceof RangeError || error instanceof WebAssembly.RuntimeError)
      answer({ kind: 'matchBroken', id, message: messageOf(error) })
    else answer({ kind: 'matchAnswer', id, answer: { kind: 'picture', why: 'failed' }, memory: held() })
  }
}

/** The piece matched by the worker's matcher, telling each step as it starts. */
async function matchPiece(
  worker: Started,
  sent: WorkerJob,
  piece: Piece,
  step: (step: MatchStep) => void,
): Promise<MatchAnswer> {
  if (worker.matcher === 'shape') return matchShapes(worker.ck, sent.job, piece, step)
  const { ck, files, model, fingerprinted } = worker
  return matchText(sent.job, piece as TextPieceOfJob, {
    ck,
    files,
    model,
    fonts: fontSource(sent.fonts),
    kitFaces: kitFaces(sent, fingerprinted),
    step,
  })
}

/**
 * A shape worker: CanvasKit from its posted module. A text worker: CanvasKit and ONNX Runtime from the
 * posted modules, one after the other since each is instantiated from its module while it loads, and
 * the matcher's files and model, read from Cache Storage.
 */
async function start(message: StartMessage): Promise<Started> {
  if (message.matcher === 'shape')
    return { matcher: 'shape', ck: await keepingMemories(() => canvasKitFrom(message.canvasKit)) }
  const modules: CompiledModules = message
  const files = Promise.all(
    TEXT_FILES.map(async (name) => [name, await fileBytes(textMatcherFile(name))] as const),
  ).then((read) => readTextFiles(Object.fromEntries(read) as TextFileBytes))
  const instantiated = keepingMemories(() => {
    const loaded = canvasKitFrom(modules.canvasKit)
    const opened = Promise.all([loaded, fileBytes(textMatcherFile('text-model.onnx'))]).then(([, bytes]) =>
      openModel(bytes, modules.onnxRuntime),
    )
    return Promise.all([loaded, opened])
  })
  const [[ck, model], read] = await Promise.all([instantiated, files])
  return { matcher: 'text', ck, files: read, model, fingerprinted: new Set(read.faces.map((face) => face.family)) }
}

/**
 * Runs `load`, keeping in `memories` each WebAssembly memory a module it instantiates is given or
 * makes: ONNX Runtime is given its memory, CanvasKit makes its own.
 */
async function keepingMemories<T>(load: () => Promise<T>): Promise<T> {
  const { instantiate } = WebAssembly
  WebAssembly.instantiate = (async (source: BufferSource | WebAssembly.Module, imports?: WebAssembly.Imports) => {
    const made = await instantiate(source as BufferSource, imports)
    // Given a compiled module it answers an instance; given bytes, the module and its instance.
    const instance: WebAssembly.Instance = made instanceof WebAssembly.Instance ? made : made.instance
    const given = Object.values(imports ?? {}).flatMap((module) => Object.values(module))
    for (const value of [...given, ...Object.values(instance.exports)])
      if (value instanceof WebAssembly.Memory) memories.add(value)
    return made
  }) as typeof instantiate
  try {
    return await load()
  } finally {
    WebAssembly.instantiate = instantiate
  }
}

/**
 * The model opened in ONNX Runtime Web, on WebAssembly only and one thread, with onnxruntime-node's
 * settings, so it gives Node's numbers. ONNX Runtime's code is loaded only here, so a shape worker
 * never loads it. ONNX Runtime fetches no WebAssembly when given its binary, so it is given an empty
 * one, and the posted module is instantiated in its place.
 */
async function openModel(model: Uint8Array, compiled: WebAssembly.Module): Promise<ModelRuntime> {
  const ort = await import('onnxruntime-web/wasm')
  ort.env.wasm.numThreads = 1
  ort.env.wasm.proxy = false
  ort.env.wasm.wasmBinary = new Uint8Array(0)
  const session = await instantiatingCompiled(compiled, () =>
    ort.InferenceSession.create(model, {
      executionProviders: ['wasm'],
      intraOpNumThreads: 1,
      interOpNumThreads: 1,
      executionMode: 'sequential',
      graphOptimizationLevel: 'all',
    }),
  )
  return {
    async run(windows, count) {
      const input = new ort.Tensor('float32', windows, [count, 1, WINDOW_HEIGHT, WINDOW_WIDTH])
      const output = (await session.run({ [MODEL_INPUT]: input }))[MODEL_OUTPUT]
      if (!output) throw new Error(`the model gave no ${MODEL_OUTPUT}`)
      return output.data as Float32Array
    },
  }
}

/**
 * The bytes this worker holds that grow as it matches: its WebAssembly memories, which grow as a
 * piece needs and never give memory back, and the faces it has read, which it holds until they are
 * collected.
 */
function held(): number {
  let bytes = facesRead
  for (const memory of memories) bytes += memory.buffer.byteLength
  return bytes
}

/**
 * A job's faces by key: a shipped face from the app's files, and those found in its font catalog, a
 * Google face's match copy, or its whole face, from its permanent address, and a brand's upload
 * through the brand; null for a key no shipped face or face of the catalog draws, or a file that
 * doesn't come.
 */
function fontSource({ catalog, uploadPath }: MatchFonts): FontSource {
  const families = new Map(catalog.map((family) => [family.family, family.faces]))
  return {
    async face(key, copy) {
      const parsed = parseFontKey(key)
      const shipped = FONT_FACES.find((face) => fontKey(face) === key)
      const found = parsed && !shipped && faceOfKey(parsed, families.get(parsed.family) ?? [])
      const url = shipped ? shippedFontUrl(shipped.file) : found && faceUrl(found.face, copy, uploadPath)
      if (!url) return null
      const response = await fetch(url)
      if (!response.ok) return null
      const bytes = new Uint8Array(await response.arrayBuffer())
      facesRead += bytes.byteLength
      return bytes
    },
  }
}

/** Where a face's file is read: a Google face's at its permanent address, an upload's through the brand. */
function faceUrl(face: FontFace, copy: boolean, uploadPath: string): string | null {
  const paths = googleFacePaths(face)
  if (paths) return copy ? paths.match : paths.file
  return face.source === 'upload' ? `${uploadPath}${encodeURIComponent(face.id)}` : null
}

/** The faces of the job's kit families the files hold no fingerprint of, as its catalog lists them. */
function kitFaces({ job, fonts }: WorkerJob, fingerprinted: ReadonlySet<string>): FontFace[] {
  const families = new Set(Object.values(job.kit.fonts).filter((family) => !fingerprinted.has(family)))
  return fonts.catalog.filter((family) => families.has(family.family)).flatMap((family) => family.faces)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
