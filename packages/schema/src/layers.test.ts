import { describe, expect, it } from 'vitest'

import { AutoLayout, Constraints, gridColumns, Layer, layoutOf, ratioLocked, UnplacedLayer } from './layers.ts'

describe('Constraints', () => {
  it('takes five each way, both axes in one value', () => {
    for (const horizontal of ['left', 'right', 'leftRight', 'center', 'scale'] as const)
      for (const vertical of ['top', 'bottom', 'topBottom', 'center', 'scale'] as const)
        expect(Constraints.parse({ horizontal, vertical })).toEqual({ horizontal, vertical })
  })

  it('refuses a value outside the enums, or an axis left out, naming it', () => {
    const paths = (value: unknown) => Constraints.safeParse(value).error?.issues.map((i) => i.path.join('.')) ?? []
    expect(paths({ horizontal: 'top', vertical: 'top' })).toEqual(['horizontal'])
    expect(paths({ horizontal: 'left', vertical: 'leftRight' })).toEqual(['vertical'])
    expect(paths({ horizontal: 'left' })).toEqual(['vertical'])
  })
})

describe('AutoLayout', () => {
  it('keeps wrap, the gap between lines and how lines spread, and leaves each out when not set', () => {
    const parsed = AutoLayout.parse({ direction: 'row', gap: 8, wrap: true, lineGap: -4, alignLines: 'space-between' })
    expect(parsed).toMatchObject({ direction: 'row', gap: 8, wrap: true, lineGap: -4, alignLines: 'space-between' })
    const plain = AutoLayout.parse({ direction: 'row' })
    for (const key of ['wrap', 'lineGap', 'alignLines']) expect(plain).not.toHaveProperty(key)
  })

  it('refuses lines spread any other way', () => {
    expect(AutoLayout.safeParse({ direction: 'row', alignLines: 'center' }).success).toBe(false)
  })

  it('takes a grid of 1 to 12 columns', () => {
    for (const columns of [1, 2, 5, 12])
      expect(AutoLayout.parse({ direction: 'grid', columns })).toMatchObject({ columns })
    expect(AutoLayout.parse({ direction: 'grid' })).not.toHaveProperty('columns')
  })

  it('refuses 0, 13 and part columns', () => {
    for (const columns of [0, 13, 2.5]) expect(AutoLayout.safeParse({ direction: 'grid', columns }).success).toBe(false)
  })
})

describe('gridColumns', () => {
  it('reads a grid that sets no columns as 2', () => {
    expect(gridColumns({})).toBe(2)
    expect(gridColumns({ columns: 4 })).toBe(4)
  })
})

describe('layoutOf', () => {
  it('reads a box with no layout as Free, else its direction', () => {
    expect(layoutOf({})).toBe('free')
    expect(layoutOf({ layout: { direction: 'row' } })).toBe('row')
    expect(layoutOf({ layout: { direction: 'column' } })).toBe('column')
    expect(layoutOf({ layout: { direction: 'grid' } })).toBe('grid')
  })
})

describe('Layer', () => {
  const place = { parentId: 'sq', link: 'l', index: 'a0', name: 'L' }
  const box = { x: 0, y: 0, width: 10, height: 10 }
  const text = { ...box, text: 'Hi', style: { fontFamily: 'Noto Sans', fontSize: 12, color: '#000000FF' } }
  const shape = { ...box, shape: { kind: 'rect' } }

  it('reads a text stored without a wrap style as Auto, keeps Balance and Pretty, and refuses any other', () => {
    const wrapOf = (props: object) => {
      const layer = Layer.parse({ ...place, id: 't', type: 'text', props })
      return layer.type === 'text' ? layer.props.wrapStyle : undefined
    }
    expect(wrapOf(text)).toBe('auto')
    expect(wrapOf({ ...text, wrapStyle: 'balance' })).toBe('balance')
    expect(wrapOf({ ...text, wrapStyle: 'pretty' })).toBe('pretty')
    expect(Layer.safeParse({ ...place, id: 't', type: 'text', props: { ...text, wrapStyle: 'even' } }).success).toBe(
      false,
    )
  })

  it('keeps a graphic, text, box or boolean flipped on either axis, and leaves it out when not; a group never', () => {
    for (const [type, props] of [
      ['graphic', shape],
      ['text', text],
      ['box', box],
      ['boolean', box],
    ] as const) {
      expect(Layer.parse({ ...place, type, props: { ...props, flipX: true } }).props).toMatchObject({ flipX: true })
      expect(Layer.parse({ ...place, type, props: { ...props, flipY: true } }).props).toMatchObject({ flipY: true })
      const plain = Layer.parse({ ...place, type, props }).props
      expect(plain).not.toHaveProperty('flipX')
      expect(plain).not.toHaveProperty('flipY')
    }
    const group = Layer.parse({ ...place, type: 'group', props: { ...box, flipX: true, flipY: true } }).props
    expect(group).not.toHaveProperty('flipX')
    expect(group).not.toHaveProperty('flipY')
  })

  it('keeps Lock ratio on a graphic, text or box, and leaves it out when off; a group or boolean has none', () => {
    for (const [type, props] of [
      ['graphic', shape],
      ['text', text],
      ['box', box],
    ] as const) {
      expect(Layer.parse({ ...place, type, props: { ...props, lockRatio: true } }).props).toMatchObject({
        lockRatio: true,
      })
      expect(Layer.parse({ ...place, type, props }).props).not.toHaveProperty('lockRatio')
    }
    for (const type of ['group', 'boolean'] as const)
      expect(Layer.parse({ ...place, type, props: { ...box, lockRatio: true } }).props).not.toHaveProperty('lockRatio')
  })

  it('reads Lock ratio as on only where it is true', () => {
    expect(ratioLocked({ lockRatio: true })).toBe(true)
    expect(ratioLocked({ lockRatio: false })).toBe(false)
    expect(ratioLocked({ width: 10 })).toBe(false)
  })

  it('keeps the least and most width and height of a graphic, text or box, crossed or not; a group or boolean has none', () => {
    const limits = { minWidth: 300, maxWidth: 200, minHeight: 0, maxHeight: 40 }
    for (const [type, props] of [
      ['graphic', shape],
      ['text', text],
      ['box', box],
    ] as const) {
      expect(Layer.parse({ ...place, type, props: { ...props, ...limits } }).props).toMatchObject(limits)
      const plain = Layer.parse({ ...place, type, props }).props
      for (const key of Object.keys(limits)) expect(plain).not.toHaveProperty(key)
      expect(Layer.safeParse({ ...place, type, props: { ...props, maxWidth: -1 } }).success).toBe(false)
    }
    for (const type of ['group', 'boolean'] as const)
      expect(Layer.parse({ ...place, type, props: { ...box, ...limits } }).props).not.toHaveProperty('maxWidth')
  })

  it('keeps the constraints of a layer of any type as set, and leaves them out when none are', () => {
    const constraints = { horizontal: 'right', vertical: 'center' }
    for (const [type, props] of [
      ['graphic', shape],
      ['text', text],
      ['box', box],
      ['group', box],
      ['boolean', box],
    ] as const) {
      expect(Layer.parse({ ...place, type, props: { ...props, constraints } }).props).toMatchObject({ constraints })
      expect(Layer.parse({ ...place, type, props }).props).not.toHaveProperty('constraints')
    }
    const wrong = Layer.safeParse({ ...place, type: 'box', props: { ...box, constraints: { horizontal: 'up' } } })
    expect(wrong.error?.issues.map((i) => i.path.join('.'))).toEqual([
      'props.constraints.horizontal',
      'props.constraints.vertical',
    ])
  })
})

describe('UnplacedLayer', () => {
  const shape = {
    type: 'graphic',
    name: 'Shape',
    props: { x: 0, y: 0, width: 10, height: 10, shape: { kind: 'rect' } },
  }

  it('is a layer without its parent, link id and index: given them, it is the layer', () => {
    const unplaced = UnplacedLayer.parse({ ...shape, role: 'badge', lock: { move: true } })
    expect(unplaced).not.toHaveProperty('parentId')
    expect(unplaced.props).toMatchObject({ rotation: 0, visible: true, fills: [] })
    const place = { parentId: 'sq', link: 'shape', index: 'a0' }
    expect(Layer.parse({ ...unplaced, ...place })).toEqual(
      Layer.parse({ ...shape, ...place, role: 'badge', lock: { move: true } }),
    )
  })

  it('refuses what a layer of its type does not take', () => {
    const issues = (layer: unknown) =>
      UnplacedLayer.safeParse(layer).error?.issues.map((issue) => issue.path.join('.')) ?? []
    expect(issues({ ...shape, props: { ...shape.props, width: -1 } })).toEqual(['props.width'])
    expect(issues({ ...shape, type: 'text' })).toEqual(['props.text', 'props.style'])
    expect(issues({ ...shape, type: 'shape' })).toEqual(['type'])
  })
})
