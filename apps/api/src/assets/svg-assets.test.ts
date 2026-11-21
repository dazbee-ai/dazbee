import { BroadcastChannel } from 'node:worker_threads'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import { readImageHeader } from '@dazbee/schema'
import { svgToLayers } from '@dazbee/svg'
import { hugePath, NESTED_BLURS } from '@dazbee/svg/test-hostile-files'

import { inDrawingTurn } from '../drawing/drawing-turn.ts'
import { bigPictureSvg, png, slowPathsSvg } from '../test-files.ts'
import {
  readSvgAsset,
  startSvgThread,
  SVG_START_LIMIT_MS,
  SvgBusy,
  type SvgReader,
  svgReader,
  type SvgReaderSettings,
  SvgRefused,
  svgThumbnail,
} from './svg-assets.ts'
import { HELD_SVG_THREAD } from './test-held-svg-thread.ts'

const ck = await loadCanvasKit()

/** A real PNG of one colour, `side` pixels square. */
function solid(side: number, colour: [number, number, number]): Uint8Array {
  const surface = ck.MakeSurface(side, side)
  if (!surface) throw new Error('no surface')
  surface.getCanvas().clear(ck.Color(...colour, 1))
  const snapshot = surface.makeImageSnapshot()
  const bytes = snapshot.encodeToBytes()
  snapshot.delete()
  surface.delete()
  if (!bytes) throw new Error('could not encode')
  return bytes
}

/** A PNG whose header is good and whose pixels can't be decoded. */
function garbled(): Uint8Array {
  const bytes = png(8, 8, 'garbled')
  bytes.fill(0x55, 33)
  return bytes
}

const encoded = (text: string) => new TextEncoder().encode(text)
const SQUARE = encoded(
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="9" height="9"/></svg>',
)
const dataUrl = (bytes: Uint8Array) => `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`

/** The thumbnail's pixel at (x, y), as RGBA. */
async function pixelAt(svg: string, x: number, y: number) {
  const image = ck.MakeImageFromEncoded(await svgThumbnail(new TextEncoder().encode(svg), 100))
  if (!image) throw new Error('the thumbnail does not decode')
  const pixels = image.readPixels(x, y, {
    width: 1,
    height: 1,
    colorType: ck.ColorType.RGBA_8888,
    alphaType: ck.AlphaType.Unpremul,
    colorSpace: ck.ColorSpace.SRGB,
  })
  image.delete()
  return [...(pixels ?? [])]
}

/** The API's memory, in MB. */
const rss = () => process.memoryUsage().rss / 2 ** 20

/**
 * How long `run` takes, in milliseconds, the longest the API's own thread went without running a
 * timer meanwhile, and what it threw.
 */
async function timed(run: () => Promise<unknown>) {
  let refused: unknown
  let last = performance.now()
  let longestGap = 0
  const ticks = setInterval(() => {
    const now = performance.now()
    longestGap = Math.max(longestGap, now - last)
    last = now
  }, 5)
  const started = performance.now()
  try {
    await run()
  } catch (error) {
    refused = error
  } finally {
    clearInterval(ticks)
  }
  return { ms: performance.now() - started, longestGap: Math.max(longestGap, performance.now() - last), refused }
}

/** The reader a test made, ended after it. */
let made: SvgReader | undefined
/** The channel to the test's held threads, closed after it. */
let channel: BroadcastChannel | undefined

/**
 * A reader whose threads start held, until `go`; it is ended after the test. Unless told otherwise, a
 * file waits for a start as long as the start may take, so a busy machine can't make it busy.
 */
function heldReader(settings: Partial<SvgReaderSettings> = {}) {
  made = svgReader({
    threadFile: new URL('./test-held-svg-thread.ts', import.meta.url),
    waitLimitMs: SVG_START_LIMIT_MS,
    ...settings,
  })
  return made
}

/**
 * The held threads as the test sees them: how many have said `starting` and `ready`, a wait until
 * so many have said one, and `go`, which lets every thread that is held start. With `release`,
 * each thread is let go as soon as it says it is starting.
 */
function heldThreads(release = false) {
  const said = { starting: 0, ready: 0 }
  const waits: (() => void)[] = []
  channel = new BroadcastChannel(HELD_SVG_THREAD)
  const go = () => channel?.postMessage('go')
  channel.onmessage = (event) => {
    const word = (event as MessageEvent).data as keyof typeof said
    said[word]++
    if (release && word === 'starting') go()
    for (const wake of waits.splice(0)) wake()
  }
  /** Resolves once `count` threads have said `word`. */
  const until = async (word: keyof typeof said, count: number) => {
    while (said[word] < count) await new Promise<void>((wake) => waits.push(wake))
  }
  return { said, until, go }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await made?.end()
  made = undefined
  channel?.close()
  channel = undefined
})

describe('readSvgAsset', () => {
  it('reads an SVG file at its own size with its thumbnail, and nothing of a file that is not one', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120.5" height="80"><rect width="9" height="9"/></svg>'
    const read = await readSvgAsset(encoded(svg), 320)
    expect(read?.header).toEqual({ contentType: 'image/svg+xml', width: 121, height: 80 })
    expect(readImageHeader(read?.png ?? new Uint8Array())).toMatchObject({ width: 320, height: 212 })
    expect(await readSvgAsset(encoded('<html><body/></html>'), 320)).toBeNull()
    expect(await readSvgAsset(encoded('<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>'), 320)).toBeNull()
  })

  it('refuses 50 nested blurs and one path of 630,000 points as it reads them, saying which limit each passes, the API not growing', async () => {
    // The thread started, as it is once it has read a file.
    await readSvgAsset(SQUARE, 320)
    // The files are made before the API's memory is read, so what making them took is not counted.
    const files = [
      [encoded(NESTED_BLURS), 'its blurs and shadows nest more than 4 deep'],
      [encoded(hugePath()), 'one of its paths has more than 250,000 points'],
    ] as const
    const before = rss()
    for (const [bytes, limit] of files) {
      const { refused } = await timed(() => readSvgAsset(bytes, 320))
      expect(refused).toBeInstanceOf(SvgRefused)
      // The thread reads a file before it draws it, so the reader's sentence means nothing was drawn.
      expect((refused as Error).message).toBe(`This SVG file is too complex to draw: ${limit}`)
    }
    expect(rss() - before).toBeLessThan(100)
  })

  it('refuses a file whose drawing needs more memory than its thread may take, its memory given back', async () => {
    const before = rss()
    const bytes = encoded(bigPictureSvg())
    const { refused } = await timed(() => readSvgAsset(bytes, 320))
    expect(refused).toBeInstanceOf(SvgRefused)
    // Only the thread's memory has a ceiling, so the sentence means the thread drew it, not the API.
    expect((refused as Error).message).toBe('This SVG file needs too much memory to draw')
    expect(rss() - before).toBeLessThan(100)
    // A new thread draws the next file.
    expect((await readSvgAsset(SQUARE, 320))?.header.width).toBe(10)
  })

  it('ends a drawing at its time limit and refuses the file, the API answering meanwhile', async () => {
    await readSvgAsset(SQUARE, 320)
    const text = slowPathsSvg()
    const bytes = encoded(text)
    const { ms, longestGap, refused } = await timed(() => readSvgAsset(bytes, 320, 500))
    expect(refused).toBeInstanceOf(SvgRefused)
    expect((refused as Error).message).toBe('This SVG file took more than 0.5 seconds to draw')
    // Reading the file here is the yardstick, timed on this machine: the thread reads the file and
    // then draws it for several times as long, so a refusal that waited for the drawing would come
    // more than one reading past the limit, and an API that read or drew it would pause for a reading.
    const started = performance.now()
    svgToLayers(ck, text, { fit: 320 })
    const reading = performance.now() - started
    expect(ms - 500).toBeLessThan(reading)
    expect(longestGap).toBeLessThan(reading / 2)
  })

  it('refuses a file while four are being read or wait to be, keeping it to be added again', async () => {
    // The drawing turn is held, so the four files wait in it until it is let go.
    let release = () => {}
    const held = new Promise<void>((resolve) => (release = resolve))
    void inDrawingTurn(() => held)
    const waiting = Array.from({ length: 4 }, (_, i) =>
      readSvgAsset(encoded(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/><!-- ${i} -->`), 32).catch(
        () => null,
      ),
    )
    await expect(readSvgAsset(SQUARE, 320)).rejects.toThrow(
      new SvgBusy('Dazbee is reading other SVG files; add this one again in a minute'),
    )
    release()
    await Promise.all(waiting)
    expect((await readSvgAsset(SQUARE, 320))?.header.width).toBe(10)
  })
})

describe('svgThumbnail', () => {
  it('draws the pictures the file embeds', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><image href="${dataUrl(solid(10, [32, 160, 96]))}" width="50" height="50"/></svg>`
    expect(await pixelAt(svg, 50, 50)).toEqual([32, 160, 96, 255])
  })

  it('draws a clear thumbnail of a file whose only picture can’t be decoded, rather than refusing it', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><image href="${dataUrl(garbled())}" width="50" height="50"/></svg>`
    const image = ck.MakeImageFromEncoded(await svgThumbnail(new TextEncoder().encode(svg), 100))
    expect([image?.width(), image?.height()]).toEqual([100, 100])
    image?.delete()
    expect(await pixelAt(svg, 50, 50)).toEqual([0, 0, 0, 0])
  })

  it('leaves out a picture whose header is good and whose body is not, and draws the rest', async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><image href="${dataUrl(garbled())}" width="50" height="50"/><image href="${dataUrl(solid(10, [200, 40, 40]))}" x="50" width="50" height="50"/></svg>`
    expect(await pixelAt(svg, 25, 25)).toEqual([0, 0, 0, 0])
    expect(await pixelAt(svg, 75, 25)).toEqual([200, 40, 40, 255])
  })
})

describe('startSvgThread', () => {
  it('gets the API’s thread ready before any file asks for it', async () => {
    expect(await startSvgThread()).toBe(true)
  })
})

describe('svgReader', () => {
  it('reads a file that comes while the thread starts, once the thread is ready', async () => {
    const threads = heldThreads()
    const reader = heldReader()
    const reading = reader.read(SQUARE, 320)
    await threads.until('starting', 1)
    threads.go()
    expect((await reading)?.header.width).toBe(10)
    expect(threads.said.starting).toBe(1)
  })

  it('starts a file’s time once the thread is ready, so a start takes none of it', async () => {
    const threads = heldThreads()
    const reader = heldReader()
    const reading = reader.read(SQUARE, 320, 2_000)
    await threads.until('starting', 1)
    // Held past the file's 2 s to draw.
    await new Promise((resolve) => setTimeout(resolve, 2_500))
    threads.go()
    expect((await reading)?.header.width).toBe(10)
  })

  it('starts the thread ahead of the first file, which then waits for no start', async () => {
    const threads = heldThreads(true)
    const reader = heldReader()
    expect(await reader.start()).toBe(true)
    expect((await reader.read(SQUARE, 320))?.header.width).toBe(10)
    expect(threads.said.starting).toBe(1)
  })

  it('starts a thread again as soon as a job ends one, before any file asks for it', async () => {
    const threads = heldThreads(true)
    const reader = heldReader()
    const { refused } = await timed(() => reader.read(encoded(bigPictureSvg()), 320))
    expect(refused).toBeInstanceOf(SvgRefused)
    // Ended for its memory, then started again with nothing asked.
    await threads.until('ready', 2)
    expect((await reader.read(SQUARE, 320))?.header.width).toBe(10)
    expect(threads.said.starting).toBe(2)
  })

  it('answers busy a file the thread isn’t ready for within its wait, and keeps starting the thread for the next', async () => {
    const threads = heldThreads()
    const reader = heldReader({ waitLimitMs: 100 })
    await expect(reader.read(SQUARE, 320)).rejects.toThrow(
      new SvgBusy('Dazbee is getting ready to read SVG files; add this one again in a minute'),
    )
    await threads.until('starting', 1)
    threads.go()
    await threads.until('ready', 1)
    expect((await reader.read(SQUARE, 320))?.header.width).toBe(10)
    expect(threads.said.starting).toBe(1)
  })

  it('ends and logs a thread not ready within its start limit, and answers busy the file waiting for it', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const reader = heldReader({ startLimitMs: 100 })
    await expect(reader.read(SQUARE, 320)).rejects.toThrow(
      new SvgBusy('Dazbee is getting ready to read SVG files; add this one again in a minute'),
    )
    expect(log).toHaveBeenCalledWith(expect.stringContaining('the SVG thread was not ready in 0.1 seconds'))
    // Each start is held past the limit, so each is ended without getting ready.
    expect(await reader.start()).toBe(false)
  })
})
