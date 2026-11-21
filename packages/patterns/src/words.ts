// A pattern's words: its texts and button set in the style's type, as large as fits the room they are given, each
// text in an ink that reads on what is behind it. In a column (`stackWords`) they stack in auto layout boxes, so a
// longer headline pushes the rest down; in a row (`rowWords`), for a strip, they sit beside the button.
import { type Effect, type Rect, TextProps } from '@dazbee/schema'

import { buttonPart, buttonSize } from './button.ts'
import type { FrameRoom } from './frame-shape.ts'
import { inkOn, type Palette, type Swatch, TEXT_CONTRAST } from './palette.ts'
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
  buttonFill?: Swatch
  room: Rect
  /** The colour behind the words, which their inks must read on. */
  surface: string
  /** Where the words sit down the room. */
  justify?: 'start' | 'center' | 'end'
  /** How they line up; the style's way when left out. */
  align?: 'start' | 'center'
  /** The largest the lead text may be; the style's share of the frame's shorter side when left out. */
  most?: number
}

/** The size the words were set at, and the box they take. */
export interface SetWords {
  /** The lead text's size. */
  size: number
  /** The box the texts and button take, inside the room. */
  box: Rect
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
  button?: { size: number; width: number; height: number }
  total: number
  fits: boolean
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
const UNDER_NUMBER: Partial<Record<TextKind, number>> = { headline: 0.3, kicker: 0.14, subline: 0.17 }
/** The parts left out, in turn, when the words don't fit at their smallest: a quote's attribution last. */
const LEFT_OUT_FIRST: readonly TextKind[] = ['subline', 'kicker', 'attribution']
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
/**
 * The share of its largest size under which a lead text is crowded by the subline, and how much larger it must grow
 * without it for the subline to be left out.
 */
const CROWDED = 0.6
const GROWS = 1.3
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
  const gap = round(gapBase(parts, size) * style.gap)
  const inner = round(gapBase(parts, size) * TITLE_GAP)
  const free = room.height - fit.total
  const top = room.y + { start: 0, center: free / 2, end: free }[words.justify ?? 'center']
  const box = { x: room.x, y: round(top), width: room.width, height: fit.total }
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
    const set = textOf(setting, words, part, sizeOf(part, parts, size, frame), align, room.width)
    const placed = { ...set, props: { ...set.props, y: round(y), height: round(height) } }
    tree.add(part.kind, textPart(part, placed), i <= titled ? holder : outer)
    y += height + (i < titled ? inner : gap)
  }
  if (button && words.button) {
    const x = align === 'center' ? room.x + (room.width - button.width) / 2 : room.x
    buttonPart(tree, setting, words, button.size, outer, { x: round(x), y: round(y) })
  }
  return { size, box }
}

/**
 * Sets a strip's words in a row: the texts in a column taking the room the button leaves, the button at the end, as
 * large as fits the room's height.
 */
export function rowWords(tree: TreeBuilder, setting: Setting, words: Words, parent?: string): SetWords {
  const { frame } = setting
  const { room } = words
  const label = Math.max(frame.readable, Math.round(Math.min(room.height * 0.3, frame.height * 0.2)))
  const button = words.button ? buttonSize(setting, words.button, label) : undefined
  const gap = round(Math.max(frame.margin, room.height * 0.25))
  const width = room.width - (button ? button.width + gap : 0)
  const row = tree.add(
    'words',
    { type: 'box', name: 'Words', props: { ...room, clip: false, layout: { direction: 'row', gap, align: 'center' } } },
    parent,
  )
  const texts: Words = { ...words, room: { ...room, width }, align: 'start' }
  delete texts.button
  const fit = fewestLeftOut(setting, texts)
  const inner = round(fit.size * TITLE_GAP)
  const top = room.y + (room.height - fit.total) / 2
  const box = { x: room.x, y: round(top), width, height: fit.total }
  const holder = tree.add('text-column', column('Text', box, inner, 'start', true), row)
  let y = top
  for (const part of fit.parts) {
    const height = fit.heights.get(part) ?? 0
    const text = textOf(setting, texts, part, sizeOf(part, fit.parts, fit.size, frame), 'start', width)
    tree.add(
      part.kind,
      textPart(part, { ...text, props: { ...text.props, y: round(y), height: round(height) } }),
      holder,
    )
    y += height + inner
  }
  if (button && words.button) {
    const at = { x: room.x + width + gap, y: round(room.y + (room.height - button.height) / 2) }
    buttonPart(tree, setting, words, label, row, at)
  }
  return { size: fit.size, box: room }
}

/**
 * The largest fit of the words, leaving out the subline, then the kicker, while they don't fit at their smallest;
 * and the subline where the headline would be set much larger without it, as it leads.
 */
function fewestLeftOut(setting: Setting, words: Words): Fit & { parts: WordPart[] } {
  let parts = words.parts
  let fit = largestFit(setting, { ...words, parts })
  const withoutSubline = parts.filter((part) => part.kind !== 'subline')
  if (fit.fits && withoutSubline.length < parts.length && fit.size < leadMost(setting, words) * CROWDED) {
    const larger = largestFit(setting, { ...words, parts: withoutSubline })
    if (larger.size >= fit.size * GROWS) return { ...larger, parts: withoutSubline }
  }
  for (const kind of LEFT_OUT_FIRST) {
    if (fit.fits) break
    const fewer = parts.filter((part) => part.kind !== kind)
    if (fewer.length === parts.length) continue
    parts = fewer
    fit = largestFit(setting, { ...words, parts })
  }
  return { ...fit, parts }
}

/** The largest lead size, a pixel at a time, at which the words fit their room; their smallest when none does. */
function largestFit(setting: Setting, words: Words): Fit {
  const { frame } = setting
  const least = Math.ceil(frame.readable * LEAD_LEAST)
  const most = Math.max(least, leadMost(setting, words))
  let best = measured(setting, words, least)
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

/** The largest the lead text may be. */
function leadMost({ frame, style }: Setting, words: Words): number {
  const short = Math.min(frame.width, frame.height)
  const number = words.parts.some((part) => part.kind === 'number')
  return Math.floor(words.most ?? style.headlineMax * short * (number ? 2.4 : 1))
}

/** The words measured with the lead at `size`. */
function measured(setting: Setting, words: Words, size: number): Fit {
  const { frame, style, measure } = setting
  const { room, parts } = words
  const align = words.align ?? style.align
  const heights = new Map<WordPart, number>()
  let fits = true
  let total = 0
  for (const part of parts) {
    const props = TextProps.parse(
      textOf(setting, words, part, sizeOf(part, parts, size, frame), align, room.width).props,
    )
    const { height } = measure(props, room.width)
    const longest = props.text.split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a), '')
    const word = measure({ ...props, text: longest, runs: [] }, null).width
    const lineHeight = props.style.fontSize * (props.style.lineHeight ?? 1.2)
    // SkParagraph lays text out at its width cut to a whole pixel.
    if (Math.ceil(word) > Math.floor(room.width) || Math.round(height / lineHeight) > KINDS[part.kind].lines)
      fits = false
    heights.set(part, height)
    total += height
  }
  const titled = parts.findIndex((part) => part.kind === 'headline' || part.kind === 'number')
  const base = gapBase(parts, size)
  total += parts.reduce((sum, _part, i) => sum + (i === 0 ? 0 : i <= titled ? base * TITLE_GAP : base * style.gap), 0)
  let button: Fit['button']
  if (words.button) {
    const short = Math.min(frame.width, frame.height)
    let label = Math.max(frame.readable, Math.round(Math.min(size * BUTTON_SHARE, short * BUTTON_MOST)))
    let sized = buttonSize(setting, words.button, label)
    // A label too long for the room is set smaller, never under the readable size.
    if (sized.width > room.width) {
      label = Math.max(frame.readable, Math.floor((label * room.width) / sized.width))
      sized = buttonSize(setting, words.button, label)
    }
    button = { size: label, ...sized }
    if (button.width > room.width) fits = false
    total += button.height + (parts.length > 0 ? base * style.gap : 0)
  }
  return { size, heights, ...(button ? { button } : {}), total: Math.ceil(total), fits: fits && total <= room.height }
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

/** A text's props, as the column sets it: its look, size, ink and font, filling the column's width. */
function textOf(
  setting: Setting,
  words: Words,
  part: WordPart,
  size: number,
  align: 'start' | 'center',
  width: number,
): SetText {
  const { style, palette } = setting
  const look: TextLook = style[KINDS[part.kind].look]
  const font = palette[look.font]
  const ink = part.ink ?? inkFor(setting, words.surface, size)
  const lead = part.kind === 'headline' || part.kind === 'number'
  const props = {
    x: words.room.x,
    y: words.room.y,
    width,
    height: size,
    text: part.text,
    style: {
      ...lookStyle(setting, look, size),
      color: ink.value,
    },
    runs: part.highlight ? highlightRuns(setting, words.surface, part) : [],
    ...(part.effects ? { effects: part.effects } : {}),
    align,
    boxMode: 'autoHeight',
    wrapStyle: lead ? 'balance' : 'pretty',
    sizing: { width: 'fill', height: 'hug' },
  }
  return { props, ink, font }
}

/** A text part with its ink and font bound to their roles. */
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

/**
 * The runs that set the highlighted words apart: in italic for a style that slants them, else in the first of the
 * kit's accent and primary colours that reads on the surface, else in italic.
 */
function highlightRuns(setting: Setting, surface: string, part: WordPart) {
  const at = part.highlight ? part.text.toLowerCase().indexOf(part.highlight.toLowerCase()) : -1
  if (!part.highlight || at < 0) return []
  const range = { start: at, end: at + part.highlight.length }
  const { palette, style } = setting
  if (style.highlight === 'colour') {
    // The colour reads as small text does at every size, so the words are set apart alike in every frame.
    const ink = inkOn(surface, [palette.accent, palette.primary], TEXT_CONTRAST)
    if (ink === palette.accent || ink === palette.primary) return [{ ...range, style: { color: ink.value } }]
  }
  return [{ ...range, style: { fontStyle: 'italic' } }]
}
