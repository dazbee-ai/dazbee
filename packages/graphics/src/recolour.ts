// A few-colour artwork file's colours swapped for one colour given: the set's first paint colour is written as it,
// and each other paint colour as the same mix of it with white or black as that colour is of the first, wherever the
// file paints with them (fill, stroke, stop and colour attributes and style declarations), and nowhere else.

/** Red, green and blue, each 0 to 255. */
type Rgb = [number, number, number]

/** What a colour given is written as: # and six hex digits. */
const HEX = /^#[0-9a-fA-F]{6}$/
/** The colour words an artwork file may paint with, as #rrggbb; `currentColor` is black, as SVG's default colour. */
const NAMED: Readonly<Record<string, string>> = { black: '#000000', white: '#ffffff', currentcolor: '#000000' }
/** The properties a paint colour is written in. */
const PAINTS = 'fill|stroke|stop-color|color|flood-color'

/**
 * The file's text with each of `paints` (as the file writes them, any case) written as `to` (#rrggbb) or its mix:
 * the first as `to`, each other as the same mix of `to` with white or black as it is of the first. With `firstAs`, the
 * first is written as that colour instead, the others still mixed from `to`.
 */
export function recolour(text: string, paints: readonly string[], to: string, firstAs: string = to): string {
  if (!HEX.test(to) || !HEX.test(firstAs)) throw new Error(`a colour is #rrggbb, not ${to} or ${firstAs}`)
  const [first] = paints
  if (!first) return text
  const base = rgbOf(first)
  const written = new Map(paints.map((paint) => [paint.toLowerCase(), hexOf(likeMix(base, rgbOf(paint), rgbOf(to)))]))
  for (const paint of paints) if (hexOf(rgbOf(paint)) === hexOf(base)) written.set(paint.toLowerCase(), firstAs)
  return text.replace(
    paintPattern(paints),
    (_, before: string, paint: string) => `${before}${written.get(paint.toLowerCase()) ?? to}`,
  )
}

/** Whether the file paints with any of `paints`, as `recolour` finds them. */
export function paintsWithAny(text: string, paints: readonly string[]): boolean {
  return paints.length > 0 && paintPattern(paints).test(text)
}

/** Where the file paints with any of `paints`: the property and what comes before the colour, then the colour. */
function paintPattern(paints: readonly string[]): RegExp {
  const tokens = paints.map((paint) => paint.replace(/[#()]/g, (c) => `\\${c}`)).join('|')
  return new RegExp(`((?:${PAINTS})\\s*(?:=\\s*["']|:\\s*))(${tokens})(?=["';\\s)}]|$)`, 'gi')
}

/** A colour (#rgb, #rrggbb, black, white or currentColor) as red, green and blue. */
function rgbOf(colour: string): Rgb {
  const named = NAMED[colour.toLowerCase()]
  let hex = (named ?? colour).replace('#', '')
  if (hex.length === 3) hex = [...hex].map((digit) => digit + digit).join('')
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`${colour} is not a colour a paint is swapped from`)
  return [0, 2, 4].map((at) => parseInt(hex.slice(at, at + 2), 16)) as Rgb
}

/** #rrggbb of a colour. */
function hexOf(rgb: Rgb): string {
  return `#${rgb
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`
}

/**
 * The colour that is the same mix of `to` with white (or black) as `paint` is of `base`: how far each channel of
 * `paint` moved from `base` towards white (or black), fitted as one share, then applied to `to`.
 */
function likeMix(base: Rgb, paint: Rgb, to: Rgb): Rgb {
  if (paint.every((channel, i) => channel === base[i])) return to
  const lighter = paint.reduce((sum, channel) => sum + channel, 0) >= base.reduce((sum, channel) => sum + channel, 0)
  const end = lighter ? 255 : 0
  let along = 0
  let span = 0
  for (const [i, from] of base.entries()) {
    along += ((paint[i] ?? 0) - from) * (end - from)
    span += (end - from) ** 2
  }
  const share = span === 0 ? 0 : Math.min(1, Math.max(0, along / span))
  return to.map((channel) => channel + (end - channel) * share) as Rgb
}
