// The files the text matcher loads in the browser, kept in Cache Storage so a second open fetches
// none of them: the matchers' files at their permanent addresses (`/matchers/<sha256>.bin`), each
// kept only once its bytes hash to its name, and ONNX Runtime Web's WebAssembly, kept by version.
// CanvasKit's WebAssembly, which the editor loads anyway, is compiled from `/vendor/` as it is.
import { WASM_FILE } from '@dazbee/canvaskit/wasm'
import release from '@dazbee/matchers/release' with { type: 'json' }
import { matcherFilePath } from '@dazbee/schema'

/** A file the matcher keeps: its address, and the SHA-256 its bytes must hash to, when it has one. */
export interface MatcherFile {
  url: string
  sha256?: string
}

/** The browser's Cache Storage and fetch, or stand-ins in a test; no Cache Storage where the browser has none. */
export interface FileDeps {
  caches?: Pick<CacheStorage, 'open'> | undefined
  fetch: (url: string) => Promise<Response>
}

/** The text matcher's files by their names in the release. */
export type TextMatcherFileName = keyof typeof release.files

/** The ONNX Runtime Web the editor depends on, whose files `apps/web/scripts/copy-vendor.ts` copies. */
export const ONNX_RUNTIME_VERSION = '1.31.1'

/** ONNX Runtime Web's WebAssembly-only build, at an address that names its version. */
export const ONNX_RUNTIME_WASM: MatcherFile = {
  url: `/vendor/onnxruntime/${ONNX_RUNTIME_VERSION}/ort-wasm-simd-threaded.wasm`,
}

/** The Cache Storage cache the matcher's files are kept in. */
export const MATCHER_CACHE = 'dazbee-matchers'

/** The release's file of this name at its permanent address. */
export function textMatcherFile(name: TextMatcherFileName): MatcherFile {
  const { sha256 } = release.files[name]
  return { url: matcherFilePath(sha256), sha256 }
}

/** Every file kept in the cache now: a kept file not among them is from an older release or runtime. */
export function currentFiles(): MatcherFile[] {
  return [...Object.keys(release.files).map((name) => textMatcherFile(name as TextMatcherFileName)), ONNX_RUNTIME_WASM]
}

/**
 * The file's bytes: the kept copy, else fetched and, when they are the file (its SHA-256, when it
 * has one), kept. It throws when the fetch fails or gives other bytes, which are not kept.
 */
export async function fileBytes(file: MatcherFile, deps: FileDeps = browserFiles()): Promise<Uint8Array> {
  return new Uint8Array(await (await keptFile(file, deps)).arrayBuffer())
}

/** The file as `fileBytes` gives it, as a response: the kept copy is read as it streams from the disk. */
export async function keptFile(file: MatcherFile, deps: FileDeps = browserFiles()): Promise<Response> {
  const cache = await openCache(deps)
  const kept = await cache?.match(file.url)
  if (kept) return kept
  const response = await deps.fetch(file.url)
  if (!response.ok) throw new Error(`${file.url}: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (file.sha256 && (await sha256Of(bytes)) !== file.sha256)
    throw new Error(`${file.url} is not the file its address names`)
  const headers = { 'content-type': contentType(file.url) }
  await cache
    ?.put(file.url, new Response(bytes, { headers }))
    // A full disk or a refusing browser keeps nothing; the file is fetched again next time.
    .catch(() => undefined)
  return new Response(bytes, { headers })
}

/** Deletes the kept files no longer among `currentFiles()`, so an older release's files leave the disk. */
export async function forgetOldFiles(deps: FileDeps = browserFiles()): Promise<void> {
  const cache = await openCache(deps)
  if (!cache) return
  const current = new Set(currentFiles().map((file) => file.url))
  for (const request of await cache.keys()) if (!current.has(new URL(request.url).pathname)) await cache.delete(request)
}

/**
 * CanvasKit's and ONNX Runtime's WebAssembly compiled on the page, once for every matcher worker:
 * a compiled module posted to a worker shares its machine code there instead of compiling again.
 */
export async function compileMatcherModules(
  deps: FileDeps = browserFiles(),
): Promise<{ canvasKit: WebAssembly.Module; onnxRuntime: WebAssembly.Module }> {
  const [canvasKit, onnxRuntime] = await Promise.all([
    deps.fetch(`/vendor/${WASM_FILE}`).then(compileResponse),
    keptFile(ONNX_RUNTIME_WASM, deps).then(compileResponse),
  ])
  void forgetOldFiles(deps).catch(() => undefined)
  return { canvasKit, onnxRuntime }
}

/** This browser's Cache Storage, where it has one, and its fetch. */
export function browserFiles(): FileDeps {
  return { caches: globalThis.caches, fetch: (url) => fetch(url) }
}

/** The matcher's cache; none where the browser has no Cache Storage or refuses it, as a private window may. */
async function openCache(deps: FileDeps): Promise<Pick<Cache, 'match' | 'put' | 'keys' | 'delete'> | undefined> {
  return deps.caches?.open(MATCHER_CACHE).catch(() => undefined)
}

/** The bytes' SHA-256 as hex. */
async function sha256Of(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** What a kept file is served as. */
function contentType(url: string): string {
  return url.endsWith('.wasm') ? 'application/wasm' : 'application/octet-stream'
}

/** A WebAssembly file compiled as it streams in when served as WebAssembly, else from its bytes. */
async function compileResponse(response: Response): Promise<WebAssembly.Module> {
  if (!response.ok) throw new Error(`${response.url || 'a WebAssembly file'}: ${response.status}`)
  if (response.headers.get('content-type')?.startsWith('application/wasm'))
    return WebAssembly.compileStreaming(response)
  return WebAssembly.compile(await response.arrayBuffer())
}
