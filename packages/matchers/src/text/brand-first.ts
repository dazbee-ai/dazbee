// Brand first: the brand kit's fonts are tried before the rest and its colours and text styles taken
// where they fit, each bound to its token (ADR-0018). A kit font is picked when its letters' shape
// trails the best fit's by 0.03 or less, and binds the font family; a colour within ΔE00 8 of a kit
// colour takes it, and binds the text colour; a kit text style is applied when it is set in the
// picked face, its letter spacing and line height are near the fit's, its case leaves the words as
// they are, and drawn in it the text overlaps the piece within 0.01 of the fit, and binds the text's
// look in place of its family.

import {
  type Bindings,
  brandRef,
  type BrandTextStyle,
  type Color,
  type MatchKit,
  type Rgb,
  type TextLook as StyleLook,
  type VariableRef,
} from '@dazbee/schema'

import { ciede2000, srgbToLab } from '../looks-same/colour.ts'
import { hexRgb } from '../shape/parts/colour.ts'
import type { TextDrawer, TextLook } from './draw-text.ts'
import { BASE_LINE_HEIGHT, type Fitted, placeByInk } from './light/fit.ts'
import type { PieceReading } from './read-piece.ts'

/** A kit text style the fit is set in: its token, the look it binds, and the fit placed again in it. */
export interface KitStyle {
  token: string
  look: StyleLook
  fit: Fitted
}

/** A look in the kit's colours, and the token its text colour binds to when that is a kit colour. */
export interface KitColoured {
  look: TextLook
  textColor?: VariableRef
}

/** How far a kit font's letter shape may trail the best fit's and still be picked. */
const BRAND_MARGIN = 0.03
/** A colour within this ΔE00 of a kit colour takes it. */
const KIT_COLOUR_DELTA = 8
/** A kit text style's letter spacing within this many points of % of the fit's matches. */
const STYLE_SPACING_WITHIN = 2
/** A kit text style's line height within this much of the fit's matches, for words of more than a line. */
const STYLE_LINE_HEIGHT_WITHIN = 0.1
/** A kit text style is applied when the text drawn in it overlaps the piece at most this much less than the fit. */
const STYLE_OVERLAP_WITHIN = 0.01

/**
 * The fit to finish first, of fits ranked best first: the first kit font's when its letters' shape
 * trails the best's by `BRAND_MARGIN` or less, else the best.
 */
export function pickFit(fits: readonly Fitted[]): Fitted | undefined {
  const best = fits[0]
  const brand = fits.find((fit) => fit.face.brandToken !== undefined)
  return brand && best && brand.shape >= best.shape - BRAND_MARGIN ? brand : best
}

/**
 * The look in the piece's colours with its text colour and outline colour each taken from the kit
 * colour nearest the piece's within ΔE00 8, the text colour bound to it; undefined when neither is
 * near one.
 */
export function kitColoured(
  look: TextLook,
  reading: PieceReading,
  colors: MatchKit['colors'],
): KitColoured | undefined {
  const text = nearestKitColour(reading.fill, colors)
  const outline = look.outline && reading.outline ? nearestKitColour(reading.outline.colour, colors) : undefined
  if (!text && !outline) return undefined
  return {
    look: {
      ...look,
      ...(text ? { color: text.value } : {}),
      ...(look.outline && outline ? { outline: { ...look.outline, color: outline.value } } : {}),
    },
    ...(text ? { textColor: brandRef(text.token) } : {}),
  }
}

/**
 * The first kit text style the fit matches: set in the fit's family, which is a kit font's, at its
 * weight and slant, its letter spacing within 2 points and, for words of more than a line, its line
 * height within 0.1 of the fit's, its case leaving the words as they are; with the fit placed again
 * in its spacing and line height. Undefined when none matches, or when drawn in it the text overlaps
 * the piece more than 0.01 less than the fit. `scale` is the work pixels a piece pixel, which turns a
 * style's spacing in pixels into %.
 */
export function kitStyle(
  drawer: TextDrawer,
  reading: PieceReading,
  words: string,
  fit: Fitted,
  kit: MatchKit,
  scale: number,
): KitStyle | undefined {
  if (fit.face.brandToken === undefined) return undefined
  const lined = words.includes('\n')
  for (const style of kit.textStyles) {
    const family = 'family' in style.font ? style.font.family : kit.fonts[style.font.token]
    if (family !== fit.face.family || style.fontWeight !== fit.face.weight || style.fontStyle !== fit.face.style)
      continue
    if (!keepsWords(style, words)) continue
    const { letterSpacing } = style
    const spacing =
      letterSpacing.unit === 'percent' ? letterSpacing.value : (letterSpacing.value / (fit.look.size / scale)) * 100
    if (Math.abs(spacing - fit.look.spacing) > STYLE_SPACING_WITHIN) continue
    if (
      lined &&
      style.lineHeight !== undefined &&
      Math.abs(style.lineHeight - (fit.look.lineHeight ?? BASE_LINE_HEIGHT)) > STYLE_LINE_HEIGHT_WITHIN
    )
      continue
    const look: TextLook = { ...fit.look, spacing }
    if (style.lineHeight === undefined) delete look.lineHeight
    else look.lineHeight = style.lineHeight
    const placed = placeByInk(drawer, reading, words, fit.face, look)
    if (!placed || placed.overlap < fit.overlap - STYLE_OVERLAP_WITHIN) return undefined
    return { token: style.token, look: styleLook(style, family), fit: { ...placed, lineGaps: fit.lineGaps } }
  }
  return undefined
}

/**
 * A finished fit's bindings: the text's look to its kit text style, or else its family to its kit
 * font's token, and its colour to its kit colour's.
 */
export function kitBindings(fit: Fitted, style: KitStyle | undefined, textColor: VariableRef | undefined): Bindings {
  const { brandToken } = fit.face
  return {
    ...(style ? { textStyle: brandRef(style.token) } : brandToken ? { fontFamily: brandRef(brandToken) } : {}),
    ...(textColor ? { textColor } : {}),
  }
}

/** The kit colour nearest a colour within `KIT_COLOUR_DELTA`, the first on a tie; undefined when none is. */
function nearestKitColour(colour: Rgb, colors: MatchKit['colors']): { token: string; value: Color } | undefined {
  const lab = srgbToLab(...colour)
  let best: { token: string; value: Color; distance: number } | undefined
  for (const [token, value] of Object.entries(colors)) {
    const distance = ciede2000(lab, srgbToLab(...hexRgb(value)))
    if (distance <= KIT_COLOUR_DELTA && (!best || distance < best.distance)) best = { token, value, distance }
  }
  return best && { token: best.token, value: best.value }
}

/** Whether a style's case draws the words as they are: none, or upper or lower case of words already in it. */
function keepsWords(style: BrandTextStyle, words: string): boolean {
  switch (style.textCase ?? 'none') {
    case 'none':
      return true
    case 'upper':
      return words === words.toUpperCase()
    case 'lower':
      return words === words.toLowerCase()
    default:
      return false
  }
}

/** The look a kit text style binds a text to, in its family. */
function styleLook(style: BrandTextStyle, family: string): StyleLook {
  return {
    fontFamily: family,
    fontWeight: style.fontWeight,
    fontStyle: style.fontStyle,
    ...(style.lineHeight === undefined ? {} : { lineHeight: style.lineHeight }),
    letterSpacing: style.letterSpacing,
    ...(style.textCase === undefined ? {} : { textCase: style.textCase }),
  }
}
