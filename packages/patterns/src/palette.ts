// The colours and fonts a pattern is drawn in: each brand role's value in the kit, or the style's where the kit sets
// none, bound to the brand role either way, so a role set later changes the ad. And the ink a text takes on a colour: the
// first of the colours offered that reads on it, as WCAG 2 reckons contrast.
import { type BrandKit, brandRef, type VariableRef } from '@dazbee/schema'

import type { Style } from './styles.ts'

/** A colour or a font, and the brand role it is bound to, if any. */
export interface Swatch {
  /** A colour as #RRGGBBAA, or a font family. */
  value: string
  ref?: VariableRef
}

/** A pattern's colours by brand role, and its fonts. */
export interface Palette {
  primary: Swatch
  secondary: Swatch
  accent: Swatch
  background: Swatch
  text: Swatch
  heading: Swatch
  body: Swatch
  /** Whether the kit sets the font of each kind, so the style's weight for a brand's font is used. */
  brandFont: { heading: boolean; body: boolean }
}

/** WCAG 2's contrast ratios: for text, and for large text. */
export const TEXT_CONTRAST = 4.5
export const LARGE_TEXT_CONTRAST = 3

/** White and a near black, the inks offered after the kit's. */
export const WHITE: Swatch = { value: '#FFFFFFFF' }
export const INK: Swatch = { value: '#111111FF' }

/** The pattern's colours and fonts from the kit, the style's where the kit sets none, each bound to its brand role. */
export function paletteOf(kit: BrandKit, style: Style): Palette {
  const colour = (role: keyof Style['colours']): Swatch => {
    const set = kit.colors.find((entry) => entry.token === role)
    return { value: set ? set.value.toUpperCase() : `${style.colours[role]}FF`, ref: brandRef(role) }
  }
  const font = (role: 'heading' | 'body'): Swatch => {
    const set = kit.fonts.find((entry) => entry.token === role)
    return { value: set ? set.family : style.fonts[role], ref: brandRef(role) }
  }
  return {
    primary: colour('primary'),
    secondary: colour('secondary'),
    accent: colour('accent'),
    background: colour('background'),
    text: colour('text'),
    heading: font('heading'),
    body: font('body'),
    brandFont: {
      heading: kit.fonts.some((entry) => entry.token === 'heading'),
      body: kit.fonts.some((entry) => entry.token === 'body'),
    },
  }
}

/** The first of `offered`, then white and near black, that reads on `surface` at `ratio`; else the one that reads best. */
export function inkOn(surface: string, offered: readonly Swatch[], ratio = TEXT_CONTRAST): Swatch {
  const all = [...offered, WHITE, INK]
  const reads = all.find((ink) => contrast(ink.value, surface) >= ratio)
  if (reads) return reads
  return all.reduce((best, ink) => (contrast(ink.value, surface) > contrast(best.value, surface) ? ink : best))
}

/** The contrast ratio of two colours, from 1 to 21. */
export function contrast(a: string, b: string): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** Whether a colour is dark: white reads better on it than near black. */
export function isDark(colour: string): boolean {
  return contrast(colour, WHITE.value) > contrast(colour, INK.value)
}

/** A colour as #RRGGBBAA with its alpha set to `alpha`, from 0 to 1. */
export function withAlpha(colour: string, alpha: number): string {
  const byte = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
  return `${colour.slice(0, 7)}${byte.toString(16).padStart(2, '0').toUpperCase()}`
}

/** A colour mixed with another, `share` of the way to it, opaque. */
export function mixed(colour: string, other: string, share: number): string {
  const channel = (hex: string, at: number) => Number.parseInt(hex.slice(at, at + 2), 16)
  const mix = (at: number) =>
    Math.round(channel(colour, at) + (channel(other, at) - channel(colour, at)) * share)
      .toString(16)
      .padStart(2, '0')
  return `#${mix(1)}${mix(3)}${mix(5)}FF`.toUpperCase()
}

/** A colour's relative luminance, as WCAG 2 reckons it, its alpha left out. */
function luminance(colour: string): number {
  const linear = (at: number) => {
    const v = Number.parseInt(colour.slice(at, at + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(1) + 0.7152 * linear(3) + 0.0722 * linear(5)
}
