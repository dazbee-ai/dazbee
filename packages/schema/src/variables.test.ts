import { describe, expect, it } from 'vitest'

import { type Design, fontFamilies, parseDesign } from './design.ts'
import {
  BINDABLE_PROPERTIES,
  bindablePropertyOf,
  Bindings,
  bindProps,
  BrandToken,
  canBind,
  fitsProperty,
  VariableRef,
} from './variables.ts'

const red = '#E0262BFF'
const navy = '#14213DFF'
const white = '#FFFFFFFF'
/** A text's base style, with a run that keeps its own colour and font. */
const textProps = {
  style: { fontFamily: 'Noto Sans', color: navy, fontSize: 40 },
  runs: [{ start: 0, end: 2, style: { color: '#00FF00FF', fontFamily: 'Inter' } }],
}

describe('BrandToken', () => {
  it('names tokens as lowercase words and refs as brand:<token>', () => {
    expect(BrandToken.safeParse('sale-red').success).toBe(true)
    expect(BrandToken.safeParse('Sale Red').success).toBe(false)
    expect(VariableRef.safeParse('brand:primary').success).toBe(true)
    expect(VariableRef.safeParse('brand:').success).toBe(false)
    expect(VariableRef.safeParse('theme:primary').success).toBe(false)
  })
})

describe('BINDABLE_PROPERTIES', () => {
  it('reads and writes the colour of the topmost solid fill that shows', () => {
    const { fill } = BINDABLE_PROPERTIES
    const props = {
      opacity: 1,
      fills: [
        { type: 'solid', color: navy },
        { type: 'image', imageId: 'i' },
        { type: 'solid', color: white, opacity: 0.5 },
        { type: 'solid', color: red, visible: false },
      ],
    }
    expect(fill.read(props)).toBe(white)
    expect(fill.write(props, red)).toEqual({
      opacity: 1,
      fills: [
        { type: 'solid', color: navy },
        { type: 'image', imageId: 'i' },
        { type: 'solid', color: red, opacity: 0.5 },
        { type: 'solid', color: red, visible: false },
      ],
    })
  })

  it('reads no fill colour and writes nothing without a solid fill that shows', () => {
    const { fill } = BINDABLE_PROPERTIES
    const props = {
      fills: [
        { type: 'image', imageId: 'i' },
        { type: 'solid', color: red, visible: false },
      ],
    }
    expect(fill.read(props)).toBeUndefined()
    expect(fill.write(props, navy)).toBe(props)
    expect(fill.read({ fills: [] })).toBeUndefined()
    expect(fill.read({})).toBeUndefined()
  })

  it('reads and writes a text colour and font family on the base style, never its runs', () => {
    const { textColor, fontFamily } = BINDABLE_PROPERTIES
    expect(textColor.read(textProps)).toBe(navy)
    expect(fontFamily.read(textProps)).toBe('Noto Sans')
    const coloured = textColor.write(textProps, red)
    expect(coloured).toEqual({ ...textProps, style: { fontFamily: 'Noto Sans', color: red, fontSize: 40 } })
    expect(coloured.runs).toBe(textProps.runs)
    expect(fontFamily.write(textProps, 'Playfair Display').style).toEqual({
      fontFamily: 'Playfair Display',
      color: navy,
      fontSize: 40,
    })
  })
})

describe('Bindings', () => {
  it('holds a binding for each bindable property, and no other', () => {
    expect(Object.keys(Bindings.shape)).toEqual(Object.keys(BINDABLE_PROPERTIES))
    expect(Object.keys(Bindings.shape)).toEqual(['fill', 'textColor', 'fontFamily'])
    expect(Bindings.parse({ fill: 'brand:primary', stroke: 'brand:accent' })).toEqual({ fill: 'brand:primary' })
  })

  it('stores bindings on a layer, and fontFamilies adds the bound brand family', () => {
    const json = {
      meta: { designId: 'd', name: 'Kit' },
      pages: { p1: { name: 'Page 1', order: 'a0' } },
      frames: {
        sq: { pageId: 'p1', name: 'Square', width: 100, height: 100, x: 0, y: 0, fills: [], order: 'a0' },
      },
      nodes: {
        t: {
          type: 'text',
          parentId: 'sq',
          link: 't',
          index: 'a0',
          name: 'T',
          bindings: { fontFamily: 'brand:heading' },
          props: {
            x: 0,
            y: 0,
            width: 10,
            height: 10,
            text: 'Hi',
            style: { fontFamily: 'Noto Sans', fontSize: 10, color: navy },
          },
        },
      },
    }
    const parsed = parseDesign(json)
    if (!parsed.success) throw new Error(parsed.errors.join('\n'))
    const design: Design = parsed.design
    expect(design.nodes.t?.bindings).toEqual({ fontFamily: 'brand:heading' })
    expect(fontFamilies(design)).toEqual(['Noto Sans'])
    expect(fontFamilies(design, { 'brand:heading': 'Playfair Display' })).toEqual(['Playfair Display'])
    expect(fontFamilies(design, { 'brand:heading': ' ' })).toEqual(['Noto Sans'])
    expect(
      parseDesign({ ...json, nodes: { t: { ...json.nodes.t, bindings: { fontFamily: 'brand:Heading' } } } }).success,
    ).toBe(false)
  })
})

describe('canBind', () => {
  it('lets only the layer types that have a property bind it', () => {
    expect(['graphic', 'box', 'boolean', 'text', 'group'].filter((type) => canBind(type, 'fill'))).toEqual([
      'graphic',
      'box',
      'boolean',
    ])
    for (const property of ['textColor', 'fontFamily'] as const)
      expect(['graphic', 'box', 'boolean', 'text', 'group'].filter((type) => canBind(type, property))).toEqual(['text'])
  })
})

describe('fitsProperty', () => {
  it('takes a colour for a fill or text colour, and a family name that is not blank for a font', () => {
    expect(fitsProperty('fill', red)).toBe(true)
    expect(fitsProperty('textColor', red)).toBe(true)
    expect(fitsProperty('fill', 'red')).toBe(false)
    expect(fitsProperty('textColor', 'Inter')).toBe(false)
    expect(fitsProperty('fontFamily', 'Playfair Display')).toBe(true)
    expect(fitsProperty('fontFamily', ' ')).toBe(false)
  })
})

describe('bindablePropertyOf', () => {
  it('gives a text its colour and font, and a shape its fill', () => {
    expect(bindablePropertyOf('text', 'color')).toBe('textColor')
    expect(bindablePropertyOf('text', 'font')).toBe('fontFamily')
    for (const type of ['graphic', 'box', 'boolean']) {
      expect(bindablePropertyOf(type, 'color')).toBe('fill')
      expect(bindablePropertyOf(type, 'font')).toBeUndefined()
    }
    expect(bindablePropertyOf('group', 'color')).toBeUndefined()
  })
})

describe('bindProps', () => {
  it('sets the topmost solid fill from the brand colour, and keeps the stored one without a value', () => {
    const props = { fills: [{ type: 'solid', color: navy }, { type: 'linear' }, { type: 'solid', color: '#FFFFFFFF' }] }
    for (const type of ['graphic', 'box', 'boolean']) {
      const bound = bindProps(type, props, { fill: 'brand:primary' }, { 'brand:primary': red })
      expect(bound.fills).toEqual([{ type: 'solid', color: navy }, { type: 'linear' }, { type: 'solid', color: red }])
    }
    expect(bindProps('group', props, { fill: 'brand:primary' }, { 'brand:primary': red })).toBe(props)
    // No value for the token, no variables at all, or a value that isn't a colour: as stored.
    expect(bindProps('graphic', props, { fill: 'brand:primary' }, { 'brand:accent': red })).toBe(props)
    expect(bindProps('graphic', props, { fill: 'brand:primary' }, undefined)).toBe(props)
    expect(bindProps('graphic', props, { fill: 'brand:primary' }, { 'brand:primary': 'Inter' })).toBe(props)
  })

  it('sets text colour and font family on the base style only', () => {
    const props = {
      style: { fontFamily: 'Noto Sans', color: navy, fontSize: 40 },
      runs: [{ start: 0, end: 2, style: { color: '#00FF00FF' } }],
    }
    const bound = bindProps(
      'text',
      props,
      { textColor: 'brand:primary', fontFamily: 'brand:heading' },
      { 'brand:primary': red, 'brand:heading': 'Playfair Display' },
    )
    expect(bound.style).toEqual({ fontFamily: 'Playfair Display', color: red, fontSize: 40 })
    expect(bound.runs).toBe(props.runs)
    // A text layer has no fill to bind, a graphic no text.
    expect(bindProps('text', props, { fill: 'brand:primary' }, { 'brand:primary': red })).toBe(props)
  })
})
