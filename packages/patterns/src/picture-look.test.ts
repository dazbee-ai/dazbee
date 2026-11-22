import { describe, expect, it } from 'vitest'

import { inkReads, oneInk, pictureLook } from './picture-look.ts'

/** A picture `width` × `height` filled by `at`, which gives each pixel's RGBA. */
function pixels(width: number, height: number, at: (x: number, y: number) => readonly number[]): Uint8Array {
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) rgba.set(at(x, y), (y * width + x) * 4)
  return rgba
}

/** Whether a point is inside a box. */
const inside = (x: number, y: number, box: { x: number; y: number; width: number; height: number }) =>
  x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height

describe('pictureLook', () => {
  it('reads a cut-out’s subject from its opaque part, with no backdrop', () => {
    const box = { x: 100, y: 60, width: 200, height: 80 }
    const look = pictureLook(
      pixels(400, 200, (x, y) => (inside(x, y, box) ? [20, 40, 200, 255] : [0, 0, 0, 0])),
      400,
      200,
    )
    expect(look.backdrop).toBeUndefined()
    // Within a read pixel of the box, never inside it.
    expect(look.subject.x).toBeLessThanOrEqual(100)
    expect(look.subject.x).toBeGreaterThanOrEqual(96)
    expect(look.subject.x + look.subject.width).toBeGreaterThanOrEqual(300)
    expect(look.subject.y + look.subject.height).toBeGreaterThanOrEqual(140)
    expect(look.inks[0]).toEqual({ colour: '#1428C8FF', share: 1 })
  })

  it('reads a logo on a white box: the box’s colour as its backdrop, and its ink inside it', () => {
    const ink = { x: 40, y: 30, width: 120, height: 40 }
    const look = pictureLook(
      pixels(200, 100, (x, y) => (inside(x, y, ink) ? [200, 0, 0, 255] : [255, 255, 255, 255])),
      200,
      100,
    )
    expect(look.backdrop).toBe('#FFFFFFFF')
    expect(look.subject.x).toBeLessThanOrEqual(40)
    expect(look.subject.width).toBeLessThanOrEqual(124)
    expect(oneInk(look)).toBe(true)
  })

  it('reads a photo’s subject from where its colour changes sharply, past a backdrop that shades softly', () => {
    const shoe = { x: 600, y: 500, width: 800, height: 300 }
    // A backdrop shading from light at the top to darker at the foot, and a dark subject on it.
    const look = pictureLook(
      pixels(1920, 1200, (x, y) =>
        inside(x, y, shoe) ? [30, 70, 200, 255] : [250 - y / 24, 230 - y / 20, 210 - y / 16, 255],
      ),
      1920,
      1200,
    )
    expect(Math.abs(look.subject.x - shoe.x)).toBeLessThan(20)
    expect(Math.abs(look.subject.y - shoe.y)).toBeLessThan(20)
    expect(Math.abs(look.subject.width - shoe.width)).toBeLessThan(30)
    expect(Math.abs(look.subject.height - shoe.height)).toBeLessThan(30)
  })
})

describe('inkReads', () => {
  it('reads where most of the ink stands out and none worth telling is lost', () => {
    const twoInks = {
      subject: { x: 0, y: 0, width: 10, height: 10 },
      inks: [
        { colour: '#FF5A36FF', share: 0.5 },
        { colour: '#14213DFF', share: 0.4 },
      ],
    }
    expect(inkReads(twoInks, '#FFFFFFFF')).toBe(true)
    // On its own orange, the orange mark is lost; on its own navy, the navy word is.
    expect(inkReads(twoInks, '#FF5A36FF')).toBe(false)
    expect(inkReads(twoInks, '#14213DFF')).toBe(false)
  })
})
