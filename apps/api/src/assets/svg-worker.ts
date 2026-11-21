// Reads SVG files of the asset library, or draws their thumbnails, on a thread of their own that
// svg-assets.ts starts, sends one file at a time, and ends past a file's time or once the thread
// has grown. The bytes are never decoded as an image: they are read as layers by @dazbee/svg, which
// refuses what it can't read or what passes its limits, and the thumbnail is those layers drawn by
// the renderer, as the editor will draw them once placed. Only the pictures a file embeds are
// decoded, by CanvasKit, to leave out any that can't be drawn. CanvasKit's memory may grow only to
// the thread's limit, so a file whose drawing would need more is refused rather than taking the
// API's memory.
import { parentPort, workerData } from 'node:worker_threads'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { renderDesign } from '@dazbee/renderer'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { SvgError, svgToLayers } from '@dazbee/svg'

/** What the thread is started with: the bytes CanvasKit's memory may grow to. */
export interface SvgThreadData {
  svgMemoryLimit: number
}

/** One file to read and draw: its markup, the longer side of its thumbnail, and the id its answer carries back. */
export interface SvgJob {
  id: number
  text: string
  size: number
}

/**
 * What the thread made of the file: its own size and its thumbnail; that it can't be read as layers;
 * the limit it passes, as the end of a sentence; that drawing it needs more memory than the thread
 * may take; or why it failed otherwise.
 */
export type SvgAnswer =
  | { width: number; height: number; png: Uint8Array }
  | { unreadable: string }
  | { tooBig: string }
  | { tooMuchMemory: true }
  | { error: string }

/** An answer as the thread posts it: with its job's id, and the bytes CanvasKit's memory takes after it. */
export type SvgReply = SvgAnswer & { id: number; memory: number }
/** What the thread posts once CanvasKit and the fonts are loaded, before any job's time starts. */
export interface SvgReady {
  ready: true
}

/** A wasm memory, as far as capMemory reads and changes it: the API's types leave WebAssembly out. */
interface WasmMemory {
  readonly buffer: ArrayBuffer
  grow(pages: number): number
}

/** The bytes of one page of wasm memory. */
const WASM_PAGE = 65_536

/** What the thread was started with, when it was started as the SVG thread. */
const started = workerData as Partial<SvgThreadData> | null

/** Whether CanvasKit asked for more memory than its limit: what it drew can't be trusted, nor the thread after. */
let overLimit = false

if (parentPort && started?.svgMemoryLimit) {
  const port = parentPort
  capMemory(started.svgMemoryLimit)
  await loadCanvasKit()
  loadFontFiles()
  port.postMessage({ ready: true } satisfies SvgReady)
  port.on('message', (job: SvgJob) => {
    void answer(job).then(async (done) => {
      const reply: SvgReply = { ...done, id: job.id, memory: await memory() }
      port.postMessage(reply, 'png' in done && done.png.buffer instanceof ArrayBuffer ? [done.png.buffer] : [])
    })
  })
}

/**
 * Makes every wasm memory of this thread, CanvasKit's, refuse to grow past `limit` bytes. Emscripten
 * grows it from JavaScript and takes a refusal as its allocation failing.
 */
function capMemory(limit: number) {
  const memory = (globalThis as unknown as { WebAssembly: { Memory: { prototype: WasmMemory } } }).WebAssembly.Memory
  const grow = memory.prototype.grow
  memory.prototype.grow = function (this: WasmMemory, pages: number) {
    if (this.buffer.byteLength + pages * WASM_PAGE > limit) {
      overLimit = true
      throw new RangeError(`CanvasKit's memory may not grow past ${limit} bytes`)
    }
    return grow.call(this, pages)
  }
}

/** The job done, or why it wasn't. */
async function answer(job: SvgJob): Promise<SvgAnswer> {
  try {
    const done = await readAndDraw(job.text, job.size)
    return overLimit ? { tooMuchMemory: true } : done
  } catch (error) {
    if (overLimit) return { tooMuchMemory: true }
    if (error instanceof SvgError)
      return error.problem === 'too-big' ? { tooBig: error.detail ?? error.message } : { unreadable: error.message }
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

/** How many bytes CanvasKit's memory takes: it grows as a file needs, and never gives memory back. */
async function memory(): Promise<number> {
  // Emscripten's view of the module's memory, which CanvasKit's types leave out.
  const ck = (await loadCanvasKit()) as unknown as { HEAPU8: Uint8Array }
  return ck.HEAPU8.length
}

/** The file's own size, and its layers drawn in a see-through frame, `size` pixels on the longer side, as a PNG. */
async function readAndDraw(text: string, size: number): Promise<{ width: number; height: number; png: Uint8Array }> {
  const ck = await loadCanvasKit()
  const read = svgToLayers(ck, text, { fit: size })
  // Only the pictures CanvasKit decodes are drawn: one with a good header and a broken body is left out.
  const images = Object.fromEntries(
    read.images.filter((image) => decodes(ck, image.bytes)).map((i) => [i.key, i.bytes]),
  )
  const kept = Object.keys(images).length === read.images.length ? read : withoutBroken(ck, text, size, images)
  const { width, height } = read
  const nodes = kept
    ? Object.fromEntries(
        Object.entries(kept.tree.nodes).map(([id, node]) => [
          id,
          id === kept.root ? { ...node, parentId: 'f', index: 'a0' } : node,
        ]),
      )
    : {}
  const design = {
    meta: { designId: 'thumbnail', name: 'Thumbnail' },
    pages: { page: { name: 'Page', order: 'a0' } },
    frames: {
      f: {
        pageId: 'page',
        name: 'Thumbnail',
        width: Math.max(1, Math.round(width)),
        height: Math.max(1, Math.round(height)),
        x: 0,
        y: 0,
        order: 'a0',
      },
    },
    nodes,
  }
  const { png } = renderDesign(ck, design, 'f', {
    fonts: loadFontFiles(),
    fallbackFamilies: [...FALLBACK_FAMILIES],
    images,
  })
  return { width: width / read.scale, height: height / read.scale, png }
}

/**
 * The file's layers without the pictures CanvasKit can't decode; null when nothing else is in it,
 * which draws a clear thumbnail: such a picture never makes the file refused.
 */
function withoutBroken(
  ck: Awaited<ReturnType<typeof loadCanvasKit>>,
  text: string,
  size: number,
  images: Record<string, Uint8Array>,
) {
  try {
    return svgToLayers(ck, text, { fit: size, assetIds: Object.fromEntries(Object.keys(images).map((k) => [k, k])) })
  } catch (error) {
    if (error instanceof SvgError && error.problem === 'empty') return null
    throw error
  }
}

/**
 * Whether CanvasKit makes an image of the picture, as the renderer will need to: it makes none of a
 * good header over a stream it can't inflate. A stream that ends early still makes one, its missing
 * rows clear, as browsers draw it.
 */
function decodes(ck: Awaited<ReturnType<typeof loadCanvasKit>>, bytes: Uint8Array) {
  const image = ck.MakeImageFromEncoded(bytes)
  image?.delete()
  return image !== null
}
