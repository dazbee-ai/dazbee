import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { png } from '../test-files.ts'
import { svgThumbnail } from './svg-worker.ts'

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
