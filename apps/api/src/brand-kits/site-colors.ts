// The colours a website's CSS names, read from its values, and the colours it gives a brand kit's colour roles:
// the page's own background and text, and its most used colours that are neither white, black nor grey.
import type { BRAND_ROLES, Color } from '@dazbee/schema'

/** The colour roles a site fills, each with its colour, in the kit's form `#RRGGBBFF`, always opaque. */
export type ColorRoles = Partial<Record<(typeof BRAND_ROLES.color)[number], Color>>

/** What a site's CSS says of its colours. */
export interface SiteColors {
  /** Each colour the CSS uses, with how much it is used, weighted by where. */
  used: ReadonlyMap<Color, number>
  /** The page's own background and text colours, when the CSS sets them. */
  background: Color | null
  text: Color | null
  /** Whether any CSS was read at all: without it, the page's defaults say nothing. */
  read: boolean
}

/** The longest CSS value read for colours; past it, the value is a picture or a list of no use here. */
const MAX_VALUE = 1_000
/** The least share of the primary's use another colour needs to fill a role of its own. */
const MIN_SHARE = 0.15
/** The least difference, in CIE76 ΔE, between two colours that fill two roles. */
const MIN_DIFFERENCE = 20
/** The least chroma, from 0 to 1, of a colour that isn't white, black or grey. */
const MIN_CHROMA = 0.12
/** The colour names CSS sites use, beyond which a name is read as no colour. */
const NAMED: Readonly<Record<string, string>> = {
  black: '000000',
  white: 'ffffff',
  red: 'ff0000',
  green: '008000',
  blue: '0000ff',
  yellow: 'ffff00',
  orange: 'ffa500',
  purple: '800080',
  navy: '000080',
  teal: '008080',
  gray: '808080',
  grey: '808080',
  silver: 'c0c0c0',
  maroon: '800000',
  olive: '808000',
  lime: '00ff00',
  aqua: '00ffff',
  fuchsia: 'ff00ff',
}
/** A colour in a CSS value: a hex, an rgb() or hsl() call, or a word that may be a name. */
const COLOR_TOKEN = /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?)\([^()]{0,200}\)|\b[a-z]{3,8}\b/gi

/**
 * The colours named in a CSS value, in order, each opaque; a colour drawn at less than half its strength is left
 * out, as it is a shade or an overlay rather than the colour.
 */
export function colorsIn(value: string): Color[] {
  const found: Color[] = []
  for (const [token] of value.slice(0, MAX_VALUE).matchAll(COLOR_TOKEN)) {
    const color = parseColor(token)
    if (color) found.push(color)
  }
  return found
}

/** One CSS colour as `#RRGGBBFF`, or null for anything else or a colour less than half opaque. */
export function parseColor(token: string): Color | null {
  const text = token.trim().toLowerCase()
  if (text.startsWith('#')) return hexColor(text.slice(1))
  const call = /^(rgba?|hsla?)\((.*)\)$/.exec(text)
  if (call?.[1] && call[2] !== undefined) return callColor(call[1], call[2])
  const named = NAMED[text]
  return named
    ? toHex(parseInt(named.slice(0, 2), 16), parseInt(named.slice(2, 4), 16), parseInt(named.slice(4), 16))
    : null
}

/**
 * The colour roles a site fills: Background and Text from the page's own colours (white and black, as a browser
 * draws a page that sets none, once any CSS was read), then Primary, Secondary and Accent from its most used colours
 * that aren't white, black or grey, each clearly different from the others and used at least `MIN_SHARE` as much as
 * Primary. The site's theme colour, when it is such a colour, counts as much as its most used one, and comes first of
 * colours used as much.
 */
export function colorRoles({ used, background, text, read }: SiteColors, themeColor: Color | null): ColorRoles {
  const roles: ColorRoles = {}
  const page = { background: background ?? (read ? '#FFFFFFFF' : null), text: text ?? (read ? '#000000FF' : null) }
  if (page.background) roles.background = page.background
  if (page.text) roles.text = page.text
  const weights = new Map(used)
  if (themeColor && chroma(themeColor) >= MIN_CHROMA)
    weights.set(themeColor, (weights.get(themeColor) ?? 0) + mostUsed(weights))
  const ranked = [...weights]
    .filter(([color]) => chroma(color) >= MIN_CHROMA)
    .sort((a, b) => b[1] - a[1] || Number(b[0] === themeColor) - Number(a[0] === themeColor))
  const picked: [Color, number][] = []
  for (const entry of ranked) {
    const [color, weight] = entry
    const first = picked[0]
    if (first && weight < first[1] * MIN_SHARE) break
    if (picked.some(([other]) => difference(other, color) < MIN_DIFFERENCE)) continue
    picked.push(entry)
    if (picked.length === 3) break
  }
  const [primary, secondary, accent] = picked.map(([color]) => color)
  if (primary) roles.primary = primary
  if (secondary) roles.secondary = secondary
  if (accent) roles.accent = accent
  return roles
}

/** How much the most used colour is used; 0 for none. */
function mostUsed(weights: ReadonlyMap<string, number>): number {
  let most = 0
  for (const weight of weights.values()) most = Math.max(most, weight)
  return most
}

/** A hex colour's digits as a colour, or null. */
function hexColor(digits: string): Color | null {
  if (!/^[0-9a-f]+$/.test(digits)) return null
  const full =
    digits.length === 3 || digits.length === 4
      ? [...digits].map((d) => d + d).join('')
      : digits.length === 6 || digits.length === 8
        ? digits
        : null
  if (!full) return null
  const alpha = full.length === 8 ? parseInt(full.slice(6), 16) / 255 : 1
  if (alpha < 0.5) return null
  return toHex(parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16))
}

/** An rgb() or hsl() call's colour, its arguments split by commas or spaces with the alpha after a slash. */
function callColor(name: string, args: string): Color | null {
  const parts = args
    .replace('/', ' / ')
    .split(/[\s,]+/)
    .filter(Boolean)
  const slash = parts.indexOf('/')
  const channels = slash >= 0 ? parts.slice(0, slash) : parts.slice(0, 3)
  const alphaText = slash >= 0 ? parts[slash + 1] : parts[3]
  if (channels.length !== 3) return null
  const alpha = alphaText === undefined ? 1 : number(alphaText, 1)
  if (alpha === null || alpha < 0.5) return null
  if (name.startsWith('rgb')) {
    const [r, g, b] = channels.map((c) => number(c, 255))
    if (r == null || g == null || b == null) return null
    return toHex(r, g, b)
  }
  const [hText, sText, lText] = channels
  const h = hText === undefined ? null : Number.parseFloat(hText)
  const s = sText === undefined ? null : number(sText, 1)
  const l = lText === undefined ? null : number(lText, 1)
  if (h == null || Number.isNaN(h) || s == null || l == null) return null
  return hslHex(h, s, l)
}

/** A channel's number: a percentage of `full`, or the number itself; null for anything else, a var() included. */
function number(text: string, full: number): number | null {
  const value = Number.parseFloat(text)
  if (Number.isNaN(value) || !/^-?[\d.]+%?$/.test(text)) return null
  return text.endsWith('%') ? (value / 100) * full : value
}

/** An HSL colour, hue in degrees and saturation and lightness from 0 to 1, as a colour. */
function hslHex(h: number, s: number, l: number): Color {
  const hue = (((h % 360) + 360) % 360) / 360
  const c = (1 - Math.abs(2 * l - 1)) * s
  const channel = (offset: number) => {
    const t = (((hue + offset) % 1) + 1) % 1
    const x = t < 1 / 6 ? t * 6 : t < 1 / 2 ? 1 : t < 2 / 3 ? (2 / 3 - t) * 6 : 0
    return (l - c / 2 + c * x) * 255
  }
  return toHex(channel(1 / 3), channel(0), channel(-1 / 3))
}

/** Channels from 0 to 255, clamped and rounded, as an opaque colour. */
function toHex(r: number, g: number, b: number): Color {
  const two = (v: number) =>
    Math.round(Math.min(255, Math.max(0, v)))
      .toString(16)
      .padStart(2, '0')
  return `#${two(r)}${two(g)}${two(b)}FF`.toUpperCase()
}

/** A colour's red, green and blue, from 0 to 255. */
function channels(color: Color): [number, number, number] {
  return [1, 3, 5].map((at) => parseInt(color.slice(at, at + 2), 16)) as [number, number, number]
}

/** How far a colour is from grey, from 0 to 1: its strongest channel less its weakest. */
function chroma(color: Color): number {
  const rgb = channels(color)
  return (Math.max(...rgb) - Math.min(...rgb)) / 255
}

/** How different two colours look: the CIE76 distance of their CIELAB values. */
function difference(a: Color, b: Color): number {
  const [l1, a1, b1] = lab(a)
  const [l2, a2, b2] = lab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

/** A colour's CIELAB value under D65 light. */
function lab(color: Color): [number, number, number] {
  const [r, g, b] = channels(color).map((v) => {
    const c = v / 255
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116)
  const x = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047)
  const y = f(0.2126 * r + 0.7152 * g + 0.0722 * b)
  const z = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883)
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}
