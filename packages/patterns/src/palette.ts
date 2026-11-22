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

/** The contrast a deep ground holds its ink at. */
const DEEP_CONTRAST = 7
/** The contrast an ornament reads at; under it, it is drawn in the ground's ink, faint. */
const ORNAMENT_CONTRAST = 3

/**
 * The kit's deep colour, a ground light ink reads on at 7:1: the first of the secondary, primary and text colours
 * that holds white or the background colour at it, bound to its role; else the secondary darkened until it does.
 */
export function deepColour(palette: Palette): Swatch {
  const holds = (colour: string) =>
    Math.max(contrast(colour, WHITE.value), contrast(colour, palette.background.value)) >= DEEP_CONTRAST
  const found = [palette.secondary, palette.primary, palette.text].find((swatch) => holds(swatch.value))
  if (found) return found
  for (let share = 0.1; share < 1; share += 0.1) {
    const value = mixed(palette.secondary.value, INK.value, share)
    if (holds(value)) return { value }
  }
  return INK
}

/** The colour a fine ornament takes on `ground`: the accent where it reads, else the ground's ink, faint. */
export function ornamentColour(palette: Palette, ground: string): { colour: Swatch; opacity: number } {
  if (contrast(palette.accent.value, ground) >= ORNAMENT_CONTRAST) return { colour: palette.accent, opacity: 1 }
  return { colour: inkOn(ground, [palette.text, palette.background]), opacity: 0.35 }
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

/** A colour in CIE L*a*b* (D65), from #RRGGBB(AA). */
export function labOf(colour: string): [number, number, number] {
  const linear = (at: number) => {
    const v = Number.parseInt(colour.slice(at, at + 2), 16) / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const [r, g, b] = [linear(1), linear(3), linear(5)]
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
  const f = (t: number) => (t > 216 / 24_389 ? Math.cbrt(t) : (t * 24_389) / 27 / 116 + 16 / 116)
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))]
}

/** A colour's chroma and hue, in degrees, in CIE LCh. */
export function lchOf(colour: string): { chroma: number; hue: number } {
  const [, a, b] = labOf(colour)
  const hue = (Math.atan2(b, a) * 180) / Math.PI
  return { chroma: Math.hypot(a, b), hue: hue < 0 ? hue + 360 : hue }
}

/** How far apart two colours look, as CIEDE2000 reckons it: about 2 is just told apart, 20 and more plainly apart. */
export function deltaE(one: string, other: string): number {
  const [l1, a1, b1] = labOf(one)
  const [l2, a2, b2] = labOf(other)
  const rad = Math.PI / 180
  const c1 = Math.hypot(a1, b1)
  const c2 = Math.hypot(a2, b2)
  const mean = (c1 + c2) / 2
  const g = 0.5 * (1 - Math.sqrt(mean ** 7 / (mean ** 7 + 25 ** 7)))
  const p1 = a1 * (1 + g)
  const p2 = a2 * (1 + g)
  const cp1 = Math.hypot(p1, b1)
  const cp2 = Math.hypot(p2, b2)
  const hue = (b: number, a: number) => {
    if (a === 0 && b === 0) return 0
    const h = Math.atan2(b, a) / rad
    return h < 0 ? h + 360 : h
  }
  const h1 = hue(b1, p1)
  const h2 = hue(b2, p2)
  const dl = l2 - l1
  const dc = cp2 - cp1
  let dh = 0
  if (cp1 * cp2 !== 0) dh = Math.abs(h2 - h1) <= 180 ? h2 - h1 : h2 - h1 > 180 ? h2 - h1 - 360 : h2 - h1 + 360
  const dH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((dh / 2) * rad)
  const lm = (l1 + l2) / 2
  const cm = (cp1 + cp2) / 2
  let hm = h1 + h2
  if (cp1 * cp2 !== 0)
    hm = Math.abs(h1 - h2) <= 180 ? (h1 + h2) / 2 : h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2
  const t =
    1 -
    0.17 * Math.cos((hm - 30) * rad) +
    0.24 * Math.cos(2 * hm * rad) +
    0.32 * Math.cos((3 * hm + 6) * rad) -
    0.2 * Math.cos((4 * hm - 63) * rad)
  const sl = 1 + (0.015 * (lm - 50) ** 2) / Math.sqrt(20 + (lm - 50) ** 2)
  const sc = 1 + 0.045 * cm
  const sh = 1 + 0.015 * cm * t
  const rt = -2 * Math.sqrt(cm ** 7 / (cm ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad)
  return Math.sqrt((dl / sl) ** 2 + (dc / sc) ** 2 + (dH / sh) ** 2 + rt * (dc / sc) * (dH / sh))
}

/** Whether two colours are plainly apart: by `ratio` of contrast, or by `difference` of CIEDE2000. */
export function apart(one: string, other: string, ratio: number, difference: number): boolean {
  return contrast(one, other) >= ratio || deltaE(one, other) >= difference
}
