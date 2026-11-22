/* eslint-disable max-lines -- one deep module: stackWords and rowWords fit a pattern's words to their room by one search for the lead's size */
// A pattern's words: its texts and button set in the style's type, as large as fits the room they are given, each
// text in an ink that reads on what is behind it. In a column (`stackWords`) they stack in auto layout boxes, so a
// longer headline pushes the rest down; in a row (`rowWords`), for a strip, they sit beside the button.
import { type Effect, type Rect, TextProps } from '@dazbee/schema'

import { BUTTON_SIDE, BUTTON_SIDE_TIGHT, type ButtonFill, buttonPart, buttonSize } from './button.ts'
import { type FrameRoom, SHORT_FRAME } from './frame-shape.ts'
import { highlightRuns, KEEP, kept, underlined, UNDERLINED_LEADING, unitRuns } from './headline-runs.ts'
import type { Palette, Swatch } from './palette.ts'
import type { Style, TextLook } from './styles.ts'
import { inkFor, lookStyle } from './text-look.ts'
import { type Part, round, type TreeBuilder } from './tree.ts'
import type { Measure } from './types.ts'

/** The kinds of text a pattern sets, each in its look and at its share of the lead text's size. */
export type TextKind = 'kicker' | 'headline' | 'number' | 'subline' | 'attribution'

/** A text of the words, top to bottom. */
export interface WordPart {
  kind: TextKind
  text: string
  /** Words of it set apart. */
  highlight?: string
  /** Its ink, where it isn't the first of the kit's text and background colours that reads. */
  ink?: Swatch
  /** Its effects, such as a shadow. */
  effects?: Effect[]
}

/** What the words are set with: the style, the pattern's colours and fonts, the frame and the fonts' measure. */
export interface Setting {
  style: Style
  palette: Palette
  frame: FrameRoom
  measure: Measure
}

/** Words to set in a room. */
export interface Words {
  /** The id of the words' box, and the start of its title's: `words` when left out. */
  key?: string
  parts: WordPart[]
  /** The button's label, under the texts. */
  button?: string
  /** The button's colour; its label takes an ink that reads on it. */
  buttonFill?: ButtonFill
  room: Rect
  /** The colour behind the words, which their inks must read on. */
  surface: string
  /** Where the words sit down the room: `optical` a little over its middle, where the eye takes the middle to be. */
  justify?: 'start' | 'center' | 'optical' | 'end'
  /** How they line up; the style's way when left out. */
  align?: 'start' | 'center'
  /** The largest the lead text may be; the style's share of the frame's shorter side when left out. */
  most?: number
  /** Whether the button sits at the room's foot, apart from the texts, which sit by `justify` in the room above it. */
  pin?: boolean
  /** The lead size, set elsewhere, that a button with no texts beside it stays under by the style's step. */
  leadElsewhere?: number
  /** The size of a button label set beside the words, which their lead stays over by the style's step. */
  labelBeside?: number
  /** Whether the room between the parts is closed down to the least the style takes. */
  tight?: boolean
  /** Whether the lead may be set as small as the readable size, the last a strip tries before its words don't fit. */
  floor?: boolean
}

/** The size the words were set at, and the box they take. */
export interface SetWords {
  /** The lead text's size. */
  size: number
  /** Whether the words fit their room at their smallest, with the parts that could be left out left out. */
  fits: boolean
  /** The box the texts and button take, inside the room. */
  box: Rect
  /** The box the texts take, without the button. */
  texts: Rect
  /** How wide the lead text is set, no wider than the room. */
  leadWidth: number
}

/** A text's props as the words set it, with the ink and font it is bound to. */
interface SetText {
  props: Record<string, unknown>
  ink: Swatch
  font: Swatch
}

/** What fits: the lead's size, each part's height, the button's, the whole height, and whether it fits the room. */
interface Fit {
  size: number
  heights: Map<WordPart, number>
  button?: { size: number; least: number; side: number; width: number; height: number }
  total: number
  fits: boolean
  /** Whether the room between the parts was closed down. */
  tight: boolean
}

/** Each kind's look in the style, its share of the lead's size and the most lines it may take. */
const KINDS: Record<TextKind, { look: 'headline' | 'kicker' | 'body'; share: number; lines: number }> = {
  number: { look: 'headline', share: 1, lines: 1 },
  headline: { look: 'headline', share: 1, lines: 4 },
  kicker: { look: 'kicker', share: 0.3, lines: 2 },
  subline: { look: 'body', share: 0.4, lines: 4 },
  attribution: { look: 'kicker', share: 0.26, lines: 3 },
}
/** When the number leads, the share of its size each other kind takes. */
const UNDER_NUMBER: Partial<Record<TextKind, number>> = { headline: 0.25, kicker: 0.11, subline: 0.14 }
/** The parts left out, in turn, when the words don't fit at their smallest: a quote's attribution last. */
const LEFT_OUT_FIRST: readonly TextKind[] = ['subline', 'kicker', 'attribution']
/** The frame heights under which the subline, and at which the kicker, are left out: a banner shows its headline. */
const SUBLINE_LEAST_HEIGHT = 120
const KICKER_LEAST_HEIGHT = 100
/** The most lines any text takes in a short frame. */
export const SHORT_FRAME_LINES = 2
/**
 * How many times the button label's size the lead is at least: quieter in a style that slants its highlight, and
 * more on a display size, where the message must lead the button at a glance.
 */
const OVER_BUTTON = 1.5
const OVER_BUTTON_QUIET = 1.3
const OVER_BUTTON_DISPLAY = 1.6
/** The most of the lead's block a button covers, by area, so the message, not the button, is seen first. */
const BUTTON_AREA_MOST = 0.8
/** How many times the headline's size a number is at least. */
const NUMBER_OVER_HEADLINE = 2
/** How many times the style's largest headline a number may be, and the most of its room's height it takes. */
const NUMBER_MOST = 3.4
const NUMBER_HEIGHT_MOST = 0.45
/** The least shorter side of a frame whose lead keeps the style's scale over its subline. */
const SCALED_FRAME = 600
/** A button's least height, as a share of the frame's shorter side: on a display banner, and on a social frame. */
const BUTTON_LEAST_DISPLAY = 0.15
const BUTTON_LEAST_SOCIAL = 0.055
/** The largest a strip's lead is, as a share of its height. */
const STRIP_LEAD_MOST = 0.38
/** Each kind's layer name. */
const NAMES: Record<TextKind, string> = {
  kicker: 'Kicker',
  headline: 'Headline',
  number: 'Number',
  subline: 'Subline',
  attribution: 'Attribution',
}
/** A button label's share of the lead's size, and its most as a share of the frame's shorter side. */
const BUTTON_SHARE = 0.32
const BUTTON_MOST = 0.042
/** The room between the kicker and the headline, as a share of the lead's size. */
const TITLE_GAP = 0.12
/** The least tracking a held kicker or attribution is eased to, as a percentage of its size, in steps of this. */
const TRACKING_LEAST = 8
const TRACKING_STEP = 2
/** The share of the style's room between parts left where it is closed down to keep every part. */
const TIGHT_GAP = 0.6
/** Where words sit down their room when lined up by eye: their free height's share over them. */
const OPTICAL = 0.44
/** The lead text's least size, as a multiple of the readable size. */
const LEAD_LEAST = 1.25

/** Sets the words in their room as auto layout columns, and gives the size they were set at and the box they take. */
export function stackWords(tree: TreeBuilder, setting: Setting, words: Words, parent?: string): SetWords {
  const { frame, style } = setting
  const align = words.align ?? style.align
  const fit = fewestLeftOut(setting, words)
  const { size, heights, button, parts } = fit
  const { room } = words
  const key = words.key ?? 'words'
  const gap = round(gapBase(parts, size) * gapOf(style, fit.tight))
  const inner = round(gapBase(parts, size) * TITLE_GAP)
  // A pinned button sits at the room's foot, and the texts by `justify` in the room above it.
  const pinned = Boolean(words.pin && button && words.button && parts.length > 0)
  const below = pinned && button ? button.height + gap : 0
  const textsHeight = fit.total - below
  const free = room.height - fit.total
  const top = room.y + { start: 0, center: free / 2, optical: free * OPTICAL, end: free }[words.justify ?? 'center']
  const box = { x: room.x, y: round(top), width: room.width, height: pinned ? textsHeight : fit.total }
  const outer = tree.add(key, column('Words', box, gap, align, false), parent)
  // The kicker and the headline sit closer than the rest, in a column of their own.
  const titled = parts.findIndex((part) => part.kind === 'headline' || part.kind === 'number')
  let holder = outer
  if (titled > 0) {
    const title = parts.slice(0, titled + 1)
    const height = title.reduce((sum, part) => sum + (heights.get(part) ?? 0), 0) + inner * titled
    holder = tree.add(`${key}-title`, column('Title', { ...box, height: round(height) }, inner, align, true), outer)
  }
  let y = box.y
  for (const [i, part] of parts.entries()) {
    const height = heights.get(part) ?? 0
    const set = textOf(setting, words, part, sizeOf(part, parts, size, frame), align, room.width, size)
    const placed = { ...set, props: { ...set.props, y: round(y), height: round(height) } }
    tree.add(part.kind, textPart(part, placed), i <= titled ? holder : outer)
    y += height + (i < titled ? inner : gap)
  }
  if (button && words.button) {
    const x = align === 'center' ? room.x + (room.width - button.width) / 2 : room.x
    const at = pinned ? room.y + room.height - button.height : y
    const holder = pinned ? parent : outer
    buttonPart(tree, setting, words, button.size, holder, { x: round(x), y: round(at) }, button.least, button.side)
  }
  const whole = pinned ? { ...box, height: round(room.y + room.height - box.y) } : box
  const texts = { ...box, height: round(textsHeight - (pinned || !button ? 0 : button.height + gap)) }
  return { size, fits: fit.fits, box: whole, texts, leadWidth: leadWidthOf(setting, words, parts, size, align) }
}

/**
 * Sets a strip's words in a row: the texts in a column taking the room the button leaves, the button at the end, as
 * large as fits the room's height. Where they don't fit, the button's label is set at the readable size with less
 * room at its ends.
 */
export function rowWords(tree: TreeBuilder, setting: Setting, words: Words, parent?: string): SetWords {
  const { frame } = setting
  const { room } = words
  const least = buttonLeast(frame)
  const gap = rowGap(setting, words)
  const tried = rowTries(setting, words)
  const chosen = tried.find(({ fit }) => fit.fits) ?? tried.at(-1)
  if (!chosen) throw new Error('no row tried')
  const { label, side, button, width, texts, fit } = chosen
  const row = tree.add(
    'words',
    { type: 'box', name: 'Words', props: { ...room, clip: false, layout: { direction: 'row', gap, align: 'center' } } },
    parent,
  )
  const inner = round(fit.size * TITLE_GAP)
  const top = room.y + (room.height - fit.total) / 2
  const box = { x: room.x, y: round(top), width, height: fit.total }
  const holder = fit.parts.length > 0 ? tree.add('text-column', column('Text', box, inner, 'start', true), row) : row
  let y = top
  for (const part of fit.parts) {
    const height = fit.heights.get(part) ?? 0
    const text = textOf(setting, texts, part, sizeOf(part, fit.parts, fit.size, frame), 'start', width, fit.size)
    tree.add(
      part.kind,
      textPart(part, { ...text, props: { ...text.props, y: round(y), height: round(height) } }),
      holder,
    )
    y += height + inner
  }
  if (button && words.button) {
    const at = { x: room.x + width + gap, y: round(room.y + (room.height - button.height) / 2) }
    buttonPart(tree, setting, words, label, row, at, least, side)
  }
  return {
    size: fit.size,
    fits: fit.fits,
    box: room,
    texts: box,
    leadWidth: leadWidthOf(setting, texts, fit.parts, fit.size, 'start'),
  }
}

/** Whether a strip's words fit beside its button, in one of the ways rowWords tries. */
export function rowFits(setting: Setting, words: Words): boolean {
  return rowTries(setting, words).some(({ fit }) => fit.fits)
}

/** The size of a strip's button label, set beside its words: a share of its safe room's height. */
export function stripLabel(frame: FrameRoom): number {
  return Math.max(frame.readable, Math.round(Math.min(frame.safe.height * 0.3, frame.height * 0.2)))
}

/** The least size a lead is set at beside or over a button label of `label`. */
export function leadBeside({ frame, style }: Setting, label: number): number {
  return Math.ceil(Math.max(frame.readable * LEAD_LEAST, label * overButton(style, frame)))
}

/**
 * The least width `part` takes set in `lines` lines at `size`: its width in one line shared out, with a tenth more
 * for lines that don't break even, and never less than its longest run of words kept together.
 */
export function leadWidth(setting: Setting, part: WordPart, size: number, lines: number): number {
  const words: Words = { parts: [part], room: { x: 0, y: 0, width: 10_000, height: 10_000 }, surface: '#FFFFFFFF' }
  const props = TextProps.parse(textOf(setting, words, part, size, 'start', 10_000).props)
  const whole = setting.measure(props, null).width
  const runs = props.text.split(/[ \t\n]+/).map((text) => setting.measure({ ...props, text, runs: [] }, null).width)
  return Math.ceil(Math.max(...runs, (whole / lines) * 1.1))
}

/** The room between a strip's texts and its button. */
function rowGap({ frame }: Setting, { room }: Words): number {
  return round(Math.max(frame.margin, room.height * 0.25))
}

/**
 * The ways a strip's words are tried, in turn: the button's label at the strip's size, then at the readable size
 * with less room at its ends, then the lead let down to the readable size too, as a strip keeps its logo, lead and
 * button before its type scale.
 */
function rowTries(setting: Setting, words: Words) {
  const { frame } = setting
  const { room } = words
  const least = buttonLeast(frame)
  const gap = rowGap(setting, words)
  return [
    { label: stripLabel(frame), side: BUTTON_SIDE, floor: false },
    { label: frame.readable, side: BUTTON_SIDE_TIGHT, floor: false },
    { label: frame.readable, side: BUTTON_SIDE_TIGHT, floor: true },
  ].map(({ label, side, floor }) => {
    const button = words.button ? buttonSize(setting, words.button, label, least, side) : undefined
    const width = room.width - (button ? button.width + gap : 0)
    const texts: Words = {
      ...words,
      room: { ...room, width },
      align: 'start',
      ...(floor ? { floor } : { labelBeside: label }),
    }
    delete texts.button
    return { label, side, button, width, texts, fit: fewestLeftOut(setting, texts) }
  })
}

/** How wide the lead text of `parts` is set at `size`: its one line's width, or the room's for more. */
function leadWidthOf(
  setting: Setting,
  words: Words,
  parts: readonly WordPart[],
  size: number,
  align: 'start' | 'center',
) {
  const lead = parts.find((part) => part.kind === 'headline' || part.kind === 'number')
  if (!lead) return 0
  const props = TextProps.parse(textOf(setting, words, lead, size, align, words.room.width).props)
  return Math.min(words.room.width, Math.ceil(setting.measure(props, null).width))
}

/**
 * The largest fit of the words: the subline left out of a frame too short for it and the kicker of a banner, then
 * the subline, the kicker and the attribution in turn while they don't fit at their smallest.
 */
function fewestLeftOut(setting: Setting, words: Words): Fit & { parts: WordPart[] } {
  const { height } = setting.frame
  let parts = words.parts.filter(
    (part) =>
      !(part.kind === 'subline' && height < SUBLINE_LEAST_HEIGHT) &&
      !(part.kind === 'kicker' && height <= KICKER_LEAST_HEIGHT),
  )
  // Before a part is left out, the room between the parts is closed down to the least the style takes.
  const tightest = (): Fit => {
    const loose = largestFit(setting, { ...words, parts })
    if (loose.fits || words.tight) return loose
    const tight = largestFit(setting, { ...words, parts, tight: true })
    return tight.fits ? tight : loose
  }
  let fit = tightest()
  for (const kind of LEFT_OUT_FIRST) {
    if (fit.fits) break
    const fewer = parts.filter((part) => part.kind !== kind)
    if (fewer.length === parts.length) continue
    parts = fewer
    fit = tightest()
  }
  // A short frame keeps its lead, set down to the readable size, before its words don't fit.
  if (!fit.fits && height <= SHORT_FRAME && !words.floor) {
    const floored = largestFit(setting, { ...words, parts, floor: true })
    if (floored.fits) fit = floored
  }
  return { ...fit, parts }
}

/** Whether the words fit their room, with the parts that may be left out left out. */
export function fitsRoom(setting: Setting, words: Words): boolean {
  return fewestLeftOut(setting, words).fits
}

/** The size the words' lead is set at in their room, with the parts that may be left out left out. */
export function leadSizeIn(setting: Setting, words: Words): number {
  return fewestLeftOut(setting, words).size
}

/** Whether the words fit their room with none of their parts left out. */
export function keepsEvery(setting: Setting, words: Words): boolean {
  return fewestLeftOut(setting, words).parts.length === words.parts.length
}

/** The largest lead size, a pixel at a time, at which the words fit their room; their smallest when none does. */
function largestFit(setting: Setting, words: Words): Fit {
  // The lead over its subline by the style's scale where that fits, else as small as the rest lets it be.
  let least = leadLeast(setting, words, true)
  let best = measured(setting, words, least)
  if (!best.fits) {
    least = leadLeast(setting, words, false)
    best = measured(setting, words, least)
  }
  const most = Math.max(least, leadMost(setting, words))
  if (!best.fits) return best
  let lo = least
  let hi = most
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    const at = measured(setting, words, mid)
    if (at.fits) {
      best = at
      lo = mid
    } else hi = mid - 1
  }
  return best
}

/**
 * The least the lead text may be: a share over the readable size, and over a button label at the readable size by
 * the style's step; when `scaled`, over a subline by the style's scale in a frame 600 px or more each way, so the
 * lead, not the subline, is read first; a number twice that, so it stays over the headline under it, but in a short frame, whose
 * number sits beside its words.
 */
function leadLeast({ frame, style }: Setting, words: Words, scaled: boolean): number {
  if (words.floor) return frame.readable
  const number = words.parts.some((part) => part.kind === 'number')
  const step = words.button ? Math.max(LEAD_LEAST, overButton(style, frame)) : LEAD_LEAST
  const beside = (words.labelBeside ?? 0) * overButton(style, frame)
  const subline =
    scaled && Math.min(frame.width, frame.height) >= SCALED_FRAME && words.parts.some((part) => part.kind === 'subline')
      ? frame.readable * style.scale
      : 0
  const over = number && frame.height > SHORT_FRAME ? NUMBER_OVER_HEADLINE : 1
  return Math.ceil(Math.max(frame.readable * step, beside, subline) * over)
}

/**
 * The largest the lead text may be: the style's share of the frame's shorter side; a number with words under it as
 * wide as their room and no taller than NUMBER_HEIGHT_MOST of it, so it fills the measure as the hero of the frame.
 */
function leadMost(setting: Setting, words: Words): number {
  const { frame, style } = setting
  if (words.most !== undefined) return Math.floor(words.most)
  if (frame.shape === 'strip') return Math.floor(frame.height * STRIP_LEAD_MOST)
  const short = Math.min(frame.width, frame.height)
  const number = words.parts.find((part) => part.kind === 'number')
  if (!number) return Math.floor(style.headlineMax * short)
  const at = 100
  const props = TextProps.parse(textOf(setting, words, number, at, 'start', words.room.width).props)
  const wide = setting.measure(props, null).width
  const across = (words.room.width / Math.max(1, wide)) * at
  const down = (words.room.height * NUMBER_HEIGHT_MOST) / (props.style.lineHeight ?? 1.2)
  return Math.floor(Math.min(style.headlineMax * short * NUMBER_MOST, across, down))
}

/** The words measured with the lead at `size`. */
function measured(setting: Setting, words: Words, size: number): Fit {
  const { frame, style, measure } = setting
  const { room, parts } = words
  const align = words.align ?? style.align
  const heights = new Map<WordPart, number>()
  let fits = true
  let total = 0
  let block = 0
  let blockArea = 0
  for (const part of parts) {
    const props = TextProps.parse(
      textOf(setting, words, part, sizeOf(part, parts, size, frame), align, room.width, size).props,
    )
    const { height } = measure(props, props.width)
    // Each run of words kept together must fit a line, measured in the text's own face and in the heaviest of its
    // runs' faces, whichever is wider.
    const weight = Math.max(props.style.fontWeight, ...props.runs.map((run) => run.style.fontWeight ?? 0))
    const italic = props.runs.some((run) => run.style.fontStyle === 'italic')
    const heaviest = { ...props.style, fontWeight: weight, ...(italic ? { fontStyle: 'italic' as const } : {}) }
    const runsOfWords = props.text.split(/[ \t\n]+/)
    const word = Math.max(
      ...runsOfWords.flatMap((text) =>
        [props.style, heaviest].map((style) => measure({ ...props, text, style, runs: [] }, null).width),
      ),
    )
    const lineHeight = props.style.fontSize * (props.style.lineHeight ?? 1.2)
    const lines = Math.round(height / lineHeight)
    // SkParagraph lays text out at its width cut to a whole pixel.
    if (Math.ceil(word) > Math.floor(room.width) || lines > linesOf(part.kind, frame)) fits = false
    if (part.kind === 'headline' || part.kind === 'number') {
      const natural = measure(props, null).width
      block = Math.max(block, Math.min(room.width, natural / Math.max(1, lines)))
      blockArea += Math.min(room.width, natural / Math.max(1, lines)) * height
    }
    heights.set(part, height)
    total += height
  }
  const titled = parts.findIndex((part) => part.kind === 'headline' || part.kind === 'number')
  const base = gapBase(parts, size)
  const gap = gapOf(style, words.tight)
  total += parts.reduce((sum, _part, i) => sum + (i === 0 ? 0 : i <= titled ? base * TITLE_GAP : base * gap), 0)
  let button: Fit['button']
  if (words.button) {
    const lead = parts.length > 0 ? size : (words.leadElsewhere ?? size)
    const most = parts.length > 0 ? blockArea * BUTTON_AREA_MOST : Number.POSITIVE_INFINITY
    button = buttonFor(setting, words.button, lead, Math.min(room.width, block || room.width), most)
    if (button.width > room.width) fits = false
    total += button.height + (parts.length > 0 ? base * gap : 0)
  }
  return {
    size,
    heights,
    ...(button ? { button } : {}),
    total: Math.ceil(total),
    fits: fits && total <= room.height,
    tight: Boolean(words.tight),
  }
}

/**
 * The button for a lead at `size`: its label a share of the lead's size, under the lead by the style's step, never
 * under the readable size, set smaller while the button is wider than `widest` or covers more than `most` square
 * pixels; at least as tall as the frame asks of a button.
 */
function buttonFor(
  setting: Setting,
  text: string,
  size: number,
  widest: number,
  most = Number.POSITIVE_INFINITY,
): NonNullable<Fit['button']> {
  const { frame, style } = setting
  const short = Math.min(frame.width, frame.height)
  const least = buttonLeast(frame)
  const share = Math.round(Math.min(size * BUTTON_SHARE, short * BUTTON_MOST))
  let label = Math.max(frame.readable, Math.min(share, Math.floor(size / overButton(style, frame))))
  let sized = buttonSize(setting, text, label, least)
  if (sized.width > widest && label > frame.readable) {
    label = Math.max(frame.readable, Math.floor((label * widest) / sized.width))
    sized = buttonSize(setting, text, label, least)
    while (sized.width > widest && label > frame.readable) sized = buttonSize(setting, text, --label, least)
  }
  while (sized.width * sized.height > most && label > frame.readable) sized = buttonSize(setting, text, --label, least)
  // Where the label at the readable size is still too wide or too large, the room at its ends is cut.
  const side = sized.width > widest || sized.width * sized.height > most ? BUTTON_SIDE_TIGHT : BUTTON_SIDE
  if (side !== BUTTON_SIDE) sized = buttonSize(setting, text, label, least, side)
  return { size: label, least, side, width: sized.width, height: sized.height }
}

/** A button's least height in the frame: a share of its shorter side, larger on a display banner. */
function buttonLeast(frame: FrameRoom): number {
  const short = Math.min(frame.width, frame.height)
  return Math.round(short * (isDisplay(frame) ? BUTTON_LEAST_DISPLAY : BUTTON_LEAST_SOCIAL))
}

/** The room between a style's parts, as a share of the headline's size: closed down by TIGHT_GAP where `tight`. */
function gapOf(style: Style, tight: boolean | undefined): number {
  return style.gap * (tight ? TIGHT_GAP : 1)
}

/**
 * How many times the button label's size the lead is at least in a style: less in one that slants its highlight,
 * more on a display size.
 */
function overButton(style: Style, frame: FrameRoom): number {
  if (isDisplay(frame)) return OVER_BUTTON_DISPLAY
  return style.highlight === 'italic' ? OVER_BUTTON_QUIET : OVER_BUTTON
}

/** Whether a frame is a display size, shown at its own pixels, under 1000 px each way. */
function isDisplay(frame: FrameRoom): boolean {
  return frame.width < 1000 && frame.height < 1000
}

/** The most lines a kind of text takes in a frame: any takes two at most in a short frame. */
function linesOf(kind: TextKind, frame: FrameRoom): number {
  const lines = KINDS[kind].lines
  return frame.height <= SHORT_FRAME ? Math.min(lines, SHORT_FRAME_LINES) : lines
}

/** The size the room between the words is a share of: the headline's, also where a number leads. */
function gapBase(parts: readonly WordPart[], size: number): number {
  return parts.some((part) => part.kind === 'number') ? size * (UNDER_NUMBER.headline ?? 1) : size
}

/** A part's size: the lead's, or its share of it, never under the readable size. */
function sizeOf(part: WordPart, parts: readonly WordPart[], size: number, frame: FrameRoom): number {
  const underNumber = parts.some((each) => each.kind === 'number') ? UNDER_NUMBER[part.kind] : undefined
  const share = underNumber ?? KINDS[part.kind].share
  return Math.round(share === 1 ? size : Math.max(frame.readable, size * share))
}

/** An auto layout column of the words, filling its parent's width and hugging its own height when `hug`. */
function column(name: string, box: Rect, gap: number, align: 'start' | 'center', hug: boolean): Part {
  return {
    type: 'box',
    name,
    props: {
      ...box,
      clip: false,
      ...(hug ? { sizing: { width: 'fill', height: 'hug' } } : {}),
      layout: { direction: 'column', gap, align },
    },
  }
}

/**
 * A text's props, as the column sets it: its look, size, ink and font, filling the column's width. A tracked kicker or
 * attribution set with a lead at `leadSize` is held to the lead's widest line (see `heldToLead`).
 */
function textOf(
  setting: Setting,
  words: Words,
  part: WordPart,
  size: number,
  align: 'start' | 'center',
  width: number,
  leadSize?: number,
): SetText {
  const { style, palette } = setting
  const look: TextLook = style[KINDS[part.kind].look]
  const font = palette[look.font]
  const ink = part.ink ?? inkFor(setting, words.surface, size)
  const lead = part.kind === 'headline' || part.kind === 'number'
  const text = part.kind === 'headline' ? kept(part.text, part.highlight) : part.text
  const runs = [
    ...(part.highlight ? highlightRuns(setting, words.surface, { ...part, text }, ink, size) : []),
    ...(part.kind === 'number' ? unitRuns(setting, text, size) : []),
  ]
  const base = lookStyle(setting, look, size)
  // An underline sits under the baseline, so its line is set with the room under it the rule needs to clear the
  // next line's caps.
  const leading = underlined(runs) ? Math.max(base.lineHeight, UNDERLINED_LEADING) : base.lineHeight
  const props = {
    x: words.room.x,
    y: words.room.y,
    width,
    height: size,
    text,
    style: { ...base, lineHeight: leading, color: ink.value },
    runs,
    ...(part.effects ? { effects: part.effects } : {}),
    align,
    boxMode: 'autoHeight',
    wrapStyle: lead ? 'balance' : 'pretty',
    sizing: { width: 'fill', height: 'hug' },
  }
  const held = leadSize === undefined ? props : heldToLead(setting, words, part, props, leadSize, align)
  return { props: held, ink, font }
}

/**
 * A tracked kicker or attribution held to the width of its lead's widest line, so a supporting line never outweighs
 * the lead: its tracking eased first, down to TRACKING_LEAST, then set in two lines broken only at a comma, no wider
 * than the lead's line.
 */
function heldToLead<T extends { text: string; width: number; style: { letterSpacing: { value: number } } }>(
  setting: Setting,
  words: Words,
  part: WordPart,
  props: T,
  leadSize: number,
  align: 'start' | 'center',
): T {
  if ((part.kind !== 'kicker' && part.kind !== 'attribution') || props.style.letterSpacing.value <= TRACKING_LEAST)
    return props
  const { measure } = setting
  // The widest line of the leads: the headline's, and a number's over it.
  const leads = words.parts.filter((each) => each.kind === 'headline' || each.kind === 'number')
  if (leads.length === 0) return props
  const line = Math.max(
    ...leads.map((lead) => {
      const set = sizeOf(lead, words.parts, leadSize, setting.frame)
      const leadProps = TextProps.parse(textOf(setting, words, lead, set, align, words.room.width).props)
      const lineHeight = set * (leadProps.style.lineHeight ?? 1.2)
      const lines = Math.max(1, Math.round(measure(leadProps, words.room.width).height / lineHeight))
      return Math.floor(Math.min(words.room.width, measure(leadProps, null).width / lines))
    }),
  )
  const at = (tracking: number) => ({
    ...props,
    style: { ...props.style, letterSpacing: { ...props.style.letterSpacing, value: tracking } },
  })
  const wide = (each: T) => measure(TextProps.parse(each), null).width
  for (let tracking = props.style.letterSpacing.value; tracking >= TRACKING_LEAST; tracking -= TRACKING_STEP)
    if (wide(at(tracking)) <= line) return at(tracking)
  // Still too wide: where it has a comma, two lines no wider than the lead's, broken only at the comma.
  const eased = at(TRACKING_LEAST)
  if (!props.text.includes(',')) return eased
  const groups = props.text.split(',').map((group) => group.trim().replaceAll(' ', KEEP))
  const widest = Math.max(...groups.map((text) => wide({ ...eased, text })))
  if (widest > line) return eased
  return { ...eased, text: groups.join(', '), width: line, sizing: { width: 'fixed', height: 'hug' } }
}

/** A text part with its ink and font bound to their brand roles. */
function textPart(part: WordPart, { props, ink, font }: SetText): Part {
  const lead = part.kind === 'headline' || part.kind === 'number'
  return {
    type: 'text',
    name: NAMES[part.kind],
    role: part.kind === 'number' ? 'price' : lead ? 'headline' : part.kind === 'subline' ? 'subhead' : 'body',
    props,
    bindings: { ...(font.ref ? { fontFamily: font.ref } : {}), ...(ink.ref ? { textColor: ink.ref } : {}) },
  }
}
