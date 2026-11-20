// Variables a layer's properties follow, and the list of bindable properties. For now the variables
// are the brand kit's tokens, named `brand:<token>`: a brand's colours, fonts and logo, which a layer
// binds its fill, its text colour, its font family or its picture to, so changing the brand colour
// changes every design that uses it. Everything that binds reads the list.
import { z } from 'zod'

import type { LayerType } from './layers.ts'
import { boundFillIndex, boundImageIndex, type Paint } from './paint.ts'
import { AssetId, Color } from './primitives.ts'

/** A brand kit token's name: lowercase words joined by hyphens, such as `primary` or `sale-red`. */
export const BrandToken = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'a token is lowercase words joined by hyphens')
  .max(40)
export type BrandToken = z.infer<typeof BrandToken>

/** What a bound property follows: a brand kit token, `brand:<token>`. */
export const VariableRef = z.templateLiteral(['brand:', BrandToken])
export type VariableRef = z.infer<typeof VariableRef>

/** The kinds of value a bindable property takes, each with the values that fit it and what to say of one that doesn't. */
export const VALUE_KINDS = {
  /** A colour as the schema takes it. */
  color: { fits: (value: string) => Color.safeParse(value).success, unfit: 'colours are #RRGGBBAA' },
  /** A font family's name that isn't blank. */
  font: { fits: (value: string) => value.trim().length > 0, unfit: 'a font family needs a name' },
  /** A picture: the id of an image asset. */
  image: { fits: (value: string) => AssetId.safeParse(value).success, unfit: 'a picture is an asset’s id' },
} as const
export type ValueKind = keyof typeof VALUE_KINDS

/** A layer's props, as a bindable property reads and writes them. */
type Props = Readonly<Record<string, unknown>>

/** What the list says of a bindable property. */
interface BindableEntry {
  /** The layer types that have it. */
  types: readonly LayerType[]
  /** The kind of value it takes, from `VALUE_KINDS`. */
  kind: ValueKind
  /** The prop of a layer that holds it. */
  prop: 'fills' | 'style'
  /** The key a copied style (`LayerStyle`) holds it under. */
  styleKey: 'fills' | 'text'
  /** Its value in a layer's props; undefined when they hold none. */
  read(props: Props): string | undefined
  /** The props with its value written; the same props when it has nowhere to go or is there already. */
  write<P extends Props>(props: P, value: string): P
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
function baseStyle(key: 'color' | 'fontFamily'): Pick<BindableEntry, 'read' | 'write'> {
  return {
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
 * The bindable properties, each with the layer types that have it, the kind of value it takes, the
 * prop that holds it and how its value is read and written: the colour of the topmost solid fill that
 * shows (a graphic, box or boolean), a text's base colour and font family, or the asset of the topmost
 * image fill that shows (a graphic or box). Runs that set their own colour or font keep it.
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
  textColor: { types: ['text'], kind: 'color', prop: 'style', styleKey: 'text', ...baseStyle('color') },
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

/** The values variables have where a design is drawn: a colour (#RRGGBBAA), a font family or an image asset's id, by ref. */
export type Variables = Readonly<Record<string, string>>

export const brandRef = (token: string): VariableRef => `brand:${token}` as VariableRef

/** Whether a layer of this type has a bindable property. */
export const canBind = (type: string, property: BindableProperty) =>
  (BINDABLE_PROPERTIES[property].types as readonly string[]).includes(type)

/** The kind of value a bindable property takes, from `VALUE_KINDS`. */
export const valueKindOf = (property: BindableProperty) => VALUE_KINDS[BINDABLE_PROPERTIES[property].kind]

/** Whether a value is of the kind a bindable property takes: a colour for a fill or text colour, a family name for a font, an asset id for a picture. */
export const fitsProperty = (property: BindableProperty, value: string) => valueKindOf(property).fits(value)

/** The property of a kind a layer of this type binds: a colour is a text's colour or another layer's fill, a font a text's family, a picture a graphic's or box's image fill. */
export const bindablePropertyOf = (type: string, kind: ValueKind): BindableProperty | undefined =>
  BindableProperty.options.find((property) => BINDABLE_PROPERTIES[property].kind === kind && canBind(type, property))

/**
 * A layer's props with its bound properties set from `variables`. A binding whose variable has no
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
    out = BINDABLE_PROPERTIES[property].write(out, value)
  }
  return out
}
