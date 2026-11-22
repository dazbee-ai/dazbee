// What a pattern builds a frame with: the tree it adds to, how its words are set, its content, and the parts every
// pattern places alike: the background, the ground the words sit on, the photo and the logo.
import { isNineBySixteen, type Rect } from '@dazbee/schema'

import { BUTTON_SIDE_TIGHT, buttonSize } from './button.ts'
import { coverCrop, type Cropped, meets, subjectOf } from './crop.ts'
import { SHORT_FRAME } from './frame-shape.ts'
import { contrast, deepColour, INK, inkOn, lchOf, mixed, type Swatch, WHITE, withAlpha } from './palette.ts'
import { inkReads, leastInkContrast, oneInk } from './picture-look.ts'
import { rolesFor, type StyleRoles } from './styles.ts'
import { linear, picture, rect, round, solid, stroke, type TreeBuilder } from './tree.ts'
import type { PatternContent, PatternStyle } from './types.ts'
import {
  isTower,
  leadBeside,
  leadFit,
  leadWidth,
  type Setting,
  SHORT_FRAME_LINES,
  stripLabel,
  wideRow,
  type WordPart,
  type Words,
} from './words.ts'

/** The most a logo takes: its drawn height, label and all, its ink's height, and its drawn area. */
export interface LogoCap {
  height: number
  ink: number
  area: number
}

/** A frame being built: its tree, how its words are set, its style's name, the content and the kit's logo. */
export interface Build extends Setting {
  tree: TreeBuilder
  styleName: PatternStyle
  /** The pattern being built's id. */
  pattern: string
  content: PatternContent
  /** The brand kit's logo, an asset's id; none while the kit has no logo. */
  kitLogo: string | null
  /** Whether a fine frame line runs inside the frame's edge, so the logo's label sits inside it, never hanging. */
  framed?: boolean
  /**
   * The most the logo takes, from the lead the frame was first built with (see `buildPattern`), so the logo signs
   * the ad and never outranks its message: its drawn height, label and all, its ink's height, and its drawn area.
   */
  logoCap?: LogoCap
}

/** How a logo is drawn on a colour: as it is, in one ink of the colour's, or on a label of a colour it reads on. */
type LogoWay = { way: 'as-is' } | { way: 'ink'; ink: Swatch } | { way: 'label'; label: Swatch }

/** The contrast under which two colours read as one; and under which a logo's box melts into what it is on. */
const SAME_COLOUR = 1.4
const SAME_BOX = 1.1
/** The logo's area, as a wordmark 3.5 times as wide as it is tall at the base height takes it. */
const LOGO_RATIO = 3.5
/** The opacity of the colour a 9:16 frame's foot is tinted with at its foot, and the least chroma of that tint. */
const FOOT_TINT = 0.06
const FOOT_CHROMA = 8
/** A square mark's least and most size on a display frame, as a share of its shorter side. */
const MARK_LEAST = 0.09
const MARK_MOST_DISPLAY = 0.14
/** The contrast between a logo's own box and what it is on under which the box gets a keyline, so it reads as meant. */
const BOX_SEEN = 1.5
/** The height under which a banner's logo label runs the frame's whole height at its start. */
const SLAB_MOST = 120
/** The contrast every colour of a logo's ink worth telling keeps with the label it is on. */
const LABEL_READS = 3
/** A label's room round the logo, as a share of the logo's height. */
const LABEL_PAD = 0.35
/** How many times as wide as it is tall a room is for its logo to go beside its words, not over them. */
const WIDE_ROOM = 2.5
/** The least share of a photo its subject is kept in under the logo's room. */
const KEEP_LEAST = 0.4
/** The least height words take under a logo over them, as a multiple of the readable size. */
const WORDS_UNDER_LOGO = 4.5
/** The least width a strip's words take, as a multiple of the readable size. */
const ROW_TEXT_LEAST = 9

/** The background: a rectangle over the whole frame in a colour, bound to its brand role. */
export function backdrop(b: Build, colour: Swatch): void {
  const { width, height } = b.frame
  b.tree.add('background', { ...rect('Background', { x: 0, y: 0, width, height }, solid(colour)), role: 'background' })
}

/**
 * In a 9:16 frame of a style that sets its words on the plain background, a soft tint from the safe room's foot to
 * the frame's foot, where the platforms' interface goes, growing from nothing to a faint tint of the primary colour
 * (of the accent where that tint would read as grey): the ground carries on there with no edge to catch the eye, and
 * the frame doesn't end in a blank field. Nothing else is set there.
 */
export function footTint(b: Build): void {
  const { frame, palette } = b
  if (!isNineBySixteen(frame.width, frame.height) || roles(b).ground !== 'background') return
  const y = Math.round(frame.safe.y + frame.safe.height)
  const box = { x: 0, y, width: frame.width, height: frame.height - y }
  const tinted = (swatch: Swatch) => lchOf(mixed(palette.background.value, swatch.value, FOOT_TINT)).chroma
  const colour = tinted(palette.primary) >= FOOT_CHROMA ? palette.primary : palette.accent
  const fill = linear([0.5, 0], [0.5, 1], [withAlpha(colour.value, 0), withAlpha(colour.value, FOOT_TINT)])
  b.tree.add('foot', { ...rect('Foot', box, fill), role: 'background' })
}

/** The style's roles in this pattern. */
export function roles(b: Build): StyleRoles {
  return rolesFor(b.style, b.pattern)
}

/** The colour the words sit on in this pattern: the style's ground role, or the kit's deep colour. */
export function groundColour(b: Build): Swatch {
  const role = roles(b).ground
  return role === 'deep' ? deepColour(b.palette) : b.palette[role]
}

/** The ground over the whole frame, where it isn't the background already drawn. */
export function ground(b: Build): Swatch {
  const colour = groundColour(b)
  if (colour.value !== b.palette.background.value || colour.ref !== b.palette.background.ref) {
    const { width, height } = b.frame
    b.tree.add('ground', { ...rect('Ground', { x: 0, y: 0, width, height }, solid(colour)), role: 'background' })
  }
  return colour
}

/**
 * The photo covering `box`, cropped to its subject kept inside `keep`, with its corners rounded by `radius`; nothing
 * without one.
 */
export function photo(b: Build, box: Rect, radius = 0, keep: Rect = box): Cropped | undefined {
  if (!b.content.photo) return undefined
  const cropped = coverCrop(b.content.photo, box, keep)
  b.tree.add('photo', { ...picture('Photo', box, b.content.photo, { radius, crop: cropped.crop }), role: 'background' })
  return cropped
}

/**
 * The room the logo takes at `at`, no wider than `width`: as large as the style's logo, its area alike for a wide
 * wordmark and a square mark, with its label round it where it needs one on `surface`.
 */
export function logoRoom(b: Build, at: { x: number; y: number }, width: number, surface: Swatch): Rect {
  const { frame } = b
  const short = Math.min(frame.width, frame.height)
  const ratio = inkRatio(b)
  const strip = frame.shape === 'strip' || frame.shape === 'banner'
  const display = frame.width < 1000 && frame.height < 1000
  const base = strip
    ? Math.max(frame.readable * 1.6, (frame.height - 2 * frame.margin) * 0.45)
    : Math.max(frame.readable * 1.6, short * 0.065)
  let height = base * Math.min(1.8, Math.max(0.7, Math.sqrt(LOGO_RATIO / ratio)))
  if (ratio <= 1.5 && !strip) height = Math.max(height, short * MARK_LEAST)
  if (ratio <= 1.5 && display) height = Math.min(height, short * MARK_MOST_DISPLAY)
  const label = logoWay(b, surface).way === 'label'
  // The label's room round the ink, as a share of the ink's height: on each side, and both together.
  const share = label ? LABEL_PAD : 0
  const widest = Math.min(width, frame.width * (strip ? 0.15 : 0.2) + 2 * height * share)
  if (height * (ratio + 2 * share) > widest) height = widest / (ratio + 2 * share)
  if (strip) height = Math.min(height, (frame.height - 2 * frame.margin) / (1 + 2 * share))
  const cap = b.logoCap
  if (cap) {
    // The lead's cap over the style's size, never under the readable size, so the logo still reads.
    const most = Math.min(
      cap.ink,
      cap.height / (1 + 2 * share),
      Math.sqrt(cap.area / ((ratio + 2 * share) * (1 + 2 * share))),
    )
    height = Math.min(height, Math.max(frame.readable, most))
  }
  const pad = 2 * Math.round(height * share)
  return { x: at.x, y: at.y, width: Math.round(height * ratio + pad), height: Math.round(height + pad) }
}

/**
 * The logo, bound to the Logo brand role when it is the kit's logo, in `room` (as logoRoom gives it), lined up by
 * `align`, on `surface`: as it is where its ink reads there, in the surface's ink where it is of one colour, else on
 * a label of a colour it reads on, its room round it even, hanging from the frame's edge when it is near it. The box
 * it takes, label and all; none without a logo.
 */
export function logo(
  b: Build,
  room: Rect,
  align: 'start' | 'center' | 'end',
  surface: Swatch,
  { hang = 'top', from = 0 }: { hang?: 'top' | 'start'; from?: number } = {},
): Rect | undefined {
  const content = b.content.logo
  if (!content) return undefined
  const way = logoWay(b, surface)
  const ratio = inkRatio(b)
  const boxed = content.look?.backdrop
  const pad =
    way.way === 'label' ? Math.round(Math.min(room.height / (1 + 2 * LABEL_PAD), room.width / ratio) * LABEL_PAD) : 0
  const height = Math.min(room.height - 2 * pad, (room.width - 2 * pad) / ratio)
  const width = height * ratio
  const outer = { width: width + 2 * pad, height: height + 2 * pad }
  const x = room.x + { start: 0, center: (room.width - outer.width) / 2, end: room.width - outer.width }[align]
  const y = room.y + (room.height - outer.height) / 2
  const box = { x: round(x + pad), y: round(y + pad), width: round(width), height: round(height) }
  let taken = { x, y, ...outer }
  if (way.way === 'label') {
    // Near the frame's top edge, or in a strip at its start, the label runs from the edge, its free corners rounded.
    const r = Math.round(Math.min(outer.width, outer.height) * b.style.buttonRound * 0.5)
    let radius: [number, number, number, number] = [r, r, r, r]
    // A banner as tall as SLAB_MOST or more keeps its label round the logo, never a slab down its height.
    if (hang === 'start' && b.frame.height < SLAB_MOST) {
      taken = { x: from, y: 0, width: x + outer.width - from, height: b.frame.height }
      radius = [0, r, r, 0]
    } else if (hang === 'top' && y <= b.frame.margin * 1.5 && !b.framed) {
      taken = { x, y: 0, width: outer.width, height: y + outer.height }
      radius = [0, 0, r, r]
    }
    b.tree.add('logo-label', { ...rect('Logo label', taken, solid(way.label), { radius }), role: 'decoration' })
  }
  const bound = content.assetId === b.kitLogo
  // A logo on a box of its own is drawn whole, box and all, as the brand drew it; any other is cropped to its ink.
  const crop = boxed ? undefined : content.look?.subject
  const drawn = picture('Logo', box, content, { fit: 'fit', logo: bound, ...(crop ? { crop } : {}) })
  if (way.way === 'ink') {
    // The logo's shape masks a fill of the ink, so the logo is drawn in it.
    b.tree.add('logo', { type: 'box', name: 'Logo', role: 'logo', props: { ...box, clip: false } })
    b.tree.add('logo-shape', { ...drawn, name: 'Logo shape', props: { ...drawn.props, mask: 'alpha' } }, 'logo')
    b.tree.add('logo-ink', { ...rect('Logo ink', box, solid(way.ink)), role: 'decoration' }, 'logo')
  } else b.tree.add('logo', { ...drawn, role: 'logo' })
  // A box a shade off what it is on reads as a murky square: a keyline in its ink sets it off, as a stamp.
  const ink = content.look?.inks[0]?.colour
  if (boxed && ink && contrast(boxed, surface.value) >= SAME_BOX && contrast(boxed, surface.value) < BOX_SEEN) {
    const weight = Math.max(1, Math.round(Math.min(box.width, box.height) * 0.02))
    const keyline = rect('Logo keyline', box, { fills: [] }, { strokes: [stroke(withAlpha(ink, 0.6), weight)] })
    b.tree.add('logo-keyline', { ...keyline, role: 'decoration' })
  }
  return { x: round(taken.x), y: round(taken.y), width: round(taken.width), height: round(taken.height) }
}

/** Whether the logo reads on `surface` as it is, with no label. */
export function logoReads(b: Build, surface: Swatch): boolean {
  return logoWay(b, surface).way === 'as-is'
}

/** Whether the frame is tall: its logo, words and button spread down its safe room. */
export function isTall({ frame }: Build): boolean {
  return frame.shape === 'tall' || frame.shape === 'tower'
}

/** Whether the frame's words go in a row beside the button: a strip, or a banner as short as one. */
export function inRow({ frame }: Build): boolean {
  return frame.shape === 'strip' || (frame.shape === 'banner' && frame.height <= 60)
}

/**
 * Whether words in `room` go in a row beside their button: in a strip, and in a wide, low room of a larger frame
 * (see wideRow), where a button under the words would take a tier of its height.
 */
export function rowed(b: Build, room: Rect): boolean {
  return inRow(b) || (Boolean(b.content.button) && wideRow(b, room))
}

/**
 * Whether the frame pins its button to its safe room's foot, its words over it: a 9:16 social frame, whose platforms'
 * interface sets where that foot is, and a display tower, whose button anchors its height. Any other frame keeps its
 * button under its words.
 */
export function pinsButton({ frame }: Build): boolean {
  return isNineBySixteen(frame.width, frame.height) || isTower(frame)
}

/** The least share of a tall frame's height a photo takes where it can, so it leads the frame. */
export const HERO_LEAST = 1 / 3
/** The least share a photo is let down to where that sets the lead LEAD_BOUGHT times as large. */
const PHOTO_LEAST = 0.28
const LEAD_BOUGHT = 1.4

/** The heights down a tall frame its photo's seam is tried at besides a pattern's own: HERO_LEAST and PHOTO_LEAST. */
export function tallSeams({ frame }: Build): number[] {
  return frame.shape === 'tall' ? [HERO_LEAST, PHOTO_LEAST].map((share) => Math.ceil(frame.height * share)) : []
}

/**
 * Of a tall frame's arrangements, each with its photo's height and its words as set under the logo, the one whose
 * words keep every part with the lead over them by the style's scale, the lead largest, the photo larger where two
 * set it alike: among those whose photo takes HERO_LEAST of the frame, or PHOTO_LEAST where that sets the lead
 * LEAD_BOUGHT times as large. The photo gives way before the lead's scale, and the subline is left out only where no
 * photo leaves it room. Where none keeps its scale, the one that sets the lead largest; the one with the tallest
 * photo where no photo takes PHOTO_LEAST.
 */
export function tallChoice<T>(
  b: Build,
  list: readonly T[],
  of: (each: T) => { photo: number; words: Words },
): T | undefined {
  const { height } = b.frame
  const able = list.filter((each) => of(each).photo >= height * PHOTO_LEAST - 1)
  if (able.length === 0)
    return list.reduce<T | undefined>((a, c) => (!a || of(c).photo > of(a).photo ? c : a), undefined)
  const fits = able.map((each) => ({ each, photo: of(each).photo, ...leadFit(b, of(each).words) }))
  const best = (pool: typeof fits) =>
    pool.reduce<(typeof fits)[number] | undefined>(
      (a, c) => (!a || c.size > a.size || (c.size === a.size && c.photo > a.photo) ? c : a),
      undefined,
    )
  for (const pool of [fits.filter((f) => f.every && f.scaled), fits.filter((f) => f.every), fits]) {
    const hero = best(pool.filter((f) => f.photo >= height * HERO_LEAST - 1))
    const any = best(pool)
    if (hero && any && any.size >= hero.size * LEAD_BOUGHT) return any.each
    if (hero) return hero.each
    if (any) return any.each
  }
  return undefined
}

/** The height the logo takes over words in `room`, with the room under it; none without a logo. */
export function logoRowHeight(b: Build, room: Rect): number {
  if (!b.content.logo) return 0
  return logoRoom(b, { x: room.x, y: room.y }, room.width, groundColour(b)).height + b.frame.margin * 0.8
}

/** The least width the button takes: its label at the readable size with the least room at its ends; none without one. */
export function buttonLeastWidth(b: Build): number {
  return b.content.button ? buttonSize(b, b.content.button, b.frame.readable, 0, BUTTON_SIDE_TIGHT).width : 0
}

/**
 * The logo at the top of `room`, lined up on the words' grid line (their start edge, or their middle where they are
 * centred, as `align` or the style lines them), on `surface`; the room left under it, the margin between. A room too
 * low to hold the words under it takes it at its start, beside them. The room is all left without a logo, or where
 * it is too narrow for the logo beside the words.
 */
export function logoOnTop(b: Build, room: Rect, surface: Swatch, align = b.style.align): Rect {
  if (!b.content.logo) return room
  const { frame } = b
  const over = logoRoom(b, { x: room.x, y: room.y }, room.width, surface)
  const under = room.height - over.height - frame.margin * 0.8
  if (under < frame.readable * WORDS_UNDER_LOGO) {
    // A wide or low room takes the logo at its start, beside the words; one too narrow for both leaves it out.
    const box = logoRoom(b, { x: room.x, y: room.y }, room.width * 0.3, surface)
    if (room.width - box.width - frame.margin < frame.readable * ROW_TEXT_LEAST) return room
    box.y = Math.round(room.y + (room.height - box.height) / 2)
    if (!logo(b, box, 'start', surface)) return room
    const right = box.x + box.width + frame.margin
    return { ...room, x: right, width: room.x + room.width - right }
  }
  const centred = align === 'center'
  if (centred) over.x = Math.round(room.x + (room.width - over.width) / 2)
  const placed = logo(b, over, centred ? 'center' : 'start', surface)
  if (!placed) return room
  const below = over.y + over.height + frame.margin * 0.8 - room.y
  return { ...room, y: room.y + below, height: room.height - below }
}

/**
 * The logo at the start of a short frame's `room`, on `surface`, its label from the room's edge a margin before it;
 * the room left after it, the margin between. A short frame always keeps its logo, as its lead and button: a pattern
 * leaves its picture out first (see `stripHolds`). A taller banner too narrow to hold the logo and leave `leave` for
 * the words and button after it is left without one.
 */
export function logoAtStart(b: Build, room: Rect, surface: Swatch, leave = rowLeast(b)): Rect {
  if (!b.content.logo) return room
  const box = logoRoom(b, { x: room.x, y: room.y }, room.width * 0.3, surface)
  if (!isShort(b) && room.width - box.width - b.frame.margin < leave) return room
  box.y = Math.round(room.y + (room.height - box.height) / 2)
  const from = Math.max(0, room.x - b.frame.margin)
  const placed = logo(b, box, 'start', surface, { hang: 'start', from })
  if (!placed) return room
  const right = Math.max(box.x + box.width, placed.x + placed.width) + b.frame.margin
  return { ...room, x: right, width: room.x + room.width - right }
}

/** Whether the frame is short, 100 px tall or less: a strip or a mobile banner, which keeps its logo, lead and button. */
export function isShort({ frame }: Build): boolean {
  return frame.height <= SHORT_FRAME
}

/**
 * The least width a short frame's words and button take: the headline in two lines at the least size it is set at
 * beside the button, and the button with its label at the size it takes there and the margin before it.
 */
export function rowLeast(b: Build): number {
  const { frame, content } = b
  const label = rowLabel(b)
  const button = content.button ? buttonSize(b, content.button, label, 0, BUTTON_SIDE_TIGHT).width + frame.margin : 0
  const lead = leadWidth(b, { kind: 'headline', text: content.headline }, leadBeside(b, label), SHORT_FRAME_LINES)
  return Math.round(Math.max(frame.readable * ROW_TEXT_LEAST, lead) + button)
}

/** The size of a short frame's button label: the size rowWords sets beside the words, the readable size under them. */
export function rowLabel(b: Build): number {
  return inRow(b) ? stripLabel(b.frame) : b.frame.readable
}

/**
 * The least width a short frame takes for its logo on the words' ground, its words and its button, with its
 * margins.
 */
export function stripLeast(b: Build): number {
  const { frame } = b
  const logoWidth = b.content.logo ? logoRoom(b, { x: 0, y: 0 }, frame.width, groundColour(b)).width + frame.margin : 0
  return rowLeast(b) + logoWidth + 2 * frame.margin
}

/** Whether a short frame holds a picture `width` wide beside its logo, words and button; else it is left out. */
export function stripHolds(b: Build, width: number): boolean {
  return b.frame.width - width >= stripLeast(b)
}

/**
 * The logo on the photo as it is drawn, in the first of its top corners, then its bottom ones, inset from the photo's
 * edges by the frame's margin, clear of the subject and inside the safe room; whether it found one.
 */
export function photoLogo(b: Build, shot: Cropped | undefined): boolean {
  if (!b.content.logo || !shot) return false
  const { box } = shot
  const { frame } = b
  const inset = frame.margin
  const safe = frame.safe
  const left = Math.max(box.x + inset, safe.x)
  const right = Math.min(box.x + box.width - inset, safe.x + safe.width)
  const top = Math.max(box.y + inset, safe.y)
  const foot = Math.min(box.y + box.height - inset, safe.y + safe.height)
  if (right - left <= 0 || foot - top <= 0) return false
  const surface = photoSurface(b)
  const room = logoRoom(b, { x: left, y: top }, right - left, surface)
  const keep = Math.min(frame.width, frame.height) * 0.03
  const corners = [
    { x: left, y: top, align: 'start' as const },
    { x: right - room.width, y: top, align: 'end' as const },
    { x: left, y: foot - room.height, align: 'start' as const },
    { x: right - room.width, y: foot - room.height, align: 'end' as const },
  ]
  const clear = corners.find(
    (corner) =>
      corner.y >= top &&
      corner.y + room.height <= foot &&
      !meets({ ...room, x: corner.x, y: corner.y }, shot.subject, keep),
  )
  if (!clear) return false
  return logo(b, { ...room, x: clear.x, y: clear.y }, clear.align, surface) !== undefined
}

/**
 * Whether the logo goes on the photo, in a corner clear of its subject, before over the words: where it doesn't read
 * on the words' ground, in a tall frame, where the words' safe room is short, and where the words' room is too low to
 * hold it over them.
 */
export function logoOnPhoto(b: Build, words: Rect): boolean {
  if (!b.content.logo) return false
  return !logoReads(b, groundColour(b)) || isTall(b) || words.width > words.height * WIDE_ROOM
}

/**
 * The part of a photo's `keep` its subject is kept in when the logo goes on the photo: past the logo's room at the
 * top, or at the left, whichever holds the subject larger, so a corner is left clear for it. `keep` itself where the
 * logo goes over the words, or where neither leaves the least share of it.
 */
export function keepUnderLogo(b: Build, keep: Rect, onPhoto: boolean): Rect {
  if (!onPhoto || !b.content.photo) return keep
  const { frame } = b
  const room = logoRoom(b, { x: 0, y: 0 }, keep.width, photoSurface(b))
  // The logo sits a margin in from the photo's edges, and inside the safe room, as photoLogo places it.
  const left = Math.max(keep.x + frame.margin, frame.safe.x) + room.width + frame.margin * 0.5
  const top = Math.max(keep.y + frame.margin, frame.safe.y) + room.height + frame.margin * 0.5
  const beside = { ...keep, x: left, width: keep.x + keep.width - left }
  const under = { ...keep, y: top, height: keep.y + keep.height - top }
  const subject = subjectOf(b.content.photo)
  const holds = (box: Rect) => Math.min(box.width / subject.width, box.height / subject.height)
  const kept = [under, beside].filter(
    (box) => box.width >= keep.width * KEEP_LEAST && box.height >= keep.height * KEEP_LEAST,
  )
  return (
    kept.reduce<Rect | undefined>((best, box) => (!best || holds(box) > holds(best) ? box : best), undefined) ?? keep
  )
}

/** The share of the frame's margin a photo's subject keeps from the frame's edges, past its own room in the photo. */
const SUBJECT_EDGE = 0.6

/**
 * The part of a photo's `box` its subject is kept in: in from each side that is the frame's edge by SUBJECT_EDGE of
 * the margin, so a subject never crowds the frame's edge; a banner's or strip's, which its photo spans, as it is.
 */
export function offFrameEdges({ frame }: Build, box: Rect): Rect {
  if (frame.shape === 'strip' || frame.shape === 'banner') return box
  const by = frame.margin * SUBJECT_EDGE
  const left = box.x <= 0.5 ? by : 0
  const top = box.y <= 0.5 ? by : 0
  const right = box.x + box.width >= frame.width - 0.5 ? by : 0
  const bottom = box.y + box.height >= frame.height - 0.5 ? by : 0
  return { x: box.x + left, y: box.y + top, width: box.width - left - right, height: box.height - top - bottom }
}

/** The colour a logo on the photo is read against: the photo's backdrop where its pixels were read, else the kit's background. */
export function photoSurface({ content, palette }: Build): Swatch {
  const backdrop = content.photo?.look?.backdrop
  return backdrop ? { value: backdrop } : palette.background
}

/** The usual words: the kicker, the headline with its highlight, and the subline, as the content gives them. */
export function usualWords(content: PatternContent): WordPart[] {
  return [
    ...(content.kicker ? [{ kind: 'kicker' as const, text: content.kicker }] : []),
    {
      kind: 'headline' as const,
      text: content.headline,
      ...(content.highlight ? { highlight: content.highlight } : {}),
    },
    ...(content.subline ? [{ kind: 'subline' as const, text: content.subline }] : []),
  ]
}

/**
 * The logo's drawn width over its height: its ink's, where its pixels were read, else the picture's; a logo on a
 * box of its own is drawn whole, at the box's.
 */
function inkRatio({ content }: Build): number {
  const logo = content.logo
  if (!logo) return 3
  const ink = logo.look?.backdrop ? logo : (logo.look?.subject ?? logo)
  return ink.width / ink.height
}

/**
 * How the logo is drawn on `surface`. Read from its pixels: with a box of its own, as it is, the box its own plate;
 * as it is where its ink reads; in the
 * surface's ink where it is of one colour; else on a label of the first of the kit's background, white, the
 * secondary, the text colour and near black that every colour of its ink worth telling reads on at 3:1, or the one
 * it reads best on. Unread, it is drawn as it is on the kit's background, else on a label of it.
 */
function logoWay({ content, palette }: Build, surface: Swatch): LogoWay {
  const look = content.logo?.look
  const onBackground: LogoWay =
    contrast(surface.value, palette.background.value) <= SAME_COLOUR
      ? { way: 'as-is' }
      : { way: 'label', label: palette.background }
  if (!look) return onBackground
  if (look.backdrop) return { way: 'as-is' }
  if (inkReads(look, surface.value)) return { way: 'as-is' }
  if (oneInk(look)) return { way: 'ink', ink: inkOn(surface.value, [palette.text, palette.background], 3) }
  const labels = [palette.background, WHITE, palette.secondary, palette.text, INK].filter(
    (swatch) => contrast(swatch.value, surface.value) > SAME_COLOUR,
  )
  const best = (labels.length > 0 ? labels : [WHITE, INK]).reduce((a, c) =>
    leastInkContrast(look, c.value) > leastInkContrast(look, a.value) ? c : a,
  )
  const label = labels.find((swatch) => leastInkContrast(look, swatch.value) >= LABEL_READS) ?? best
  return { way: 'label', label }
}
