import { describe, expect, it } from 'vitest'

import { box, frame, group, node, onePage, rectangle, solid, type TestNode } from './test-figma.ts'
import { childrenOf, imported, layersOf, linesOf, onlyFrame } from './test-import.ts'

const inFrame = (children: TestNode[], extra = {}) => onePage([frame('1:1', box(0, 0, 400, 300), children, extra)])
const rect = (id: string, extra: Record<string, unknown> = {}) => rectangle(id, box(0, 0, 40, 40), extra)
const itemsOf = (text: string) => imported(text).converted.report.items.map((i) => [i.line, i.count])

describe('settingsOf', () => {
  it('keeps whether a layer shows, its opacity and its lock, locking all five', () => {
    const nodes = layersOf(
      onlyFrame(inFrame([rect('1:2', { visible: false, opacity: 0.4, locked: true }), rect('1:3', { opacity: 1 })])),
    )
    expect(nodes['1-2']).toMatchObject({
      props: { visible: false, opacity: 0.4 },
      lock: { move: true, resize: true, content: true, style: true, delete: true },
    })
    expect(nodes['1-3']).toMatchObject({ props: { visible: true, opacity: 1 } })
    expect(nodes['1-3']).not.toHaveProperty('lock')
  })

  it('maps blend modes by name, pass-through a container’s own and a graphic’s normal', () => {
    const text = inFrame([
      rect('1:2', { blendMode: 'MULTIPLY' }),
      rect('1:3', { blendMode: 'COLOR_DODGE' }),
      rect('1:4', { blendMode: 'PASS_THROUGH' }),
      group('1:5', [rect('1:6', { blendMode: 'SOFT_LIGHT' })], { blendMode: 'PASS_THROUGH' }),
      group('1:7', [rect('1:8', { blendMode: 'LUMINOSITY' })], { blendMode: 'NORMAL' }),
      frame('1:9', box(0, 0, 40, 40), [], { blendMode: 'PASS_THROUGH' }),
      frame('1:10', box(0, 0, 40, 40), [], { blendMode: 'HARD_LIGHT' }),
    ])
    const nodes = layersOf(onlyFrame(text))
    const blends = Object.fromEntries(Object.entries(nodes).map(([id, n]) => [id, n.props.blendMode]))
    expect(blends).toEqual({
      '1-2': 'multiply',
      '1-3': 'color-dodge',
      '1-4': 'normal',
      '1-5': 'pass-through',
      '1-6': 'soft-light',
      '1-7': 'normal',
      '1-8': 'luminosity',
      '1-9': 'pass-through',
      '1-10': 'hard-light',
    })
    expect(itemsOf(text)).toEqual([])
  })

  it('draws linear burn and linear dodge normal, reported', () => {
    const text = inFrame([
      rect('1:2', { blendMode: 'LINEAR_BURN' }),
      group('1:3', [rect('1:4')], { blendMode: 'LINEAR_DODGE' }),
    ])
    const nodes = layersOf(onlyFrame(text))
    expect([nodes['1-2']?.props.blendMode, nodes['1-3']?.props.blendMode]).toEqual(['normal', 'normal'])
    expect(itemsOf(text)).toEqual([['linear-blend-modes', 2]])
  })
})

describe('transparencyOf', () => {
  it('gives a top-level frame’s opacity, blend mode and effects to the box that carries its look', () => {
    const f = onlyFrame(
      inFrame([rect('1:2')], {
        opacity: 0.5,
        blendMode: 'MULTIPLY',
        effects: [{ type: 'LAYER_BLUR', radius: 3, visible: true }],
      }),
    )
    const [inner] = f.layers?.roots ?? []
    expect(layersOf(f)[inner ?? '']?.props).toMatchObject({
      opacity: 0.5,
      blendMode: 'multiply',
      effects: [{ type: 'layerBlur', radius: 3 }],
    })
  })
})

describe('maskOf', () => {
  const maskThen = (mask: Record<string, unknown>) => inFrame([rect('1:2', { isMask: true, ...mask }), rect('1:3')])

  it('makes an alpha or vector mask alpha, and a luminance mask luminance', () => {
    const masks = ['ALPHA', 'VECTOR', 'LUMINANCE'].map(
      (maskType) => layersOf(onlyFrame(maskThen({ maskType, fills: [solid('#ffffff')] })))['1-2']?.props.mask,
    )
    expect(masks).toEqual(['alpha', 'alpha', 'luminance'])
    expect(linesOf(maskThen({ maskType: 'VECTOR', fills: [solid('#ffffff')] }))).toEqual([])
  })

  it('reports a vector mask with a blur, a gradient or a see-through paint, drawn as an alpha mask', () => {
    const gradient = {
      type: 'GRADIENT_LINEAR',
      gradientHandlePositions: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
      ],
      gradientStops: [
        { position: 0, color: { r: 1, g: 1, b: 1, a: 1 } },
        { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
      ],
    }
    const soft = [
      { fills: [gradient] },
      { fills: [{ ...solid('#ffffff'), opacity: 0.5 }] },
      { fills: [solid('#ffffff')], opacity: 0.5 },
      { fills: [solid('#ffffff')], effects: [{ type: 'LAYER_BLUR', radius: 4 }] },
    ]
    for (const extra of soft) expect(linesOf(maskThen({ maskType: 'VECTOR', ...extra }))).toContain('vector-masks')
  })
})

describe('constraintsOf', () => {
  it('maps a frame’s or box’s layer’s constraints by name, leaving out left and top', () => {
    const constrained = (id: string, horizontal: string, vertical: string) =>
      rect(id, { constraints: { horizontal, vertical } })
    const text = inFrame([
      constrained('1:2', 'RIGHT', 'BOTTOM'),
      constrained('1:3', 'LEFT_RIGHT', 'TOP_BOTTOM'),
      constrained('1:4', 'CENTER', 'SCALE'),
      constrained('1:5', 'SCALE', 'CENTER'),
      constrained('1:6', 'LEFT', 'TOP'),
      frame('1:7', box(0, 0, 100, 100), [constrained('1:8', 'RIGHT', 'TOP')]),
    ])
    const nodes = layersOf(onlyFrame(text))
    const constraints = Object.fromEntries(Object.entries(nodes).map(([id, n]) => [id, n.props.constraints]))
    expect(constraints).toEqual({
      '1-2': { horizontal: 'right', vertical: 'bottom' },
      '1-3': { horizontal: 'leftRight', vertical: 'topBottom' },
      '1-4': { horizontal: 'center', vertical: 'scale' },
      '1-5': { horizontal: 'scale', vertical: 'center' },
      '1-6': undefined,
      '1-7': undefined,
      '1-8': { horizontal: 'right', vertical: 'top' },
    })
  })

  it('leaves them out in a group, in a Mask group and outside frames', () => {
    const right = { constraints: { horizontal: 'RIGHT', vertical: 'BOTTOM' } }
    const grouped = layersOf(onlyFrame(inFrame([group('1:2', [rect('1:3', right)])])))
    expect(grouped['1-3']?.props.constraints).toBeUndefined()
    const masked = layersOf(
      onlyFrame(
        inFrame([
          rect('1:2', { ...right, isMask: true }),
          rect('1:3', right),
          rect('1:4', { ...right, isMask: true }),
          rect('1:5', right),
        ]),
      ),
    )
    const inner = childrenOf(masked, 'root')[2] as string
    expect(childrenOf(masked, inner)).toEqual(['1-4', '1-5'])
    expect([masked['1-2'], masked['1-3']].map((n) => n?.props.constraints)).toEqual([
      { horizontal: 'right', vertical: 'bottom' },
      { horizontal: 'right', vertical: 'bottom' },
    ])
    expect([masked['1-4'], masked['1-5']].map((n) => n?.props.constraints)).toEqual([undefined, undefined])
    const loose = onePage([rect('1:2', right), node('FRAME', '1:3', box(500, 0, 50, 50), { children: [] })])
    const outside = imported(loose).converted.pages[0]?.frames.find((f) => f.name === 'Outside frames')
    expect(outside?.layers?.nodes['1-2']?.props.constraints).toBeUndefined()
  })
})
