import { describe, expect, it } from 'vitest'

import type { Layer } from '@dazbee/schema'
import { apply, type Matrix, multiply } from '@dazbee/svg'

import { placementOf, poseOf, spaceOf } from './geometry.ts'
import { readFigmaFile } from './read.ts'
import {
  aabb,
  box,
  frame,
  MIRROR_X,
  MIRROR_Y,
  node,
  onePage,
  outline,
  placedAt,
  rectangle,
  solid,
  turned,
  vector,
} from './test-figma.ts'
import { built, childrenOf, countOf, drawnAt, layersOf, linesOf, onlyFrame } from './test-import.ts'

const FRAME_AT: Matrix = [1, 0, 0, 1, 100, 100]
const square = 'M0 0L20 0L20 10L0 10Z'

/** Expects each corner of a layer's box to be drawn where Figma draws that corner of the node `world` places. */
function expectDrawnAs(nodes: Record<string, Layer>, id: string, world: Matrix, width: number, height: number) {
  for (const [x, y] of [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ] as const) {
    const figma = apply(world, x, y)
    const drawn = drawnAt(nodes, id, { x, y })
    expect(drawn.x).toBeCloseTo(figma.x - FRAME_AT[4], 6)
    expect(drawn.y).toBeCloseTo(figma.y - FRAME_AT[5], 6)
  }
}

const inFrame = (children: ReturnType<typeof node>[]) =>
  onePage([frame('1:1', box(100, 100, 400, 300), children, placedAt(FRAME_AT, 400, 300))])

describe('placementOf', () => {
  it('places a child of a group in the frame’s space or the group’s, whichever matches its box', () => {
    const groupAt = multiply(FRAME_AT, turned(30, 50, 50))
    const inFrameSpace = multiply(FRAME_AT, turned(0, 60, 60))
    const inGroupSpace = multiply(groupAt, turned(0, 20, 20))
    const text = inFrame([
      node('GROUP', '1:2', box(0, 0, 0, 0), {
        ...placedAt(groupAt, 40, 40, FRAME_AT),
        children: [
          rectangle('1:3', box(0, 0, 0, 0), placedAt(inFrameSpace, 10, 10, FRAME_AT)),
          rectangle('1:4', box(0, 0, 0, 0), placedAt(inGroupSpace, 10, 10, groupAt)),
        ],
      }),
    ])
    const nodes = layersOf(onlyFrame(text))
    expectDrawnAs(nodes, '1-3', inFrameSpace, 10, 10)
    expectDrawnAs(nodes, '1-4', inGroupSpace, 10, 10)
  })

  it('places a node by its box and its turn, counter-clockwise in radians, when it has no matrix', () => {
    const file = readFigmaFile(
      onePage([rectangle('1:2', box(0, 0, 0, 0), { absoluteBoundingBox: box(0, 0, 20, 20), rotation: Math.PI / 2 })]),
    )
    if ('error' in file) throw new Error(file.error)
    const n = file.document.children[0]?.children[0]
    const placed = n && placementOf(n, spaceOf(null))
    expect(placed?.width).toBe(20)
    // Turned a quarter counter-clockwise, its top right corner is at the top left, its top left at the bottom left.
    const topRight = placed && apply(placed.world, 20, 0)
    expect(topRight?.x).toBeCloseTo(0)
    expect(topRight?.y).toBeCloseTo(0)
    const topLeft = placed && apply(placed.world, 0, 0)
    expect(topLeft?.x).toBeCloseTo(0)
    expect(topLeft?.y).toBeCloseTo(20)
  })

  it('moves a node whose matrix misses its own box to that box, keeping its turn', () => {
    const world = multiply(FRAME_AT, turned(30, 50, 50))
    const truth = multiply([1, 0, 0, 1, 40, 0], world)
    const moved = { ...placedAt(world, 40, 20, FRAME_AT), absoluteBoundingBox: aabb(truth, 40, 20) }
    const nodes = layersOf(onlyFrame(inFrame([rectangle('1:2', box(0, 0, 0, 0), moved)])))
    expect(nodes['1-2']?.props.rotation).toBeCloseTo(30)
    expectDrawnAs(nodes, '1-2', truth, 40, 20)
  })
})

describe('poseOf', () => {
  it('keeps a text mirrored left to right at 0° with flipX, and top to bottom at 0° with flipY', () => {
    const across = poseOf(multiply(turned(0, 50, 0), MIRROR_X), 50, 20, false)
    expect(across.box).toMatchObject({ x: 0, y: 0, width: 50, height: 20 })
    expect(across.box.rotation).toBeCloseTo(0)
    expect(across.flips).toEqual({ flipX: true })
    const down = poseOf(multiply(turned(0, 0, 20), MIRROR_Y), 50, 20, false)
    expect(down.box.rotation).toBeCloseTo(0)
    expect(down.flips).toEqual({ flipY: true })
    expect(down.box).toMatchObject({ x: 0, y: 0, width: 50, height: 20 })
  })

  it('reads a turn in float32 numbers as no skew', () => {
    const f = Math.fround
    const pose = poseOf([f(Math.SQRT1_2), f(Math.SQRT1_2), f(-Math.SQRT1_2), f(Math.SQRT1_2), 0, 0], 100, 50, false)
    expect(pose.skewed).toBe(false)
    expect(pose.box.width).toBe(100)
    expect(pose.box.rotation).toBeCloseTo(45, 5)
  })

  it('keeps a skewed text’s turn and flip, and says it is skewed', () => {
    const pose = poseOf(multiply(turned(30, 10, 10), [1, 0, 0.5, 1, 0, 0]), 40, 20, false)
    expect(pose.skewed).toBe(true)
    expect(pose.box.rotation).toBeCloseTo(30)
    expect(pose.flips).toEqual({})
    const centre = apply(multiply(turned(30, 10, 10), [1, 0, 0.5, 1, 0, 0]), 20, 10)
    expect(pose.box.x + pose.box.width / 2).toBeCloseTo(centre.x)
    expect(pose.box.y + pose.box.height / 2).toBeCloseTo(centre.y)
  })

  it('flips a box mirrored left to right, keeping 0°, and one mirrored top to bottom', () => {
    const across = multiply(FRAME_AT, multiply(turned(0, 80, 10), MIRROR_X))
    const down = multiply(FRAME_AT, multiply(turned(0, 10, 90), MIRROR_Y))
    const nodes = layersOf(
      onlyFrame(
        inFrame([
          frame('1:2', box(0, 0, 0, 0), [], placedAt(across, 60, 40, FRAME_AT)),
          frame('1:3', box(0, 0, 0, 0), [], placedAt(down, 60, 40, FRAME_AT)),
        ]),
      ),
    )
    expect(nodes['1-2']?.props).toMatchObject({ x: 20, y: 10, width: 60, height: 40, flipX: true })
    expect(nodes['1-2']?.props.rotation).toBeCloseTo(0)
    expect(nodes['1-3']?.props).toMatchObject({ x: 10, y: 50, width: 60, height: 40, flipY: true })
    expect(nodes['1-3']?.props.rotation).toBeCloseTo(0)
  })

  it('pushes a mirrored group’s mirror into each path it holds, their gradients’ handles kept', () => {
    const groupAt = multiply(FRAME_AT, multiply(turned(0, 200, 0), MIRROR_X))
    const paint = { type: 'GRADIENT_LINEAR', gradientHandlePositions: [] }
    const kid = (id: string, x: number) =>
      vector(
        id,
        multiply(groupAt, turned(0, x, 0)),
        20,
        10,
        { fillGeometry: [outline(square)], fills: [paint] },
        groupAt,
      )
    const text = inFrame([
      node('GROUP', '1:2', box(0, 0, 0, 0), {
        ...placedAt(groupAt, 70, 10, FRAME_AT),
        children: [kid('1:3', 0), kid('1:4', 50)],
      }),
    ])
    const nodes = layersOf(onlyFrame(text))
    expect(nodes['1-2']?.props).not.toHaveProperty('flipX')
    expect(nodes['1-3']?.props).toMatchObject({ x: 180, y: 0, width: 20, flipX: true })
    expect(nodes['1-4']?.props).toMatchObject({ x: 130, y: 0, width: 20, flipX: true })
    expect(nodes['1-3']?.props).toMatchObject({
      shape: { kind: 'path', d: square, drawnIn: { width: 20, height: 10 } },
    })
    const paints = built(text).paints['1-3']
    expect(paints?.fills).toEqual([paint])
    paints?.handles.forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 1, 0, 0][i] ?? NaN))
  })

  it('bakes a skew into a path’s data, its handles carried into its new box', () => {
    const skew: Matrix = [1, 0, 1, 1, 0, 0]
    const at = multiply(FRAME_AT, multiply(turned(0, 10, 10), skew))
    const text = inFrame([
      vector('1:2', at, 20, 10, { fillGeometry: [outline(square)], fills: [solid('#ff0000')] }, FRAME_AT),
    ])
    const layer = layersOf(onlyFrame(text))['1-2']
    expect(layer?.props).toMatchObject({
      x: 10,
      y: 10,
      width: 30,
      height: 10,
      shape: { kind: 'path', d: 'M0 0L20 0L30 10L10 10Z', drawnIn: { width: 30, height: 10 } },
    })
    expect(linesOf(text)).toEqual([])
    const handles = built(text).paints['1-2']?.handles
    // The node's unit box's right corner (1, 1) is at (30, 10) of a 30 × 10 box: its own (1, 1).
    expect(handles && apply(handles, 1, 1)).toEqual({ x: 1, y: 1 })
    expect(handles && apply(handles, 0, 1).x).toBeCloseTo(1 / 3)
  })

  it('pushes a group’s skew into each graphic it holds', () => {
    const groupAt = multiply(FRAME_AT, [1, 0, 0.5, 1, 0, 0])
    const text = inFrame([
      node('GROUP', '1:2', box(0, 0, 0, 0), {
        ...placedAt(groupAt, 20, 10, FRAME_AT),
        children: [
          rectangle('1:3', box(0, 0, 0, 0), { ...placedAt(groupAt, 20, 10, groupAt), fillGeometry: [outline(square)] }),
        ],
      }),
    ])
    const nodes = layersOf(onlyFrame(text))
    expect(nodes['1-3']?.props).toMatchObject({ width: 25, shape: { kind: 'path', d: 'M0 0L20 0L25 10L5 10Z' } })
    expect(linesOf(text)).toEqual([])
  })

  it('keeps a skewed box’s turn and flip, reported', () => {
    const at = multiply(FRAME_AT, multiply(turned(20, 50, 50), multiply(MIRROR_X, [1, 0, 0.3, 1, 0, 0])))
    const text = inFrame([frame('1:2', box(0, 0, 0, 0), [], placedAt(at, 40, 20, FRAME_AT))])
    const layer = layersOf(onlyFrame(text))['1-2']
    expect(layer?.props.rotation).toBeCloseTo(20)
    expect(layer?.props).toMatchObject({ flipX: true })
    expect(linesOf(text)).toEqual(['skewed-layers'])
  })

  it('draws a skewed rectangle without an outline unskewed, reported', () => {
    const at = multiply(FRAME_AT, [1, 0, 0.5, 1, 0, 0])
    const text = inFrame([rectangle('1:2', box(0, 0, 0, 0), placedAt(at, 20, 10, FRAME_AT))])
    expect(layersOf(onlyFrame(text))['1-2']?.props).toMatchObject({ shape: { kind: 'rect' } })
    expect(linesOf(text)).toEqual(['skewed-layers'])
  })
})

describe('withinReach', () => {
  it('brings coordinates past ±10,000,000 and sizes past 1,000,000 within them, reported', () => {
    const text = inFrame([
      rectangle('1:2', box(0, 0, 0, 0), placedAt(multiply(FRAME_AT, turned(0, 2e7, -3e7)), 10, 10, FRAME_AT)),
      rectangle('1:3', box(0, 0, 0, 0), placedAt(FRAME_AT, 5e6, 10, FRAME_AT)),
      rectangle('1:4', box(0, 0, 0, 0), { ...placedAt(FRAME_AT, 10, 10, FRAME_AT), size: { x: 1e300, y: 10 } }),
    ])
    const nodes = layersOf(onlyFrame(text))
    expect(nodes['1-2']?.props).toMatchObject({ x: 1e7, y: -1e7 })
    expect(nodes['1-3']?.props.width).toBe(1e6)
    expect(nodes['1-4']?.props.width).toBe(1e6)
    expect(countOf(text, 'positions-clamped')).toBe(3)
  })

  it('keeps a turned box brought within reach turning its layers where Figma draws them', () => {
    // Past reach along the frame's x, while the child, in the box's turned pixels, is within it.
    const boxAt = multiply(FRAME_AT, turned(45, 1.05e7, 0))
    const childAt = multiply(boxAt, turned(0, 10, 10))
    const text = inFrame([
      frame('1:2', box(0, 0, 0, 0), [rectangle('1:3', box(0, 0, 0, 0), placedAt(childAt, 10, 10, boxAt))], {
        ...placedAt(boxAt, 1000, 1000, FRAME_AT),
      }),
    ])
    const nodes = layersOf(onlyFrame(text))
    expect(nodes['1-2']?.props.x).toBe(1e7)
    expectDrawnAs(nodes, '1-3', childAt, 10, 10)
  })

  it('keeps every number finite under matrices that scale past reach', () => {
    const huge: Matrix = [1e6, 0, 0, 1e6, 0, 0]
    let inner = rectangle('1:9', box(0, 0, 0, 0), { ...placedAt(huge, 10, 10, [1, 0, 0, 1, 0, 0]) })
    for (let i = 8; i >= 2; i--) {
      inner = frame(`1:${i}`, box(0, 0, 10, 10), [inner], {
        relativeTransform: [
          [1e6, 0, 0],
          [0, 1e6, 0],
        ],
        size: { x: 10, y: 10 },
      })
    }
    const nodes = layersOf(onlyFrame(inFrame([inner])))
    for (const layer of Object.values(nodes)) {
      for (const v of [layer.props.x, layer.props.y, layer.props.width, layer.props.height, layer.props.rotation])
        expect(Number.isFinite(v)).toBe(true)
    }
    expect(childrenOf(nodes, '1-8')).toEqual(['1-9'])
  })
})

describe('settle', () => {
  it('draws a turned box holding a turned child where Figma draws them', () => {
    const boxAt = multiply(FRAME_AT, turned(30, 120, 40))
    const childAt = multiply(boxAt, turned(15, 30, 10))
    const text = inFrame([
      frame('1:2', box(0, 0, 0, 0), [rectangle('1:3', box(0, 0, 0, 0), placedAt(childAt, 40, 20, boxAt))], {
        ...placedAt(boxAt, 160, 90, FRAME_AT),
      }),
    ])
    const nodes = layersOf(onlyFrame(text))
    expect(nodes['1-2']?.props.rotation).toBeCloseTo(30)
    expect(nodes['1-3']?.props.rotation).toBeCloseTo(15)
    expectDrawnAs(nodes, '1-2', boxAt, 160, 90)
    expectDrawnAs(nodes, '1-3', childAt, 40, 20)
  })

  it('turns a group as its matrix does, its layers drawn where Figma draws them', () => {
    const groupAt = multiply(FRAME_AT, turned(-40, 200, 100))
    const a = multiply(groupAt, turned(0, 0, 0))
    const b = multiply(groupAt, turned(10, 60, 30))
    const text = inFrame([
      node('GROUP', '1:2', box(0, 0, 0, 0), {
        ...placedAt(groupAt, 100, 60, FRAME_AT),
        children: [
          rectangle('1:3', box(0, 0, 0, 0), placedAt(a, 30, 30, FRAME_AT)),
          rectangle('1:4', box(0, 0, 0, 0), placedAt(b, 30, 20, FRAME_AT)),
        ],
      }),
    ])
    const nodes = layersOf(onlyFrame(text))
    expect(nodes['1-2']?.props.rotation).toBeCloseTo(-40)
    expectDrawnAs(nodes, '1-3', a, 30, 30)
    expectDrawnAs(nodes, '1-4', b, 30, 20)
  })
})
