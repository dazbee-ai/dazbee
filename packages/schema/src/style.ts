// A layer's style, as Copy style takes it and Paste style and Copy to other frames ▸ Style set it:
// fill, outline, effects, transparency, corners, font, weight, colour and spacing, with the brand
// bindings of those. It never holds font size, position, size or rotation.
import { z } from 'zod'

import { Effect } from './effects.ts'
import { type Layer, Radius, Stroke, TextBounce, TextCurve, TextStyle } from './layers.ts'
import { Paint } from './paint.ts'
import { ContainerBlendMode } from './primitives.ts'
import { textStyleFields } from './typography.ts'
import { BINDABLE_PROPERTIES, BindableProperty, Bindings, canBind } from './variables.ts'

/**
 * A text's look without its size: font, weight, colour, spacing, the outline along its glyphs, its
 * OpenType features, its gradient, its curve, its bounce, its letters' turn and their raise. Null is none.
 */
const TextLook = z.object({
  fontFamily: TextStyle.shape.fontFamily,
  fontWeight: textStyleFields.fontWeight,
  fontStyle: textStyleFields.fontStyle,
  color: TextStyle.shape.color,
  letterSpacing: textStyleFields.letterSpacing,
  lineHeight: textStyleFields.lineHeight.nullable(),
  paragraphSpacing: z.number().min(0).nullable(),
  outline: textStyleFields.outline.nullable(),
  /** Left out of a style copied before texts had features, which is none. */
  features: textStyleFields.features.nullable().default(null),
  /** Left out of a style copied before texts had gradients, which is none. */
  gradient: textStyleFields.gradient.nullable().default(null),
  /** Left out of a style copied before texts had curves, which is none. */
  curve: TextCurve.nullable().default(null),
  /** Left out of a style copied before texts had bounces, which is none. */
  bounce: TextBounce.nullable().default(null),
  /** The base style's letter turn; left out of a style copied before letters had turns, which is none. */
  turn: textStyleFields.turn.nullable().default(null),
  /** The base style's raise; left out of a style copied before characters had raises, which is none. */
  raise: textStyleFields.raise.nullable().default(null),
})

export const LayerStyle = z.object({
  /** A graphic's, box's or boolean's fills and outlines; left out for a text. */
  fills: Paint.array().optional(),
  strokes: Stroke.array().optional(),
  effects: Effect.array(),
  opacity: z.number().min(0).max(1),
  blendMode: ContainerBlendMode,
  /** One radius for every corner, or each corner's own from the top left clockwise; left out for a layer without corners. */
  corners: z.union([Radius, z.tuple([Radius, Radius, Radius, Radius])]).optional(),
  /** A text's look; left out for any other layer. */
  text: TextLook.optional(),
  /** The brand bindings of the fill, the text colour and the font. */
  bindings: Bindings,
})
export type LayerStyle = z.infer<typeof LayerStyle>

/**
 * What setting a style changes on a layer: its props, a value of undefined clearing one, and its
 * bindings after, left out when they stay as they are.
 */
export interface Restyle {
  patch: Record<string, unknown>
  bindings?: Bindings
}

type Corners = NonNullable<LayerStyle['corners']>
type Props = Readonly<Record<string, unknown>>
/** Any layer's type and props, each type with its own props. */
type TypedProps = Layer extends infer L ? (L extends Layer ? Pick<L, 'type' | 'props'> : never) : never

/** The keys of a text's base style that its look holds as null when the text has none. */
const NULLABLE_LOOK: ReadonlySet<string> = new Set(['lineHeight', 'outline', 'features', 'gradient', 'turn', 'raise'])

/** A layer's style. */
export function styleOf(layer: Layer): LayerStyle {
  const style: LayerStyle = {
    effects: layer.props.effects,
    opacity: layer.props.opacity,
    blendMode: layer.props.blendMode,
    bindings: {},
  }
  if ('fills' in layer.props) style.fills = layer.props.fills
  if ('strokes' in layer.props) style.strokes = layer.props.strokes
  const corners = cornerRadiiOf(layer)
  if (corners !== undefined) style.corners = corners
  if (layer.type === 'text') {
    const s = layer.props.style
    style.text = {
      fontFamily: s.fontFamily,
      fontWeight: s.fontWeight,
      fontStyle: s.fontStyle,
      color: s.color,
      letterSpacing: s.letterSpacing,
      lineHeight: s.lineHeight ?? null,
      paragraphSpacing: layer.props.paragraphSpacing ?? null,
      outline: s.outline ?? null,
      features: s.features ?? null,
      gradient: s.gradient ?? null,
      curve: layer.props.curve ?? null,
      bounce: layer.props.bounce ?? null,
      turn: s.turn ?? null,
      raise: s.raise ?? null,
    }
  }
  for (const property of BindableProperty.options) {
    const ref = layer.bindings?.[property]
    if (ref && sets(style, layer, property)) style.bindings[property] = ref
  }
  return style
}

/**
 * What setting a style changes on a layer, only in what the layer has: fills and outlines on a
 * graphic, box or boolean, the font on a text, corners where it has corners. A blend only a
 * group or box can have becomes normal on any other layer. Null when the layer has the style already.
 */
export function restyle(layer: Layer, style: LayerStyle): Restyle | null {
  const props = layer.props as Props
  const wanted: Record<string, unknown> = {
    effects: style.effects,
    opacity: style.opacity,
    blendMode: style.blendMode === 'pass-through' && !holdsLayers(layer) ? 'normal' : style.blendMode,
  }
  if (style.fills && 'fills' in props) wanted.fills = style.fills
  if (style.strokes && 'strokes' in props) wanted.strokes = style.strokes
  if (style.corners !== undefined) Object.assign(wanted, withCorners(layer, style.corners))
  if (style.text && layer.type === 'text') {
    const { lineHeight, paragraphSpacing, outline, features, gradient, curve, bounce, turn, raise, ...look } =
      style.text
    const kept = Object.entries(layer.props.style).filter(([key]) => !NULLABLE_LOOK.has(key))
    wanted.style = {
      ...Object.fromEntries(kept),
      ...look,
      ...(lineHeight === null ? {} : { lineHeight }),
      ...(outline === null ? {} : { outline }),
      ...(features === null ? {} : { features }),
      ...(gradient === null ? {} : { gradient }),
      ...(turn === null ? {} : { turn }),
      ...(raise === null ? {} : { raise }),
    }
    wanted.paragraphSpacing = paragraphSpacing ?? undefined
    wanted.curve = curve ?? undefined
    wanted.bounce = bounce ?? undefined
  }
  const patch = Object.fromEntries(Object.entries(wanted).filter(([key, value]) => !same(value, props[key])))
  const bindings: Bindings = Object.fromEntries(
    BindableProperty.options.flatMap((property) => {
      const ref = sets(style, layer, property) ? style.bindings[property] : layer.bindings?.[property]
      return ref ? [[property, ref]] : []
    }),
  )
  const rebind = !same(bindings, layer.bindings ?? {})
  if (Object.keys(patch).length === 0 && !rebind) return null
  return rebind ? { patch, bindings } : { patch }
}

/** A layer's corner radii, from its type and props: a box's, or a rectangle's, polygon's or star's; undefined for any other. */
export function cornerRadiiOf(layer: TypedProps): Corners | undefined {
  if (layer.type === 'box') return layer.props.cornerRadius
  if (layer.type !== 'graphic') return undefined
  const { shape } = layer.props
  if (shape.kind === 'rect') return shape.corners ?? shape.cornerRadius
  if (shape.kind === 'polygon' || shape.kind === 'star') return shape.cornerRadius
  return undefined
}

/** Whether a layer keeps each corner's own radius, as a box and a rectangle do; any other keeps one at most. */
export function keepsEachCorner(layer: TypedProps): boolean {
  return layer.type === 'box' || (layer.type === 'graphic' && layer.props.shape.kind === 'rect')
}

/**
 * The props that give a layer these corners: a box's radius, a rectangle's radius or own corners,
 * or a polygon's or star's one radius (the top left corner's, from four); none for any other.
 */
export function withCorners(layer: TypedProps, corners: Corners): Record<string, unknown> {
  if (layer.type === 'box') return { cornerRadius: corners }
  if (layer.type !== 'graphic') return {}
  const { shape } = layer.props
  if (shape.kind === 'rect')
    return { shape: Array.isArray(corners) ? { ...shape, corners } : { kind: shape.kind, cornerRadius: corners } }
  if (shape.kind === 'polygon' || shape.kind === 'star')
    return { shape: { ...shape, cornerRadius: Array.isArray(corners) ? corners[0] : corners } }
  return {}
}

/** Whether a style sets a bindable property of this layer: it carries the key a copied style holds the property under. */
function sets(style: LayerStyle, layer: Layer, property: BindableProperty) {
  return canBind(layer.type, property) && style[BINDABLE_PROPERTIES[property].styleKey] !== undefined
}

function holdsLayers(layer: Layer) {
  return layer.type === 'box' || layer.type === 'group'
}

/** Whether two JSON values are the same, whatever order their keys are in; an undefined key counts as missing. */
function same(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b)
}

/** A JSON value as text with every object's keys sorted. */
function stable(value: unknown): string | undefined {
  if (Array.isArray(value)) return `[${value.map((v) => stable(v) ?? 'null').join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
