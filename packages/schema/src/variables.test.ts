import { describe, expect, it } from 'vitest'

import { type Design, parseDesign } from './design.ts'
import { fontUses } from './font-uses.ts'
import {
  BINDABLE_PROPERTIES,
  bindablePropertyOf,
  Bindings,
  bindProps,
  boundValueOf,
  BrandToken,
  canBind,
  fitsProperty,
  overlappingBindings,
  type TextLook,
  VALUE_KINDS,
  valueKindOf,
  VariableRef,
  type Variables,
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
/** A brand text style's look, as the kit gives it. */
const headline: TextLook = {
  fontFamily: 'Playfair Display',
  fontWeight: 700,
  fontStyle: 'italic',
  lineHeight: 1.1,
  letterSpacing: { unit: 'percent', value: -1 },
  textCase: 'upper',
}
/** A look without one of the settings a look may leave out. */
function without(look: TextLook, key: 'fontFamily' | 'lineHeight' | 'textCase'): TextLook {
  return Object.fromEntries(Object.entries(look).filter(([k]) => k !== key)) as TextLook
}
/** A text in its own look, with a run of its own weight. */
const lookProps = {
  style: {
    fontFamily: 'Noto Sans',
    fontWeight: 400,
    fontStyle: 'normal',
    fontSize: 40,
    color: navy,
    lineHeight: 1.4,
    letterSpacing: { unit: 'percent', value: 0 },
    underline: true,
  },
  runs: [{ start: 0, end: 2, style: { fontWeight: 900 } }],
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

describe('VALUE_KINDS', () => {
  it('takes a colour whose hex digits differ only in case as the same', () => {
    expect(VALUE_KINDS.color.same(red, red.toLowerCase())).toBe(true)
    expect(VALUE_KINDS.color.same(red, navy)).toBe(false)
    expect(VALUE_KINDS.font.same('Inter', 'inter')).toBe(false)
  })

  it('compares looks whole, a case of none as none at all, and a family only where both name one', () => {
    const { textLook } = VALUE_KINDS
    const noFamily = without(headline, 'fontFamily')
    const ownLineHeight = without(headline, 'lineHeight')
    const noCase = without(headline, 'textCase')
    expect(textLook.same(headline, { ...headline, letterSpacing: { unit: 'percent', value: -1 } })).toBe(true)
    expect(textLook.same(headline, { ...headline, fontWeight: 600 })).toBe(false)
    expect(textLook.same(headline, { ...headline, letterSpacing: { unit: 'px', value: -1 } })).toBe(false)
    expect(textLook.same(headline, ownLineHeight)).toBe(false)
    expect(textLook.same(headline, { ...headline, fontFamily: 'Inter' })).toBe(false)
    expect(textLook.same(headline, noFamily)).toBe(true)
    expect(textLook.same({ ...headline, textCase: 'none' }, noCase)).toBe(true)
    expect(textLook.same(headline, undefined)).toBe(false)
    expect(textLook.same(undefined, undefined)).toBe(true)
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

  it('reads no text colour while a gradient shows, and writing one takes the gradient off', () => {
    const { textColor } = BINDABLE_PROPERTIES
    const gradient = {
      type: 'linear',
      from: { x: 0, y: 0 },
      to: { x: 1, y: 0 },
      stops: [
        { offset: 0, color: red },
        { offset: 1, color: white },
      ],
    }
    const swept = { ...textProps, style: { ...textProps.style, gradient } }
    expect(textColor.read(swept)).toBeUndefined()
    const hidden = { ...textProps, style: { ...textProps.style, gradient: { ...gradient, visible: false } } }
    expect(textColor.read(hidden)).toBe(navy)
    expect(textColor.write(swept, navy).style).toEqual(textProps.style)
    expect(textColor.write(swept, red).style).toEqual({ ...textProps.style, color: red })
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

  it('reads a text’s look from its base style, never its runs', () => {
    expect(BINDABLE_PROPERTIES.textStyle.read(lookProps)).toEqual({
      fontFamily: 'Noto Sans',
      fontWeight: 400,
      fontStyle: 'normal',
      lineHeight: 1.4,
      letterSpacing: { unit: 'percent', value: 0 },
    })
    expect(BINDABLE_PROPERTIES.textStyle.read({})).toBeUndefined()
  })

  it('writes a look into the base style, keeping its size, colour and the rest, and its runs', () => {
    const written = BINDABLE_PROPERTIES.textStyle.write(lookProps, headline)
    expect(written.style).toEqual({ ...lookProps.style, ...headline })
    expect(written.runs).toBe(lookProps.runs)
  })

  it('takes out a line height or case the look leaves out, and keeps the family when it names none', () => {
    const cased = { style: { ...lookProps.style, textCase: 'title' } }
    const plain: TextLook = { fontWeight: 300, fontStyle: 'normal', letterSpacing: { unit: 'px', value: 2 } }
    expect(BINDABLE_PROPERTIES.textStyle.write(cased, plain).style).toEqual({
      fontFamily: 'Noto Sans',
      fontWeight: 300,
      fontStyle: 'normal',
      fontSize: 40,
      color: navy,
      letterSpacing: { unit: 'px', value: 2 },
      underline: true,
    })
  })

  it('gives back the same props when the text shows the look already', () => {
    const shown = BINDABLE_PROPERTIES.textStyle.write(lookProps, headline)
    const noFamily = without(headline, 'fontFamily')
    expect(BINDABLE_PROPERTIES.textStyle.write(shown, headline)).toBe(shown)
    expect(BINDABLE_PROPERTIES.textStyle.write(shown, noFamily)).toBe(shown)
  })
})

describe('Bindings', () => {
  it('holds a binding for each bindable property, and no other', () => {
    expect(Object.keys(Bindings.shape)).toEqual(Object.keys(BINDABLE_PROPERTIES))
    expect(Object.keys(Bindings.shape)).toEqual(['fill', 'textColor', 'fontFamily', 'image', 'textStyle'])
    expect(Bindings.parse({ fill: 'brand:primary', stroke: 'brand:accent' })).toEqual({ fill: 'brand:primary' })
  })

  it('stores bindings on a layer, and fontUses gives the bound brand family', () => {
    const fontFamilies = (drawn: Design, variables?: Variables) => [
      ...new Set(fontUses(drawn, variables).map((use) => use.family)),
    ]
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
    const styled = parseDesign({
      ...json,
      nodes: { t: { ...json.nodes.t, bindings: { textStyle: 'brand:headline' } } },
    })
    if (!styled.success) throw new Error(styled.errors.join('\n'))
    expect(fontFamilies(styled.design, { 'brand:headline': headline })).toEqual(['Playfair Display'])
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
    expect(TYPES.filter((type) => canBind(type, 'textStyle'))).toEqual(['text'])
  })
})

describe('valueKindOf', () => {
  it('says why a value is not of the kind a property takes', () => {
    expect(valueKindOf('fill').unfit).toBe('colours are #RRGGBBAA')
    expect(valueKindOf('textColor').unfit).toBe('colours are #RRGGBBAA')
    expect(valueKindOf('fontFamily').unfit).toBe('a font family needs a name')
    expect(valueKindOf('image').unfit).toBe('a picture is an asset’s id')
    expect(valueKindOf('textStyle').unfit).toBe(
      'a text style’s look is a weight, a slant and a letter spacing, with a family, line height and case where it sets them',
    )
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

  it('takes a look for a text style, and a look for nothing else', () => {
    const noFamily = without(headline, 'fontFamily')
    expect(fitsProperty('textStyle', headline)).toBe(true)
    expect(fitsProperty('textStyle', noFamily)).toBe(true)
    expect(fitsProperty('textStyle', { ...headline, fontFamily: ' ' })).toBe(false)
    expect(fitsProperty('textStyle', { ...headline, fontWeight: 950 })).toBe(false)
    expect(fitsProperty('textStyle', 'Playfair Display')).toBe(false)
    expect(fitsProperty('fontFamily', headline)).toBe(false)
    expect(fitsProperty('fill', headline)).toBe(false)
  })
})

describe('overlappingBindings', () => {
  it('names the bindings a binding writes over: a text style and a font family each set the family', () => {
    expect(overlappingBindings('textStyle')).toEqual(['fontFamily'])
    expect(overlappingBindings('fontFamily')).toEqual(['textStyle'])
    expect(overlappingBindings('textColor')).toEqual([])
    expect(overlappingBindings('fill')).toEqual([])
    expect(overlappingBindings('image')).toEqual([])
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

  it('gives a text its text style', () => {
    expect(bindablePropertyOf('text', 'textLook')).toBe('textStyle')
    expect(bindablePropertyOf('box', 'textLook')).toBeUndefined()
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

  it('sets a text’s look from its brand text style, keeping its size, and keeps the stored one without a value', () => {
    const bound = bindProps('text', lookProps, { textStyle: 'brand:headline' }, { 'brand:headline': headline })
    expect(bound.style).toEqual({ ...lookProps.style, ...headline })
    expect(bindProps('text', lookProps, { textStyle: 'brand:headline' }, { 'brand:headline': 'Inter' })).toBe(lookProps)
    expect(bindProps('text', lookProps, { fontFamily: 'brand:headline' }, { 'brand:headline': headline })).toBe(
      lookProps,
    )
  })

  it('draws a text bound to a text style and a font in the style’s family', () => {
    const bound = bindProps(
      'text',
      lookProps,
      { fontFamily: 'brand:body', textStyle: 'brand:headline' },
      { 'brand:body': 'Inter', 'brand:headline': headline },
    )
    expect(bound.style.fontFamily).toBe('Playfair Display')
  })
})
