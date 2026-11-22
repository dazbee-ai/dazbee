// The app’s vendored files, each loaded once per page: CanvasKit, for the editor, the version viewer,
// the export worker and the matcher workers, and the fonts we ship.
import type { CanvasKit } from '@dazbee/canvaskit'
import canvasKitModule from '@dazbee/canvaskit'
import { WASM_FILE } from '@dazbee/canvaskit/wasm'
import { FONT_FACES } from '@dazbee/fonts'

// CommonJS whose types claim an ES default export; the bundler hands over the init function itself.
const CanvasKitInit = canvasKitModule as unknown as typeof import('@dazbee/canvaskit').default

/** CanvasKit and the fonts we ship, loading or loaded; a load that failed is tried again on the next ask. */
let canvasKit: Promise<CanvasKit> | undefined
let fonts: Promise<{ family: string; bytes: Uint8Array }[]> | undefined

/** Loads CanvasKit, its WebAssembly file from the app's `/vendor/`; the editor and the version viewer share it. */
export function loadCanvasKit(): Promise<CanvasKit> {
  canvasKit ??= CanvasKitInit({
    locateFile: (file: string) => `/vendor/${file === 'canvaskit.wasm' ? WASM_FILE : file}`,
  }).catch((error: unknown) => {
    canvasKit = undefined
    throw error
  })
  return canvasKit
}

/**
 * A CanvasKit of its own from WebAssembly compiled elsewhere and posted here, as a matcher worker
 * loads it: instantiated from the module, with nothing fetched or compiled again. CanvasKit's build
 * fetches the file it is pointed at, so it is pointed at an empty one.
 */
export async function canvasKitFrom(module: WebAssembly.Module): Promise<CanvasKit> {
  const empty = URL.createObjectURL(new Blob([]))
  try {
    return await instantiatingCompiled(module, () => CanvasKitInit({ locateFile: () => empty }))
  } finally {
    URL.revokeObjectURL(empty)
  }
}

/**
 * Runs `load`, during which every WebAssembly binary instantiated, from bytes or as it streams in,
 * instantiates `module` instead: for a library with no option to take a compiled module. Loads that
 * overlap must not be run through it at once.
 */
export async function instantiatingCompiled<T>(module: WebAssembly.Module, load: () => Promise<T>): Promise<T> {
  const { instantiate, instantiateStreaming } = WebAssembly
  const compiled = (imports?: WebAssembly.Imports) =>
    instantiate(module, imports).then((instance) => ({ instance, module }))
  WebAssembly.instantiate = ((source: BufferSource | WebAssembly.Module, imports?: WebAssembly.Imports) =>
    source instanceof WebAssembly.Module ? instantiate(source, imports) : compiled(imports)) as typeof instantiate
  WebAssembly.instantiateStreaming = ((_: Response | PromiseLike<Response>, imports?: WebAssembly.Imports) =>
    compiled(imports)) as typeof instantiateStreaming
  try {
    return await load()
  } finally {
    WebAssembly.instantiate = instantiate
    WebAssembly.instantiateStreaming = instantiateStreaming
  }
}

/** The fonts we ship, from the app's `/vendor/fonts/`. */
export function shippedFonts() {
  fonts ??= Promise.all(
    FONT_FACES.map(async (f) => ({ family: f.family, bytes: await fetchBytes(`/vendor/fonts/${f.file}`) })),
  ).catch((error: unknown) => {
    fonts = undefined
    throw error
  })
  return fonts
}

async function fetchBytes(url: string) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return new Uint8Array(await res.arrayBuffer())
}
