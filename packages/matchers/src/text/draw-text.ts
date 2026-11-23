// Drawing a candidate text with Dazbee's renderer, on the CPU surface, as an export draws it: one text
// layer in a one-frame design with no fill, laid out by the renderer's own text measure, with the
// candidates' faces registered under their families.

import type { CanvasKit } from '@dazbee/canvaskit'
import { type Pixels, renderPixels, type ResourceBytes, resourceCache, textMeasure } from '@dazbee/renderer'
import { type Color, type TextCurve, TextProps } from '@dazbee/schema'

/** What the text matcher sets on a text: its look, before it is placed. */
export interface TextLook {
  family: string
  weight: number
  style: 'normal' | 'italic'
  /** Pixels. */
  size: number
  /** Letter spacing in % of the size, Dazbee's unit. */
  spacing: number
  /** A multiple of the size; left out, the font's own. */
  lineHeight?: number
  align: 'start' | 'center' | 'end'
  color: Color
  outline?: { width: number; color: Color }
  /** Its lines bent along a curve; left out, straight. */
  curve?: TextCurve
}

/** Where a text layer sits: its box and its rotation in degrees clockwise. */
export interface Placed {
  x: number
  y: number
  width: number
  height: number
  rotation: number
}

/** A face's bytes and the family it is registered under. */
export interface DrawnFace {
  family: string
  bytes: Uint8Array
}

/** A text layer's props as the text matcher sets them, before the schema's defaults. */
export type TextLayerProps = Placed & {
  text: string
  boxMode: 'autoWidth'
  align: TextLook['align']
  style: {
    fontFamily: string
    fontWeight: number
    fontStyle: TextLook['style']
    fontSize: number
    color: Color
    letterSpacing: { unit: 'percent'; value: number }
    lineHeight?: number
    outline?: { width: number; color: Color }
  }
  curve?: TextCurve
}

/** Measures and draws text in a set of faces. */
export interface TextDrawer {
  /** The width and height Dazbee gives the words in this look as a text that grows to fit them. */
  measure(words: string, look: TextLook): { width: number; height: number }
  /** A `width` × `height` frame with nothing behind the text layer of these props. */
  draw(width: number, height: number, props: TextLayerProps): Pixels
  /** Frees the registered faces. */
  delete(): void
}

/** Letter spacing is stored to this many decimals. */
const SPACING_DECIMALS = 2

/** A drawer over Dazbee's renderer with `faces` registered, and no fallback. */
export function textDrawer(ck: CanvasKit, faces: readonly DrawnFace[]): TextDrawer {
  const bytes: ResourceBytes = { fonts: [...faces], fallbackFamilies: [], images: {} }
  // The faces registered once, for every measure and draw, until delete().
  const cache = resourceCache(ck)

  function measure(words: string, look: TextLook) {
    const props = TextProps.parse(textLayerProps(words, look, { x: 0, y: 0, width: 1, height: 1, rotation: 0 }))
    return textMeasure(ck, cache.resources(bytes))(props, null)
  }

  function draw(width: number, height: number, props: TextLayerProps) {
    return renderPixels(ck, designOf(width, height, props), 'f', bytes, cache)
  }

  return { measure, draw, delete: cache.delete }
}

/** The text layer's props for the words in a look, placed. */
export function textLayerProps(words: string, look: TextLook, place: Placed): TextLayerProps {
  return {
    ...place,
    text: words,
    boxMode: 'autoWidth',
    align: look.align,
    style: {
      fontFamily: look.family,
      fontWeight: look.weight,
      fontStyle: look.style,
      fontSize: look.size,
      color: look.color,
      letterSpacing: { unit: 'percent', value: roundTo(look.spacing, SPACING_DECIMALS) },
      ...(look.lineHeight ? { lineHeight: look.lineHeight } : {}),
      ...(look.outline && look.outline.width > 0 ? { outline: look.outline } : {}),
    },
    ...(look.curve ? { curve: look.curve } : {}),
  }
}

/** A design of one `width` × `height` frame with no fill, holding the one text layer. */
function designOf(width: number, height: number, props: TextLayerProps) {
  return {
    meta: { designId: 'piece', name: 'piece' },
    pages: { p: { name: 'Page 1', order: 'a0' } },
    frames: { f: { pageId: 'p', name: 'Piece', width, height, x: 0, y: 0, fills: [], order: 'a0' } },
    nodes: { t: { type: 'text', parentId: 'f', link: 't', index: 'a0', name: 'Text', props } },
  }
}

/** `value` rounded to `decimals` places. */
function roundTo(value: number, decimals: number): number {
  return Math.round(value * 10 ** decimals) / 10 ** decimals
}
