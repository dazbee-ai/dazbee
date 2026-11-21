// Variables a layer's properties follow, and the list of bindable properties. For now the variables
// are the brand kit's tokens, named `brand:<token>`: a brand's colours, fonts, logo and text styles,
// which a layer binds its fill, its text colour, its font family, its picture or its text's look to,
// so changing the brand colour changes every design that uses it. Everything that binds reads the list.
import { z } from 'zod'

import type { LayerType } from './layers.ts'
import { boundFillIndex, boundImageIndex, type Paint } from './paint.ts'
import { AssetId, Color } from './primitives.ts'
import { type LetterSpacing, shownGradient, textStyleFields } from './typography.ts'

/** A brand kit token's name: lowercase words joined by hyphens, such as `primary` or `sale-red`. */
export const BrandToken = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'a token is lowercase words joined by hyphens')
  .max(40)
export type BrandToken = z.infer<typeof BrandToken>

/** What a bound property follows: a brand kit token, `brand:<token>`. */
export const VariableRef = z.templateLiteral(['brand:', BrandToken])
export type VariableRef = z.infer<typeof VariableRef>

/**
 * A text's look, as a brand text style gives it: a weight, a slant and a letter spacing, a line
 * height (left out: the font's own) and a case (left out: as typed), and a family, left out while
 * the kit font the style follows is not set, which keeps the text's own. It holds no size.
 */
export const TextLook = z.object({
  fontFamily: textStyleFields.fontFamily.optional(),
  fontWeight: textStyleFields.fontWeight,
  fontStyle: textStyleFields.fontStyle,
  lineHeight: textStyleFields.lineHeight.optional(),
  letterSpacing: textStyleFields.letterSpacing,
  textCase: textStyleFields.textCase.optional(),
})
export type TextLook = z.infer<typeof TextLook>

/** A variable's value: a colour (#RRGGBBAA), a font family, an image asset's id or a text's look. */
export type VariableValue = string | TextLook

/** The keys of a text's base style a look sets. */
const LOOK_KEYS = ['fontFamily', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'textCase'] as const

/** Whether two looks are one, compared whole: a case of none is none at all, and a family counts where both name one. */
function sameLook(a: unknown, b: unknown): boolean {
  if (a === undefined || b === undefined) return a === b
  const x = a as Partial<TextLook>
  const y = b as Partial<TextLook>
  const spacing = (s: LetterSpacing | undefined) => (s ? `${s.unit}:${s.value}` : undefined)
  const textCase = (look: Partial<TextLook>) => (look.textCase === 'none' ? undefined : look.textCase)
  return (
    (x.fontFamily === undefined || y.fontFamily === undefined || x.fontFamily === y.fontFamily) &&
    x.fontWeight === y.fontWeight &&
    x.fontStyle === y.fontStyle &&
    x.lineHeight === y.lineHeight &&
    spacing(x.letterSpacing) === spacing(y.letterSpacing) &&
    textCase(x) === textCase(y)
  )
}

/**
 * The kinds of value a bindable property takes, each with the values that fit it, what to say of
 * one that doesn't, and when two values are one, as the rule that a hand edit ends a binding
 * compares them.
 */
export const VALUE_KINDS = {
  /** A colour as the schema takes it; hex digits in either case are one colour. */
  color: {
    fits: (value: unknown) => Color.safeParse(value).success,
    unfit: 'colours are #RRGGBBAA',
    same: (a: unknown, b: unknown) =>
      typeof a === 'string' && typeof b === 'string' ? a.toUpperCase() === b.toUpperCase() : a === b,
  },
  /** A font family's name that isn't blank. */
  font: {
    fits: (value: unknown) => typeof value === 'string' && value.trim().length > 0,
    unfit: 'a font family needs a name',
    same: (a: unknown, b: unknown) => a === b,
  },
  /** A picture: the id of an image asset. */
  image: {
    fits: (value: unknown) => AssetId.safeParse(value).success,
    unfit: 'a picture is an asset’s id',
    same: (a: unknown, b: unknown) => a === b,
  },
  /** A text's look, compared whole: a case of none is none at all, and a family counts where both name one. */
  textLook: {
    fits: (value: unknown) => {
      const look = TextLook.safeParse(value)
      return look.success && (look.data.fontFamily === undefined || look.data.fontFamily.trim().length > 0)
    },
    unfit:
      'a text style’s look is a weight, a slant and a letter spacing, with a family, line height and case where it sets them',
    same: sameLook,
  },
} as const
export type ValueKind = keyof typeof VALUE_KINDS

/** A layer's props, as a bindable property reads and writes them. */
type Props = Readonly<Record<string, unknown>>

/** What the list says of a bindable property. */
export interface BindableEntry {
  /** The layer types that have it. */
  types: readonly LayerType[]
  /** The kind of value it takes, from `VALUE_KINDS`. */
  kind: ValueKind
  /** The prop of a layer that holds it. */
  prop: 'fills' | 'style'
  /** The key a copied style (`LayerStyle`) holds it under. */
  styleKey: 'fills' | 'text'
  /** The keys of the text's base style it writes, for a property held there. */
  keys?: readonly string[]
  /** Its value in a layer's props; undefined when they hold none. */
  read(props: Props): VariableValue | undefined
  /** The props with its value written; the same props when it has nowhere to go or is there already. */
  write<P extends Props>(props: P, value: VariableValue): P
  /** The fill binding it adds on top, holding its value, when the layer has none that shows to take it. */
  added?(value: string): Paint
}

/** The colour of the topmost solid fill that shows; undefined when there is none. */
function readFill(props: Props): string | undefined {
  const fills = props.fills
  if (!Array.isArray(fills)) return undefined
  const color = (fills[boundFillIndex(fills)] as { color?: unknown } | undefined)?.color
  return typeof color === 'string' ? color : undefined
}

/** The props with the topmost solid fill that shows coloured `value`; as they were without one. */
function writeFill<P extends Props>(props: P, value: string): P {
  const fills = props.fills
  if (!Array.isArray(fills)) return props
  const at = boundFillIndex(fills)
  if (at < 0 || (fills[at] as { color?: unknown }).color === value) return props
  return { ...props, fills: fills.map((f: unknown, i: number) => (i === at ? { ...(f as object), color: value } : f)) }
}

/** The asset of the topmost image fill that shows; undefined when there is none. */
function readImage(props: Props): string | undefined {
  const fills = props.fills
  if (!Array.isArray(fills)) return undefined
  const assetId = (fills[boundImageIndex(fills)] as { assetId?: unknown } | undefined)?.assetId
  return typeof assetId === 'string' ? assetId : undefined
}

/**
 * The props with the topmost image fill that shows drawing the asset `value`, its fit, opacity,
 * adjustments and filter kept. A crop is in the old picture's pixels, so it goes, and a cropped fill
 * fits the new picture whole in the box. As they were without such a fill, or with this asset in it.
 */
function writeImage<P extends Props>(props: P, value: string): P {
  const fills = props.fills
  if (!Array.isArray(fills)) return props
  const at = boundImageIndex(fills)
  if (at < 0 || (fills[at] as { assetId?: unknown }).assetId === value) return props
  const swapped = (fill: Record<string, unknown>) => {
    const swapped: Record<string, unknown> = { ...fill, assetId: value, ...(fill.fit === 'crop' ? { fit: 'fit' } : {}) }
    delete swapped.crop
    return swapped
  }
  return {
    ...props,
    fills: fills.map((f: unknown, i: number) => (i === at ? swapped(f as Record<string, unknown>) : f)),
  }
}

/** Reading and writing one key of a text's base style, never its runs. */
function baseStyle(key: 'color' | 'fontFamily'): Pick<BindableEntry, 'keys' | 'read' | 'write'> {
  return {
    keys: [key],
    read: (props) => {
      const value = (props.style as Record<string, unknown> | undefined)?.[key]
      return typeof value === 'string' ? value : undefined
    },
    write: (props, value) => {
      const style = props.style as Record<string, unknown> | undefined
      if (!style || style[key] === value) return props
      return { ...props, style: { ...style, [key]: value } }
    },
  }
}

/**
 * A text's base colour, never its runs': none while a gradient shows over it, so setting a gradient
 * ends a colour binding, and written with the gradient taken off, so the colour shows.
 */
function textColour(): Pick<BindableEntry, 'keys' | 'read' | 'write'> {
  const colour = baseStyle('color')
  return {
    keys: ['color', 'gradient'],
    read: (props) =>
      props.style && shownGradient(props.style as Parameters<typeof shownGradient>[0]) ? undefined : colour.read(props),
    write: (props, value) => {
      const style = props.style as Record<string, unknown> | undefined
      if (style?.gradient === undefined) return colour.write(props, value)
      const plain: Record<string, unknown> = { ...style, color: value }
      delete plain.gradient
      return { ...props, style: plain }
    },
  }
}

/** A text's look in its base style, never its runs; undefined without a style. */
function readLook(props: Props): TextLook | undefined {
  const style = props.style as Record<string, unknown> | undefined
  if (!style) return undefined
  return Object.fromEntries(
    LOOK_KEYS.flatMap((key) => (style[key] === undefined ? [] : [[key, style[key]]])),
  ) as TextLook
}

/**
 * The props with the look in the text's base style: its family where it names one, and its line
 * height and case taken out where it leaves them out. The same props when the text shows it already.
 */
function writeLook<P extends Props>(props: P, value: VariableValue): P {
  const style = props.style as Record<string, unknown> | undefined
  if (!style || typeof value === 'string' || sameLook(readLook(props), value)) return props
  const next: Record<string, unknown> = { ...style, ...value }
  if (value.fontFamily === undefined) next.fontFamily = style.fontFamily
  if (value.lineHeight === undefined) delete next.lineHeight
  if (value.textCase === undefined || value.textCase === 'none') delete next.textCase
  return { ...props, style: next }
}

/**
 * The bindable properties, each with the layer types that have it, the kind of value it takes, the
 * prop that holds it and how its value is read and written: the colour of the topmost solid fill that
 * shows (a graphic, box or boolean), a text's base colour and font family, the asset of the topmost
 * image fill that shows (a graphic or box), or a text's look in its base style. Runs that set their
 * own colour, font or look keep it.
 */
export const BINDABLE_PROPERTIES = {
  fill: {
    types: ['graphic', 'box', 'boolean'],
    kind: 'color',
    prop: 'fills',
    styleKey: 'fills',
    read: readFill,
    write: writeFill,
    added: (color: string): Paint => ({ type: 'solid', color }),
  },
  textColor: { types: ['text'], kind: 'color', prop: 'style', styleKey: 'text', ...textColour() },
  fontFamily: { types: ['text'], kind: 'font', prop: 'style', styleKey: 'text', ...baseStyle('fontFamily') },
  image: {
    types: ['graphic', 'box'],
    kind: 'image',
    prop: 'fills',
    styleKey: 'fills',
    read: readImage,
    write: writeImage,
    added: (assetId: string): Paint => ({ type: 'image', assetId, fit: 'fit', opacity: 1 }),
  },
  textStyle: {
    types: ['text'],
    kind: 'textLook',
    prop: 'style',
    styleKey: 'text',
    keys: LOOK_KEYS,
    read: readLook,
    write: writeLook,
  },
} as const satisfies Record<string, BindableEntry>

export const BindableProperty = z.enum(
  Object.keys(BINDABLE_PROPERTIES) as [keyof typeof BINDABLE_PROPERTIES, ...(keyof typeof BINDABLE_PROPERTIES)[]],
)
export type BindableProperty = z.infer<typeof BindableProperty>

/** A layer's bound properties, each to the variable it follows. */
export const Bindings = z.object(
  Object.fromEntries(BindableProperty.options.map((property) => [property, VariableRef.optional()])) as Record<
    BindableProperty,
    z.ZodOptional<typeof VariableRef>
  >,
)
export type Bindings = z.infer<typeof Bindings>

/** The values variables have where a design is drawn, by ref. */
export type Variables = Readonly<Record<string, VariableValue>>

export const brandRef = (token: string): VariableRef => `brand:${token}` as VariableRef

/** What the list says of a bindable property, as one shape whatever the property. */
export const bindableEntry = (property: BindableProperty): BindableEntry => BINDABLE_PROPERTIES[property]

/** Whether a layer of this type has a bindable property. */
export const canBind = (type: string, property: BindableProperty) =>
  (BINDABLE_PROPERTIES[property].types as readonly string[]).includes(type)

/** The kind of value a bindable property takes, from `VALUE_KINDS`. */
export const valueKindOf = (property: BindableProperty) => VALUE_KINDS[BINDABLE_PROPERTIES[property].kind]

/** Whether a value is of the kind a bindable property takes: a colour for a fill or text colour, a family name for a font, an asset id for a picture, a look for a text style. */
export const fitsProperty = (property: BindableProperty, value: unknown): value is VariableValue =>
  valueKindOf(property).fits(value)

/**
 * The other bindable properties a binding of this one writes over, which binding it ends: those that
 * write a key of the text's base style it writes, such as a text style and a font family, which each
 * set the family.
 */
export function overlappingBindings(property: BindableProperty): BindableProperty[] {
  const { prop, keys } = bindableEntry(property)
  return BindableProperty.options.filter((other) => {
    const entry = bindableEntry(other)
    return other !== property && entry.prop === prop && !!entry.keys?.some((key) => keys?.includes(key))
  })
}

/** The property of a kind a layer of this type binds: a colour is a text's colour or another layer's fill, a font a text's family, a picture a graphic's or box's image fill, a look a text's style. */
export const bindablePropertyOf = (type: string, kind: ValueKind): BindableProperty | undefined =>
  BindableProperty.options.find((property) => BINDABLE_PROPERTIES[property].kind === kind && canBind(type, property))

/** The value of a kind a layer of this type holds in its props, as its bindable property reads it; undefined with none. */
export function boundValueOf(type: string, props: Readonly<Record<string, unknown>>, kind: ValueKind) {
  const property = bindablePropertyOf(type, kind)
  return property && BINDABLE_PROPERTIES[property].read(props)
}

/**
 * A layer's props with its bound properties set from `variables`, in the list's order, so a text
 * bound to a text style and a font is drawn in the style's family. A binding whose variable has no
 * value, or a value that doesn't suit it, leaves the property as the layer stores it: the value it
 * had when it was bound, or last set. Props come back as they were when nothing changes.
 */
export function bindProps<P extends Record<string, unknown>>(
  type: string,
  props: P,
  bindings: Bindings | undefined,
  variables: Variables | undefined,
): P {
  if (!bindings || !variables) return props
  let out = props
  for (const property of BindableProperty.options) {
    const ref = bindings[property]
    const value = ref === undefined ? undefined : variables[ref]
    if (value === undefined || !canBind(type, property) || !fitsProperty(property, value)) continue
    out = bindableEntry(property).write(out, value)
  }
  return out
}
