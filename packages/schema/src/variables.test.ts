import { describe, expect, it } from 'vitest'

import { type Design, fontFamilies, parseDesign } from './design.ts'
import {
  BINDABLE_PROPERTIES,
  bindablePropertyOf,
  Bindings,
  bindProps,
  boundValueOf,
  BrandToken,
  canBind,
  fitsProperty,
  valueKindOf,
  VariableRef,
} from './variables.ts'

const red = '#E0262BFF'
const navy = '#14213DFF'
const white = '#FFFFFFFF'
const TYPES = ['graphic', 'box', 'boolean', 'text', 'group']
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

  it('reads and writes the picture of the topmost image fill that shows, keeping its settings and dropping a crop', () => {
    const { image } = BINDABLE_PROPERTIES
    const adjust = { exposure: 10, contrast: 0, saturation: 0, temperature: 0, tint: 0 }
    const crop = { x: 4, y: 4, width: 20, height: 10 }
    const props = {
      fills: [
        { type: 'image', assetId: 'under', fit: 'fill', opacity: 1 },
        { type: 'image', assetId: 'old-logo', fit: 'crop', crop, opacity: 0.8, adjust, filter: 'mono' },
        { type: 'solid', color: red },
        { type: 'image', assetId: 'hidden', fit: 'fill', opacity: 1, visible: false },
      ],
    }
    expect(image.read(props)).toBe('old-logo')
    expect(image.write(props, 'new-logo').fills).toEqual([
      props.fills[0],
      { type: 'image', assetId: 'new-logo', fit: 'fit', opacity: 0.8, adjust, filter: 'mono' },
      props.fills[2],
      props.fills[3],
    ])
    // The same picture again keeps its crop.
    expect(image.write(props, 'old-logo')).toBe(props)
    const tiled = { fills: [{ type: 'image', assetId: 'a', fit: 'tile', tileScale: 0.5, opacity: 1 }] }
    expect(image.write(tiled, 'b').fills).toEqual([
      { type: 'image', assetId: 'b', fit: 'tile', tileScale: 0.5, opacity: 1 },
    ])
  })

  it('reads no picture and writes nothing without an image fill that shows', () => {
    const { image } = BINDABLE_PROPERTIES
    const props = {
      fills: [
        { type: 'solid', color: red },
        { type: 'image', assetId: 'hidden', fit: 'fill', opacity: 1, visible: false },
      ],
    }
    expect(image.read(props)).toBeUndefined()
    expect(image.write(props, 'logo')).toBe(props)
    expect(image.read({})).toBeUndefined()
  })
})

describe('Bindings', () => {
  it('holds a binding for each bindable property, and no other', () => {
    expect(Object.keys(Bindings.shape)).toEqual(Object.keys(BINDABLE_PROPERTIES))
    expect(Object.keys(Bindings.shape)).toEqual(['fill', 'textColor', 'fontFamily', 'image'])
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
    expect(TYPES.filter((type) => canBind(type, 'fill'))).toEqual(['graphic', 'box', 'boolean'])
    for (const property of ['textColor', 'fontFamily'] as const)
      expect(TYPES.filter((type) => canBind(type, property))).toEqual(['text'])
    expect(TYPES.filter((type) => canBind(type, 'image'))).toEqual(['graphic', 'box'])
  })
})

describe('valueKindOf', () => {
  it('says why a value is not of the kind a property takes', () => {
    expect(valueKindOf('fill').unfit).toBe('colours are #RRGGBBAA')
    expect(valueKindOf('textColor').unfit).toBe('colours are #RRGGBBAA')
    expect(valueKindOf('fontFamily').unfit).toBe('a font family needs a name')
    expect(valueKindOf('image').unfit).toBe('a picture is an asset’s id')
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
    expect(fitsProperty('image', 'logo-1')).toBe(true)
    expect(fitsProperty('image', 'a logo')).toBe(false)
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

  it('gives a graphic or box its picture', () => {
    expect(bindablePropertyOf('graphic', 'image')).toBe('image')
    expect(bindablePropertyOf('box', 'image')).toBe('image')
    expect(bindablePropertyOf('boolean', 'image')).toBeUndefined()
    expect(bindablePropertyOf('text', 'image')).toBeUndefined()
  })
})

describe('boundValueOf', () => {
  it('reads the value of a kind a layer holds: a graphic’s picture or fill colour, a text’s colour or font', () => {
    const fills = [
      { type: 'solid', color: red },
      { type: 'image', assetId: 'logo-1', fit: 'fit', opacity: 1 },
    ]
    expect(boundValueOf('graphic', { fills }, 'image')).toBe('logo-1')
    expect(boundValueOf('graphic', { fills }, 'color')).toBe(red)
    expect(boundValueOf('graphic', { fills: [] }, 'image')).toBeUndefined()
    expect(boundValueOf('text', textProps, 'font')).toBe('Noto Sans')
    expect(boundValueOf('text', textProps, 'image')).toBeUndefined()
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

  it('sets the topmost image fill from the brand logo, and keeps the stored one without a value', () => {
    const props = { fills: [{ type: 'image', assetId: 'old-logo', fit: 'fit', opacity: 1 }] }
    const bound = bindProps('graphic', props, { image: 'brand:logo' }, { 'brand:logo': 'new-logo' })
    expect(bound.fills).toEqual([{ type: 'image', assetId: 'new-logo', fit: 'fit', opacity: 1 }])
    expect(bindProps('graphic', props, { image: 'brand:logo' }, { 'brand:primary': red })).toBe(props)
    expect(bindProps('graphic', props, { image: 'brand:logo' }, { 'brand:logo': red })).toBe(props)
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
