import type { CanvasKit, StrutStyle, TextStyle as CkTextStyle } from '@dazbee/canvaskit'
import { letterSpacingPx, type TextProps } from '@dazbee/schema'

import { color } from '../color.ts'
import type { Resources } from '../resources.ts'
import { drawsLines, linesColour, type TextPass } from './text-paint.ts'

type Style = TextProps['style']

/**
 * A style for CanvasKit, with its underline and strikethrough only in the pass that draws them
 * (`drawsLines`), and its baseline moved down by `baselineShift` pixels.
 */
export function textStyle(
  ck: CanvasKit,
  style: Style,
  resources: Pick<Resources, 'fallbackFamilies'>,
  pass: TextPass,
  baselineShift = 0,
): CkTextStyle {
  const decoration = drawsLines(style, pass)
    ? (style.underline ? ck.UnderlineDecoration : 0) | (style.strikethrough ? ck.LineThroughDecoration : 0)
    : 0
  return new ck.TextStyle({
    color: color(ck, style.color),
    fontFamilies: familiesOf(style, resources),
    fontSize: style.fontSize,
    fontStyle: {
      weight: { value: style.fontWeight },
      slant: style.fontStyle === 'italic' ? ck.FontSlant.Italic : ck.FontSlant.Upright,
    },
    // A variable font draws its default instance unless told the weight; a static one ignores it.
    fontVariations: [{ axis: 'wght', value: style.fontWeight }],
    letterSpacing: letterSpacingPx(style.letterSpacing, style.fontSize),
    baselineShift,
    ...(style.features
      ? { fontFeatures: Object.entries(style.features).map(([name, on]) => ({ name, value: on ? 1 : 0 })) }
      : {}),
    ...(style.lineHeight === undefined ? {} : { heightMultiplier: style.lineHeight, halfLeading: true }),
    ...(decoration ? { decoration, decorationColor: color(ck, linesColour(style, pass)), decorationThickness: 1 } : {}),
  })
}

/** Lines at least as tall as the style's would be, for a paragraph whose own letters are smaller. */
export function strutStyle(ck: CanvasKit, style: Style, resources: Pick<Resources, 'fallbackFamilies'>): StrutStyle {
  return {
    strutEnabled: true,
    fontFamilies: familiesOf(style, resources),
    fontSize: style.fontSize,
    fontStyle: {
      weight: { value: style.fontWeight },
      slant: style.fontStyle === 'italic' ? ck.FontSlant.Italic : ck.FontSlant.Upright,
    },
    ...(style.lineHeight === undefined ? {} : { heightMultiplier: style.lineHeight, halfLeading: true }),
  }
}

/** The families a style's characters are drawn from: its own, then the fallbacks. */
function familiesOf(style: Style, resources: Pick<Resources, 'fallbackFamilies'>): string[] {
  return [style.fontFamily, ...resources.fallbackFamilies.filter((f) => f !== style.fontFamily)]
}
