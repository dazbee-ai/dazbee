import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'
import { readImageHeader } from '@dazbee/schema'
import { hugePath, NESTED_BLURS } from '@dazbee/svg/test-hostile-files'

import { DEEP_BLURS, png, SLOW_BLURS } from '../test-files.ts'
import { readSvgHeader, SvgRefused, svgThumbnail } from './svg-assets.ts'

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

/** How long `run` takes, in milliseconds, and the longest the API's own thread went without running a timer meanwhile. */
async function timed(run: () => Promise<unknown>) {
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
  } finally {
    clearInterval(ticks)
  }
  return { ms: performance.now() - started, longestGap: Math.max(longestGap, performance.now() - last) }
}

describe('readSvgHeader', () => {
  it('reads an SVG file at its own size, and nothing of a file that is not one', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="120.5" height="80"><rect width="9" height="9"/></svg>'
    expect(await readSvgHeader(encoded(svg))).toEqual({ contentType: 'image/svg+xml', width: 121, height: 80 })
    expect(await readSvgHeader(encoded('<html><body/></html>'))).toBeNull()
    expect(await readSvgHeader(encoded('<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>'))).toBeNull()
  })

  it('refuses 50 nested blurs and one path of 630,000 points within a second each, saying which limit each passes, the API not growing', async () => {
    // The thread started, as it is once it has read a file.
    await readSvgHeader(SQUARE)
    const before = rss()
    for (const [file, limit] of [
      [NESTED_BLURS, 'its blurs and shadows nest more than 4 deep'],
      [hugePath(), 'one of its paths has more than 250,000 points'],
    ] as const) {
      let refused: unknown
      const { ms } = await timed(() => readSvgHeader(encoded(file)).catch((error: unknown) => (refused = error)))
      expect(refused).toBeInstanceOf(SvgRefused)
      expect((refused as Error).message).toBe(`This SVG file is too complex to draw: ${limit}`)
      expect(ms).toBeLessThan(1000)
    }
    expect(rss() - before).toBeLessThan(100)
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

  it('refuses 50 nested blurs within a second, the API not growing', async () => {
    await svgThumbnail(SQUARE, 320)
    const before = rss()
    let refused: unknown
    const { ms } = await timed(() =>
      svgThumbnail(encoded(NESTED_BLURS), 320).catch((error: unknown) => (refused = error)),
    )
    expect((refused as Error).message).toBe(
      'This SVG file is too complex to draw: its blurs and shadows nest more than 4 deep',
    )
    expect(ms).toBeLessThan(1000)
    expect(rss() - before).toBeLessThan(100)
  })

  it('refuses a file whose drawing needs more memory than its thread may take, the API answering meanwhile and its memory given back', async () => {
    const before = rss()
    let refused: unknown
    const { longestGap } = await timed(() =>
      svgThumbnail(encoded(DEEP_BLURS), 320).catch((error: unknown) => (refused = error)),
    )
    expect(refused).toBeInstanceOf(SvgRefused)
    expect((refused as Error).message).toBe('This SVG file needs too much memory to draw')
    expect(longestGap).toBeLessThan(250)
    expect(rss() - before).toBeLessThan(100)
    // A new thread draws the next file.
    expect(readImageHeader(await svgThumbnail(SQUARE, 320))).toMatchObject({ width: 320, height: 320 })
  })

  it('ends a drawing past its time limit and refuses the file, the API answering meanwhile', async () => {
    let refused: unknown
    const { ms, longestGap } = await timed(() =>
      svgThumbnail(encoded(SLOW_BLURS), 320, 500).catch((error: unknown) => (refused = error)),
    )
    expect(refused).toBeInstanceOf(SvgRefused)
    expect((refused as Error).message).toBe('This SVG file took more than 0.5 seconds to draw')
    expect(ms).toBeLessThan(1500)
    expect(longestGap).toBeLessThan(250)
    expect(readImageHeader(await svgThumbnail(SQUARE, 320))).toMatchObject({ width: 320, height: 320 })
  })
})
