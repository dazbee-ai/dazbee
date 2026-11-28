// The colours of a matched text's runs: the stretches the piece inks in another colour than the
// text's own, as a headline's last dot or one word of a line. The text is drawn once in place with
// every letter in a colour that names it, which says whose each pixel is, and the piece's ink under
// each letter gives the letter's colour. Letters within `SAME_COLOUR` of one another are one colour;
// the colour nearest the layer's is the text's own, and each stretch of letters in another is a run.
// Colours count as apart only when much farther apart than each one's letters are spread, so grain,
// a gradient or a misplaced letter makes no run, and the runs are kept only when the text judged
// with them still looks the same, with fewer far pixels.

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Pixels } from '@dazbee/renderer'
import type { Color, Rgb } from '@dazbee/schema'

import { ciede2000, type Lab, srgbToLab } from '../looks-same/colour.ts'
import { type Judged, LOOKS_SAME } from '../looks-same/rule.ts'
import { hexColour, hexRgb } from '../shape/parts/colour.ts'
import { type DrawnFace, type TextDrawer, textDrawer, type TextLayerProps, textLayerProps } from './draw-text.ts'
import { isCutOut, median } from './ink.ts'
import { closeness, judgeText, type Verified, type VerifyTarget } from './light/verify.ts'

/** A stretch of a text, in UTF-16 units, inked in its own colour. */
export interface ColourRun {
  start: number
  end: number
  style: { color: Color }
}

/** One letter of a text as the piece inks it: its UTF-16 units, and the colour of its ink; null when too little of it was read. */
export interface LetterColour {
  start: number
  end: number
  /** How many pixels of the piece's ink were read under the letter. */
  count: number
  colour: Rgb | null
}

/** A colour of a text's letters: its leading letter's colour, its letters, and how far the farthest of them is from the leading one. */
interface LetterGroup {
  lab: Lab
  letters: number[]
  spread: number
}

/** A letter's colour is read from at least this many pixels of ink; a letter with fewer takes its neighbour's. */
const MIN_READ = 12
/** Letters whose colours are within this ΔE00 are one colour. */
const SAME_COLOUR = 8
/** Two colours of a text are apart when more than this ΔE00 apart, and more than `SPREAD_TIMES` the letters' spread. */
const COLOURS_APART = 16
/** Two colours are apart only when this many times farther apart than the farthest letter of a colour is from its leading letter. */
const SPREAD_TIMES = 3
/** A text with its runs is as close as without them when its closeness is at most this lower: a run moves the SSIM's luminance a hair either way. */
const AS_CLOSE = 0.005
/** The piece's ink is told apart from the layer's colour by its top bits a channel, this many. */
const APART_BITS = 5
/** The colour the naming draw gives what isn't a letter. */
const CLEAR = '#00000000'
/** A letter's number is drawn in the top bits of red and green, this many each, and a check of it in blue's. */
const NAME_BITS = 6
const NAME_MASK = (1 << NAME_BITS) - 1
/** The most letters one naming draw tells apart; a longer text gets no runs. */
const MOST_LETTERS = (NAME_MASK << NAME_BITS) | NAME_MASK

/**
 * The colour runs of a text the matcher verified, judged against `target`, and the text judged with
 * them; null when it gets none. The piece's ink is read under each letter of the text drawn in
 * `faces` (`letterColours`) and the runs made from the letters' colours (`runsOf`); they are kept
 * when the text with them still looks the same, has fewer far pixels than without them, and is as
 * close by the rule's SSIM less the ink missed (`AS_CLOSE`). A text with an outline or with no fill
 * gets none, as its letters' ink isn't their fill alone, and neither does a piece with too little
 * ink apart from the text's colour to read a letter in another (`inkApart`), whose letters aren't
 * read.
 */
export function colourRuns(
  ck: CanvasKit,
  faces: readonly DrawnFace[],
  target: VerifyTarget,
  matched: Pick<Verified, 'look' | 'place' | 'scores'>,
): { runs: ColourRun[]; judged: Judged } | null {
  const { look, place } = matched
  if (look.outline || !/ff$/i.test(look.color)) return null
  const { pixels, ink } = target.reading
  const pieceInk = isCutOut(pixels) ? undefined : ink.data
  if (!inkApart(pixels, look.color, pieceInk)) return null
  const drawer = textDrawer(ck, faces)
  try {
    const letters = letterColours(drawer, pixels, textLayerProps(target.words, look, place), pieceInk)
    const runs = runsOf(target.words, look.color, letters)
    if (runs.length === 0) return null
    const judged = judgeText(drawer, target, look, place, runs)
    const kept =
      judged.same &&
      judged.scores.far < matched.scores.far &&
      closeness(judged.scores) >= closeness(matched.scores) - AS_CLOSE
    return kept ? { runs, judged } : null
  } finally {
    drawer.delete()
  }
}

/**
 * Each letter of a text layer (a grapheme that isn't white space), in the text's order, with the
 * colour the piece inks it in: each channel's median over the piece's pixels that are ink both in the
 * piece and in the letter as drawn. `pieceInk` (0 to 1 a pixel) gives the piece's ink when its alpha
 * covers everything, as a flat crop's does; its letters are read 1 px inside the shared ink, where
 * the colour behind them doesn't mix in. Empty for a text of more letters than one draw can name.
 */
export function letterColours(
  drawer: TextDrawer,
  piece: Pixels,
  layer: TextLayerProps,
  pieceInk?: Float32Array,
): LetterColour[] {
  const letters = lettersOf(layer.text)
  if (letters.length === 0 || letters.length > MOST_LETTERS) return []
  const { width, height } = piece
  // The letters are named by their fill alone, with no outline round them.
  const style: TextLayerProps['style'] = { ...layer.style, color: CLEAR }
  delete style.outline
  const named = drawer.draw(width, height, {
    ...layer,
    style,
    runs: letters.map(({ start, end }, k) => ({ start, end, style: { color: nameColour(k) } })),
  })
  const shared = new Uint8Array(width * height)
  for (let i = 0; i < width * height; i++) {
    const pieceHas = pieceInk ? (pieceInk[i] ?? 0) > 0.5 : (piece.pixels[i * 4 + 3] ?? 0) > 127
    shared[i] = pieceHas && (named.pixels[i * 4 + 3] ?? 0) > 127 ? 1 : 0
  }
  // Each letter's counts of each channel's 256 values, one channel after another.
  const values = new Uint32Array(letters.length * 3 * 256)
  const counts = new Uint32Array(letters.length)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x
      if (!shared[i] || (pieceInk && !inside(shared, width, height, x, y))) continue
      const k = namedLetter(named.pixels, i * 4)
      if (k < 0 || k >= letters.length) continue
      counts[k] = (counts[k] ?? 0) + 1
      for (let c = 0; c < 3; c++) {
        const at = (k * 3 + c) * 256 + (piece.pixels[i * 4 + c] ?? 0)
        values[at] = (values[at] ?? 0) + 1
      }
    }
  return letters.map(({ start, end }, k) => {
    const count = counts[k] ?? 0
    const channel = (c: number) => countedMedian(values, (k * 3 + c) * 256, count)
    return { start, end, count, colour: count >= MIN_READ ? [channel(0), channel(1), channel(2)] : null }
  })
}

/**
 * The runs of `text` from its letters' colours. The letters are grouped by colour, most inked first,
 * each joining the first group whose leading letter is within `SAME_COLOUR`; the group nearest `own`,
 * the colour the layer is set in, is the text's own, and each stretch of letters of another group,
 * with the white space inside it, is a run in the median of the group's letters' colours. A letter
 * with no colour read takes the colour of the letter before it in its word, else of the one after.
 * None when the letters are one group, when two groups, or `own` and a group that isn't the text's
 * own, aren't apart (`COLOURS_APART`, and `SPREAD_TIMES` the largest spread of a group), or when no
 * group is within the colour guard's bar of `own`.
 */
export function runsOf(text: string, own: Color, letters: readonly LetterColour[]): ColourRun[] {
  const groups = groupsOf(letters)
  if (groups.length < 2) return []
  const ownLab = srgbToLab(...hexRgb(own))
  const fromOwn = (group: LetterGroup) => ciede2000(group.lab, ownLab)
  const main = groups.reduce((nearest, group) => (fromOwn(group) < fromOwn(nearest) ? group : nearest))
  if (fromOwn(main) > LOOKS_SAME.text.inkColour) return []
  const apart = Math.max(COLOURS_APART, SPREAD_TIMES * Math.max(...groups.map((group) => group.spread)))
  for (const [i, group] of groups.entries()) {
    if (group !== main && fromOwn(group) <= apart) return []
    for (const other of groups.slice(i + 1)) if (ciede2000(group.lab, other.lab) <= apart) return []
  }
  const groupOf = letterGroups(text, letters, groups)
  const runs: ColourRun[] = []
  let before: LetterGroup | undefined
  for (const [k, { start, end }] of letters.entries()) {
    const group = groupOf[k] ?? main
    const open = group === before ? runs.at(-1) : undefined
    if (group !== main && open) open.end = end
    else if (group !== main) runs.push({ start, end, style: { color: colourOf(group, letters) } })
    before = group
  }
  return runs
}

/**
 * Whether at least `MIN_READ` pixels of the piece's ink are more than `COLOURS_APART` from `own`, the
 * colour the layer is set in, each pixel's colour taken to its top `APART_BITS` bits a channel: with
 * fewer, no letter can be read in a colour apart from the text's own.
 */
function inkApart({ width, height, pixels }: Pixels, own: Color, pieceInk?: Float32Array): boolean {
  const ownLab = srgbToLab(...hexRgb(own))
  const drop = 8 - APART_BITS
  // Whether each colour is apart: 0 while not yet asked, then 1 or 2.
  const apart = new Uint8Array(1 << (3 * APART_BITS))
  const middle = (bits: number) => (bits << drop) | (1 << (drop - 1))
  let count = 0
  for (let i = 0; i < width * height; i++) {
    if (pieceInk ? (pieceInk[i] ?? 0) <= 0.5 : (pixels[i * 4 + 3] ?? 0) <= 127) continue
    const red = (pixels[i * 4] ?? 0) >> drop
    const green = (pixels[i * 4 + 1] ?? 0) >> drop
    const blue = (pixels[i * 4 + 2] ?? 0) >> drop
    const key = (((red << APART_BITS) | green) << APART_BITS) | blue
    let is = apart[key]
    if (!is) {
      is = ciede2000(ownLab, srgbToLab(middle(red), middle(green), middle(blue))) > COLOURS_APART ? 1 : 2
      apart[key] = is
    }
    if (is === 1 && ++count >= MIN_READ) return true
  }
  return false
}

/** The text's letters: its graphemes that aren't white space, as ranges of its UTF-16 units. */
function lettersOf(text: string): { start: number; end: number }[] {
  const letters: { start: number; end: number }[] = []
  for (const { segment, index } of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text))
    if (segment.trim()) letters.push({ start: index, end: index + segment.length })
  return letters
}

/** The colour that names letter `k` in the naming draw: opaque, its number's low and high bits in red and green, a check in blue. */
function nameColour(k: number): Color {
  const name = k + 1
  // The bits sit at the top of the channel, over the middle of the values they leave free.
  const channel = (bits: number) => ((bits & NAME_MASK) << (8 - NAME_BITS)) | (1 << (7 - NAME_BITS))
  return hexColour(channel(name), channel(name >> NAME_BITS), channel(check(name)))
}

/** The check drawn with a letter's number, which a pixel that mixes two letters' colours seldom holds. */
function check(name: number): number {
  return (name * 29 + 11) & NAME_MASK
}

/** Whether the pixel at `x`, `y` and every pixel next to it, corners too, is in the mask; never on the picture's edge. */
function inside(mask: Uint8Array, width: number, height: number, x: number, y: number): boolean {
  if (x < 1 || y < 1 || x > width - 2 || y > height - 2) return false
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!mask[(y + dy) * width + x + dx]) return false
  return true
}

/** The letter the naming draw's pixel at byte `at` names; -1 when it names none. */
function namedLetter(pixels: Uint8Array, at: number): number {
  const bits = (c: number) => (pixels[at + c] ?? 0) >> (8 - NAME_BITS)
  const name = bits(0) | (bits(1) << NAME_BITS)
  return name > 0 && bits(2) === check(name) ? name - 1 : -1
}

/** The median of `count` values from 0 to 255 counted in the 256 cells from `from`, the upper one of an even count. */
function countedMedian(counts: Uint32Array, from: number, count: number): number {
  let upTo = 0
  for (let value = 0; value < 256; value++) {
    upTo += counts[from + value] ?? 0
    if (upTo > count >> 1) return value
  }
  return 255
}

/** The letters with a colour, grouped, most inked first: each joins the first group whose leading letter is within `SAME_COLOUR`. */
function groupsOf(letters: readonly LetterColour[]): LetterGroup[] {
  const groups: LetterGroup[] = []
  const read = letters.flatMap(({ colour, count }, k) => (colour ? [{ k, lab: srgbToLab(...colour), count }] : []))
  read.sort((a, b) => b.count - a.count || a.k - b.k)
  for (const { k, lab } of read) {
    const group = groups.find((g) => ciede2000(g.lab, lab) <= SAME_COLOUR)
    if (group) {
      group.letters.push(k)
      group.spread = Math.max(group.spread, ciede2000(group.lab, lab))
    } else groups.push({ lab, letters: [k], spread: 0 })
  }
  return groups
}

/**
 * Each letter's group. A letter with no colour read takes the group of the nearest letter before it
 * in its word that has one, else of the nearest after it in its word; none when its word has none.
 */
function letterGroups(
  text: string,
  letters: readonly LetterColour[],
  groups: readonly LetterGroup[],
): (LetterGroup | undefined)[] {
  const groupOf: (LetterGroup | undefined)[] = letters.map(() => undefined)
  for (const group of groups) for (const k of group.letters) groupOf[k] = group
  const sameWord = (a: number, b: number) => !/\s/.test(text.slice(letters[a]?.end, letters[b]?.start))
  for (let k = 1; k < letters.length; k++) if (!groupOf[k] && sameWord(k - 1, k)) groupOf[k] = groupOf[k - 1]
  for (let k = letters.length - 2; k >= 0; k--) if (!groupOf[k] && sameWord(k, k + 1)) groupOf[k] = groupOf[k + 1]
  return groupOf
}

/** A group's colour: each channel's median over its letters' colours. */
function colourOf(group: LetterGroup, letters: readonly LetterColour[]): Color {
  const colours = group.letters.flatMap((k) => {
    const colour = letters[k]?.colour
    return colour ? [colour] : []
  })
  const channel = (c: 0 | 1 | 2) => median(colours.map((colour) => colour[c]))
  return hexColour(channel(0), channel(1), channel(2))
}
