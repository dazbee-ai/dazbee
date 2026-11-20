import { describe, expect, it } from 'vitest'

import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type Design, parseDesign } from '@dazbee/schema'

import { agentRender } from './agent-render.ts'

const ck = await loadCanvasKit()
const bytes = {
  fonts: loadFontFiles().map((f) => ({ family: f.family, bytes: f.bytes })),
  fallbackFamilies: [...FALLBACK_FAMILIES],
  images: {},
}

/** A design of one frame of this size: red, with a blue square in its left half. */
function designOfSize(width: number, height: number): Design {
  const parsed = parseDesign({
    meta: { designId: 'd', name: 'Agent' },
    pages: { p: { name: 'Page', order: 'a0' } },
    frames: {
      f: { pageId: 'p', name: 'Frame', width, height, x: 0, y: 0, order: 'a0', fills: [solid('#FF0000FF')] },
    },
    nodes: {
      square: {
        type: 'graphic',
        parentId: 'f',
        index: 'a0',
        link: 'square',
        name: 'Square',
        props: { x: 0, y: 0, width: width / 2, height, shape: { kind: 'rect' }, fills: [solid('#0000FFFF')] },
      },
    },
  })
  if (!parsed.success) throw new Error(parsed.errors.join('\n'))
  return parsed.design
}

function solid(color: string) {
  return { type: 'solid', color }
}

/** A PNG's size and the colour of one of its pixels. */
function decoded(png: Uint8Array, x: number, y: number) {
  const image = ck.MakeImageFromEncoded(png)
  if (!image) throw new Error('could not decode')
  try {
    const px = image.readPixels(x, y, {
      width: 1,
      height: 1,
      colorType: ck.ColorType.RGBA_8888,
      alphaType: ck.AlphaType.Unpremul,
      colorSpace: ck.ColorSpace.SRGB,
    })
    return { size: [image.width(), image.height()], px: [...(px as Uint8Array)] }
  } finally {
    image.delete()
  }
}

describe('agentRender', () => {
  it('fits a large frame so its longer side is 1600, drawn below 1x', () => {
    const shot = agentRender(ck, designOfSize(4000, 2000), 'f', bytes)
    expect(shot.scale).toBe(0.4)
    expect([shot.width, shot.height]).toEqual([1600, 800])
    const left = decoded(shot.png, 100, 400)
    expect(left.size).toEqual([1600, 800])
    expect(left.px).toEqual([0, 0, 255, 255])
    expect(decoded(shot.png, 1500, 400).px).toEqual([255, 0, 0, 255])
  })

  it('does not scale a small frame past 2', () => {
    const shot = agentRender(ck, designOfSize(100, 50), 'f', bytes)
    expect(shot.scale).toBe(2)
    expect(decoded(shot.png, 0, 0).size).toEqual([200, 100])
  })

  it('lowers the scale until the PNG fits the byte limit', () => {
    const design = designOfSize(4000, 2000)
    const full = agentRender(ck, design, 'f', bytes)
    const maxBytes = Math.floor(full.png.length / 2)
    const shot = agentRender(ck, design, 'f', bytes, { maxBytes })
    expect(shot.png.length).toBeLessThanOrEqual(maxBytes)
    expect(shot.scale).toBeLessThan(full.scale)
    expect(decoded(shot.png, 0, 0).size).toEqual([shot.width, shot.height])
  })

  it('tries a longer side of 16 pixels before refusing', () => {
    const design = designOfSize(4000, 2000)
    const smallest = agentRender(ck, design, 'f', bytes, { maxSize: 16 })
    const shot = agentRender(ck, design, 'f', bytes, { maxBytes: smallest.png.length })
    expect([shot.width, shot.height]).toEqual([16, 8])
  })

  it('refuses a byte limit no render of the frame fits', () => {
    expect(() => agentRender(ck, designOfSize(4000, 2000), 'f', bytes, { maxBytes: 10 })).toThrow(
      'no render of frame "f" fits in 10 bytes',
    )
  })
})
