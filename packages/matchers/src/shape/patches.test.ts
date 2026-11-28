import { describe, expect, it } from 'vitest'

import { loadCanvasKit } from '@dazbee/renderer/node'

import { drawGraphics, type ShapeLayer } from './draw-layers.ts'
import { holds } from './outlines.ts'
import { toFloatPicture } from './parts/float-picture.ts'
import { type Patch, type Split, splitPatches } from './patches.ts'
import { bandAndDisc, painted } from './test-matching.ts'
import { ellipse, graphic, hiding, noise, rectangle, shadowed } from './test-pieces.ts'

const ck = await loadCanvasKit()
const BLUE = '#2563EBFF'
const CORAL = '#F2765AFF'
const GREEN = '#16A34AFF'
const INK = '#111827FF'

/** The graphics drawn as a piece and cut into patches, twice: the two cuts are one, and the first is returned. */
const cut = (layers: ShapeLayer[], width: number, height: number, hidden?: Uint8Array): Split | null => {
  const once = splitPatches(toFloatPicture(drawGraphics(ck, layers, width, height)), hidden)
  expect(splitPatches(toFloatPicture(drawGraphics(ck, layers, width, height)), hidden)).toEqual(once)
  return once
}

/** The patches of a piece that is cut. */
const patchesOf = (layers: ShapeLayer[], width: number, height: number, hidden?: Uint8Array): Patch[] => {
  const split = cut(layers, width, height, hidden)
  if (!split) throw new Error('the piece was cut no further')
  return split.patches
}

/** Where a patch's outer outlines reach: the least and most x and y of their points. */
const reachOf = (patch: Patch) => {
  const reach = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }
  for (const loop of patch.loops.filter((outline) => outline.area > 0))
    for (let k = 0; k < loop.points.length; k += 2) {
      const x = loop.points[k] ?? 0
      const y = loop.points[k + 1] ?? 0
      reach.left = Math.min(reach.left, x)
      reach.right = Math.max(reach.right, x)
      reach.top = Math.min(reach.top, y)
      reach.bottom = Math.max(reach.bottom, y)
    }
  return reach
}

/** How far a patch's outer outline lies from a circle's edge: its points' mean distance and the farthest. */
const offCircle = (patch: Patch | undefined, cx: number, cy: number, radius: number) => {
  const outline = patch?.loops.find((loop) => loop.area > 0)
  if (!outline) throw new Error('no outline')
  let sum = 0
  let farthest = 0
  for (let k = 0; k < outline.points.length; k += 2) {
    const off = Math.abs(Math.hypot((outline.points[k] ?? 0) - cx, (outline.points[k + 1] ?? 0) - cy) - radius)
    sum += off
    farthest = Math.max(farthest, off)
  }
  return { mean: sum / (outline.points.length / 2), farthest }
}

/** The patch whose outer outline holds a point of the piece. */
const patchAt = (patches: readonly Patch[], x: number, y: number): Patch | undefined =>
  patches.find((patch) => patch.loops.some((loop) => loop.area > 0 && holds(loop.points, x, y)))

const pill = rectangle({ x: 30, y: 24, width: 140, height: 48 }, GREEN, 24)

describe('splitPatches', () => {
  it('cuts two flat colours into two patches whose outlines hold the areas drawn', () => {
    const patches = patchesOf(
      [
        rectangle({ x: 20, y: 20, width: 120, height: 80 }, BLUE),
        ellipse({ x: 160, y: 30, width: 60, height: 60 }, CORAL),
      ],
      240,
      120,
    )
    expect(patches).toHaveLength(2)
    const panel = patchAt(patches, 80, 60)
    const disc = patchAt(patches, 190, 60)
    expect(panel?.rgb.map(Math.round)).toEqual([37, 99, 235])
    expect(disc?.rgb.map(Math.round)).toEqual([242, 118, 90])
    expect(panel?.outline).toBeCloseTo(120 * 80, -2)
    expect(disc?.outline).toBeCloseTo(Math.PI * 30 * 30, -2)
    // Neither holds the other's pixels, nor the see-through pixels between them.
    expect(patchAt(patches, 150, 60)).toBeUndefined()
    expect(panel).not.toBe(disc)
  })

  it('puts a see-through edge drawn between pixels within half a pixel of where it was drawn', () => {
    const [patch, ...others] = patchesOf([rectangle({ x: 30.3, y: 20.6, width: 100.4, height: 60.2 }, BLUE)], 160, 100)
    expect(others).toEqual([])
    if (!patch) throw new Error('no patch')
    const reach = reachOf(patch)
    expect(Math.abs(reach.left - 30.3)).toBeLessThan(0.5)
    expect(Math.abs(reach.right - 130.7)).toBeLessThan(0.5)
    expect(Math.abs(reach.top - 20.6)).toBeLessThan(0.5)
    expect(Math.abs(reach.bottom - 80.8)).toBeLessThan(0.5)
  })

  it('puts a round edge within half a pixel of where it was drawn, and one between two colours within a pixel', () => {
    const disc = ellipse({ x: 40.3, y: 10.4, width: 80, height: 80 }, BLUE)
    const [alone] = patchesOf([disc], 160, 100)
    const onPanel = patchesOf([rectangle({ x: 0, y: 0, width: 160, height: 100 }, '#FFF4D6FF'), disc], 160, 100)
    expect(onPanel).toHaveLength(2)
    const seeThrough = offCircle(alone, 80.3, 50.4, 40)
    expect(seeThrough.farthest).toBeLessThan(0.5)
    const mixed = offCircle(
      onPanel.find((patch) => Math.round(patch.rgb[2]) === 235),
      80.3,
      50.4,
      40,
    )
    expect(mixed.mean).toBeLessThan(0.5)
    expect(mixed.farthest).toBeLessThan(1)
  })

  it('keeps the bands of one gradient as one patch', () => {
    const patches = patchesOf(
      [
        graphic(
          { kind: 'rect', cornerRadius: 0 },
          { x: 10, y: 10, width: 220, height: 100 },
          {
            fill: {
              type: 'linear',
              from: { x: 0, y: 0.5 },
              to: { x: 1, y: 0.5 },
              stops: [
                { offset: 0, color: '#FDE68AFF' },
                { offset: 1, color: '#B91C1CFF' },
              ],
            },
          },
        ),
      ],
      240,
      120,
    )
    expect(patches).toHaveLength(1)
    expect(patches[0]?.outline).toBeCloseTo(220 * 100, -2)
    // Its colour changes across it, which a flat patch's does not.
    expect(patches[0]?.spread).toBeGreaterThan(10)
  })

  it('makes no patch of a soft shadow under a solid pill, and leaves the pill’s lower edge where it is', () => {
    const shadow = { x: 0, y: 8, blur: 16, color: '#00000066' }
    const picture = toFloatPicture(drawGraphics(ck, [shadowed(pill, shadow)], 200, 120))
    const split = cut([shadowed(pill, shadow)], 200, 120)
    expect(split?.patches).toHaveLength(1)
    const [patch] = split?.patches ?? []
    if (!split || !patch) throw new Error('no patch')
    expect(patch.rgb.map(Math.round)).toEqual([22, 163, 74])
    expect(Math.abs(reachOf(patch).bottom - 72)).toBeLessThan(0.5)
    // Under the pill the shadow shows, and is no patch's.
    const below = 84 * 200 + 100
    expect(picture.data[below * 4 + 3]).toBeGreaterThan(0.1)
    expect(split.patchOf[below]).toBe(-1)
    expect(split.patchOf[48 * 200 + 100]).toBe(patch.id)
  })

  it('cuts a picture of noise no further', () => {
    expect(cut(noise(), 90, 90)).toBeNull()
  })

  it('fills what other layers hide from around it, so a hidden badge is no patch', () => {
    const panel = rectangle({ x: 20, y: 20, width: 160, height: 100 }, BLUE, 12)
    const badge = rectangle({ x: 80, y: 50, width: 40, height: 40 }, INK)
    expect(patchesOf([panel, badge], 200, 140)).toHaveLength(2)
    const hidden = hiding({ x: 80, y: 50, width: 40, height: 40 }, 200, 140)
    const split = cut([panel, badge], 200, 140, hidden)
    expect(split?.patches).toHaveLength(1)
    expect(split?.patches[0]?.rgb.map(Math.round)).toEqual([37, 99, 235])
    expect(split?.patchOf[70 * 200 + 100]).toBe(split?.patches[0]?.id)
    expect(split?.patches[0]?.loops.filter((loop) => loop.area < 0)).toEqual([])
  })

  it('gives a patch other layers hide all of the colour it was cut by, as a patch that shows has its own', () => {
    const { piece, hidden } = bandAndDisc()
    const split = splitPatches(toFloatPicture(piece), hidden)
    if (!split) throw new Error('the piece was cut no further')
    expect(split.patches).toHaveLength(3)
    // The band and the white show; the disc, of the band's red, is all under the hidden box.
    const disc = split.patches[split.patchOf[100 * 300 + 220] ?? -1]
    const band = split.patches[split.patchOf[100 * 300 + 50] ?? -1]
    expect(disc?.area).toBeGreaterThan(2700)
    expect(disc?.colour).toBe(band?.colour)
    expect(disc?.rgb.map(Math.round)).toEqual([220, 38, 38])
    expect(band?.rgb.map(Math.round)).toEqual([220, 38, 38])
  })

  it('cuts a picture that covers nothing into no patches', () => {
    const split = splitPatches(toFloatPicture(painted(50, 50, () => [0, 0, 0, 0])))
    expect(split).toMatchObject({ width: 50, height: 50, patches: [], unexplained: 0, tooMany: false })
    expect(split?.patchOf.every((id) => id === -1)).toBe(true)
  })

  it('stops tracing outlines once more patches than asked for hold one, and says so', () => {
    // Six squares of 20 px in a row, apart.
    const squares = Array.from({ length: 6 }, (_, i) =>
      rectangle({ x: 10 + i * 30, y: 20, width: 20, height: 20 }, INK),
    )
    const picture = toFloatPicture(drawGraphics(ck, squares, 200, 60))
    const all = splitPatches(picture)
    expect(all?.tooMany).toBe(false)
    expect(all?.patches).toHaveLength(6)
    expect(all?.patches.every((patch) => patch.loops.length > 0)).toBe(true)
    const some = splitPatches(picture, undefined, { most: { patches: 3, outline: 2 } })
    expect(some?.tooMany).toBe(true)
    expect(some?.patches).toHaveLength(6)
    expect(some?.patches.filter((patch) => patch.loops.length > 0)).toHaveLength(4)
    // Six is not more than six.
    expect(splitPatches(picture, undefined, { most: { patches: 6, outline: 2 } })?.tooMany).toBe(false)
  })
})
