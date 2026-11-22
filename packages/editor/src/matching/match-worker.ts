// A matcher worker's jobs: it starts CanvasKit and ONNX Runtime Web from the modules the pool
// compiled and posted, ONNX Runtime on WebAssembly only, on one thread (ADR-0020), and opens the
// text matcher's model and files, kept in Cache Storage. It then runs `matchText` on one piece at a
// time, drawing on the CPU surface (ADR-0005), with each piece's shortlisted faces fetched at once:
// a Google face's match copy, or its whole face for characters ads rarely use, and a brand's
// upload through the brand. It runs in the editor's worker (`editor-worker`), loaded with the
// first match message.
import * as ort from 'onnxruntime-web/wasm'

import type { CanvasKit } from '@dazbee/canvaskit'
import {
  faceOfKey,
  type FontSource,
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
import { type FontFace, googleFacePaths, type MatchAnswer } from '@dazbee/schema'

import { canvasKitFrom, instantiatingCompiled } from '../vendor.ts'
import type { CompiledModules, MatchFonts, MatchMessage, MatchReply, WorkerJob } from './match-pool.ts'
import { fileBytes, textMatcherFile } from './matcher-files.ts'

/** What a started worker holds: CanvasKit, the matcher's files and its model. */
interface Started {
  ck: CanvasKit
  files: TextFiles
  model: ModelRuntime
  /** The families the files hold fingerprints of. */
  fingerprinted: ReadonlySet<string>
}

let started: Promise<Started> | undefined
/** The jobs this worker was sent and not yet told to forget, by id. */
const jobs = new Map<number, WorkerJob>()

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
  if (!started || !sent || piece?.kind !== 'text') {
    answer({ kind: 'matchAnswer', id: message.id, answer: { kind: 'picture', why: 'failed' }, heap: 0 })
    return
  }
  const { id } = message
  try {
    const { ck, files, model, fingerprinted } = await started
    const matched: MatchAnswer = await matchText(sent.job, piece as TextPieceOfJob, {
      ck,
      files,
      model,
      fonts: fontSource(sent.fonts),
      kitFaces: kitFaces(sent, fingerprinted),
      step: (step) => answer({ kind: 'matchStep', id, step }),
    })
    answer({ kind: 'matchAnswer', id, answer: matched, heap: heapBytes(ck) })
  } catch (error) {
    // CanvasKit or ONNX Runtime out of memory, or aborted: its WebAssembly can't be trusted again.
    if (error instanceof RangeError || error instanceof WebAssembly.RuntimeError)
      answer({ kind: 'matchBroken', id, message: messageOf(error) })
    else answer({ kind: 'matchAnswer', id, answer: { kind: 'picture', why: 'failed' }, heap: 0 })
  }
}

/**
 * CanvasKit and ONNX Runtime from the posted modules, one after the other since each is instantiated
 * from its module while it loads, and the matcher's files and model, read from Cache Storage.
 */
async function start(modules: CompiledModules): Promise<Started> {
  const files = Promise.all(
    TEXT_FILES.map(async (name) => [name, await fileBytes(textMatcherFile(name))] as const),
  ).then((read) => readTextFiles(Object.fromEntries(read) as TextFileBytes))
  const loaded = canvasKitFrom(modules.canvasKit)
  const opened = Promise.all([loaded, fileBytes(textMatcherFile('text-model.onnx'))]).then(([, bytes]) =>
    openModel(bytes, modules.onnxRuntime),
  )
  const [ck, read, model] = await Promise.all([loaded, files, opened])
  return { ck, files: read, model, fingerprinted: new Set(read.faces.map((face) => face.family)) }
}

/**
 * The model opened in ONNX Runtime Web, on WebAssembly only and one thread, with onnxruntime-node's
 * settings, so it gives Node's numbers. ONNX Runtime fetches no WebAssembly when given its binary, so
 * it is given an empty one, and the posted module is instantiated in its place.
 */
async function openModel(model: Uint8Array, compiled: WebAssembly.Module): Promise<ModelRuntime> {
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
 * A job's faces by key, found in its font catalog: a Google face's match copy, or its whole face,
 * from its permanent address, and a brand's upload through the brand; null for a key the catalog has
 * no face for, or a file that doesn't come.
 */
function fontSource({ catalog, uploadPath }: MatchFonts): FontSource {
  const families = new Map(catalog.map((family) => [family.family, family.faces]))
  return {
    async face(key, copy) {
      const parsed = parseFontKey(key)
      const found = parsed && faceOfKey(parsed, families.get(parsed.family) ?? [])
      const url = found && faceUrl(found.face, copy, uploadPath)
      if (!url) return null
      const response = await fetch(url)
      return response.ok ? new Uint8Array(await response.arrayBuffer()) : null
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

/** The bytes CanvasKit's memory takes: it grows as a piece needs and never gives memory back. */
function heapBytes(ck: CanvasKit): number {
  // Emscripten's view of the module's memory, which CanvasKit's types leave out.
  return (ck as unknown as { HEAPU8: Uint8Array }).HEAPU8.buffer.byteLength
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
