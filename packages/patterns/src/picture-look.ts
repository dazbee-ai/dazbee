// What a picture shows, read from its pixels: the box of its subject (a cut-out's opaque part, else the part with
// edges in it, as a plain or softly shaded backdrop has none), the colour of its backdrop when its edge is one even
// colour (a logo drawn on a white box), and the colours of its ink. The patterns crop a photo to its subject, and set
// a logo where its ink reads.
import type { Rect } from '@dazbee/schema'

import { contrast } from './palette.ts'

/** A colour of a picture's ink, and the share of its ink in it. */
export interface PictureInk {
  /** As #RRGGBBFF. */
  colour: string
  share: number
}

/** What a picture shows, read from its pixels. */
export interface PictureLook {
  /** The box of what it shows, in its pixels. */
  subject: Rect
  /** The colour round its edge, as #RRGGBBFF, where its edge is opaque and one even colour; none for a cut-out. */
  backdrop?: string
  /** The colours of what it shows, most first. */
  inks: PictureInk[]
}

/** The longest side the pixels are read at. */
const READ_AT = 256
/** The least alpha of a pixel that is drawn. */
const OPAQUE = 128
/** How far apart, in RGB, two colours are told apart. */
const APART = 48
/** The least change from one pixel to the next, in RGB, that is an edge. */
const EDGE = 36
/** The share of edge or ink pixels left out at each side of the subject's box, so a stray pixel doesn't widen it. */
const STRAY = 0.01
/** The most ink colours told. */
const MOST_INKS = 6

/** What a picture of `width` × `height` shows, from its pixels as RGBA, unpremultiplied, row by row. */
export function pictureLook(rgba: Uint8Array, width: number, height: number): PictureLook {
  const step = Math.max(1, Math.ceil(Math.max(width, height) / READ_AT))
  const cols = Math.floor(width / step)
  const rows = Math.floor(height / step)
  const at = (c: number, r: number) => ((r * step + Math.floor(step / 2)) * width + c * step + Math.floor(step / 2)) * 4
  const rgb = (i: number): [number, number, number] => [rgba[i] ?? 0, rgba[i + 1] ?? 0, rgba[i + 2] ?? 0]
  const alpha = (i: number) => rgba[i + 3] ?? 0
  const edge: number[] = []
  for (let c = 0; c < cols; c++) edge.push(at(c, 0), at(c, rows - 1))
  for (let r = 1; r < rows - 1; r++) edge.push(at(0, r), at(cols - 1, r))
  const clearEdge = edge.filter((i) => alpha(i) < OPAQUE).length / Math.max(1, edge.length)
  const cutOut = clearEdge > 0.5
  const backdrop = cutOut ? undefined : evenColour(edge.map(rgb))
  // A pixel of what the picture shows: an opaque one of a cut-out, one apart from an even backdrop, or, on a backdrop
  // that varies, one where the colour changes sharply.
  const shown = (c: number, r: number): boolean => {
    const i = at(c, r)
    if (cutOut) return alpha(i) >= OPAQUE
    if (backdrop) return apart(rgb(i), backdrop) > APART
    if (c + 1 >= cols || r + 1 >= rows) return false
    return apart(rgb(i), rgb(at(c + 1, r))) + apart(rgb(i), rgb(at(c, r + 1))) > EDGE
  }
  const xs: number[] = []
  const ys: number[] = []
  const inks: [number, number, number][] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      if (shown(c, r)) {
        xs.push(c)
        ys.push(r)
        if (cutOut || backdrop) inks.push(rgb(at(c, r)))
      }
  if (xs.length === 0) return { subject: { x: 0, y: 0, width, height }, inks: [] }
  // Edges stray over a varied backdrop, so a few are left out; a cut-out's or a plain backdrop's ink is all kept, with
  // a read pixel's width round it.
  const stray = cutOut || backdrop ? 0 : STRAY
  const [left, right] = spanOf(xs, stray)
  const [top, bottom] = spanOf(ys, stray)
  const pad = stray === 0 ? 1 : 0
  const x0 = Math.max(0, (left - pad) * step)
  const y0 = Math.max(0, (top - pad) * step)
  const subject = {
    x: x0,
    y: y0,
    width: Math.min(width, (right + 1 + pad) * step) - x0,
    height: Math.min(height, (bottom + 1 + pad) * step) - y0,
  }
  // On a backdrop that varies, what the edges hold is the subject's ink.
  if (!cutOut && !backdrop)
    for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) inks.push(rgb(at(c, r)))
  return { subject, ...(backdrop ? { backdrop: hex(backdrop) } : {}), inks: inkColours(inks) }
}

/** Whether a picture's ink reads on `surface`: most of it at 3:1, and none of it worth telling lost on it. */
export function inkReads(look: PictureLook, surface: string): boolean {
  if (look.inks.length === 0) return true
  const share = (test: (ratio: number) => boolean) =>
    look.inks.filter((ink) => test(contrast(ink.colour, surface))).reduce((sum, ink) => sum + ink.share, 0)
  return share((ratio) => ratio >= 3) >= 0.6 && share((ratio) => ratio < 1.6) <= 0.1
}

/** Whether a picture's ink is one colour, so it can be drawn in another. */
export function oneInk(look: PictureLook): boolean {
  return (look.inks[0]?.share ?? 0) >= 0.9
}

/** The colour most of `colours` are within a short way of, or none when they vary. */
function evenColour(colours: readonly [number, number, number][]): [number, number, number] | undefined {
  if (colours.length === 0) return undefined
  const middle = [0, 1, 2].map((ch) => {
    const sorted = colours.map((c) => c[ch] ?? 0).sort((a, b) => a - b)
    return sorted[Math.floor(sorted.length / 2)] ?? 0
  }) as [number, number, number]
  const near = colours.filter((c) => apart(c, middle) <= 24).length / colours.length
  return near >= 0.9 ? middle : undefined
}

/** The span a run of positions takes, `stray` of them at each end left out. */
function spanOf(values: number[], stray: number): [number, number] {
  const sorted = [...values].sort((a, b) => a - b)
  const cut = Math.floor(sorted.length * stray)
  return [sorted[cut] ?? 0, sorted[sorted.length - 1 - cut] ?? 0]
}

/** The colours of the ink, close ones taken as one, most first, each with its share. */
function inkColours(pixels: readonly [number, number, number][]): PictureInk[] {
  const groups: { sum: [number, number, number]; count: number }[] = []
  for (const pixel of pixels) {
    const near = groups.find((g) => apart(meanOf(g), pixel) <= APART)
    const group = near ?? groups[groups.push({ sum: [0, 0, 0], count: 0 }) - 1]
    if (!group) continue
    group.sum = [group.sum[0] + pixel[0], group.sum[1] + pixel[1], group.sum[2] + pixel[2]]
    group.count++
  }
  const total = pixels.length
  return groups
    .sort((a, b) => b.count - a.count)
    .slice(0, MOST_INKS)
    .map((g) => ({ colour: hex(meanOf(g)), share: Math.round((g.count / total) * 1000) / 1000 }))
}

/** A group's mean colour. */
function meanOf({ sum, count }: { sum: [number, number, number]; count: number }): [number, number, number] {
  return [sum[0] / count, sum[1] / count, sum[2] / count]
}

/** How far apart two colours are, in RGB. */
function apart(a: readonly number[], b: readonly number[]): number {
  return Math.hypot((a[0] ?? 0) - (b[0] ?? 0), (a[1] ?? 0) - (b[1] ?? 0), (a[2] ?? 0) - (b[2] ?? 0))
}

/** A colour as #RRGGBBFF. */
function hex(colour: readonly number[]): string {
  const byte = (v: number | undefined) =>
    Math.round(v ?? 0)
      .toString(16)
      .padStart(2, '0')
  return `#${byte(colour[0])}${byte(colour[1])}${byte(colour[2])}FF`.toUpperCase()
}
