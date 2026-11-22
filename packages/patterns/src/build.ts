// What a pattern builds a frame with: the tree it adds to, how its words are set, its content, and the parts every
// pattern places alike: the background, the ground the words sit on, the photo and the logo.
import type { Rect } from '@dazbee/schema'

import { buttonSize } from './button.ts'
import { coverCrop, type Cropped, meets, subjectOf } from './crop.ts'
import { contrast, deepColour, inkOn, type Swatch } from './palette.ts'
import { inkReads, oneInk } from './picture-look.ts'
import { rolesFor, type StyleRoles } from './styles.ts'
import { picture, rect, round, solid, type TreeBuilder } from './tree.ts'
import type { PatternContent, PatternStyle } from './types.ts'
import type { Setting, WordPart } from './words.ts'

/** A frame being built: its tree, how its words are set, its style's name, the content and the kit's logo. */
export interface Build extends Setting {
  tree: TreeBuilder
  styleName: PatternStyle
  /** The pattern being built's id. */
  pattern: string
  content: PatternContent
  /** The brand kit's logo, an asset's id; none while the kit has no logo. */
  kitLogo: string | null
}

/** How a logo is drawn on a colour: as it is, in one ink of the colour's, or on a label of a colour it reads on. */
type LogoWay = { way: 'as-is' } | { way: 'ink'; ink: Swatch } | { way: 'label'; label: Swatch }

/** The contrast under which two colours read as one. */
const SAME_COLOUR = 1.4
/** The logo's area, as a wordmark 3.5 times as wide as it is tall at the base height takes it. */
const LOGO_RATIO = 3.5
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
  const base = strip
    ? Math.max(frame.readable * 1.6, (frame.height - 2 * frame.margin) * 0.45)
    : Math.max(frame.readable * 1.6, short * 0.065)
  let height = base * Math.min(1.8, Math.max(0.7, Math.sqrt(LOGO_RATIO / ratio)))
  if (ratio <= 1.5 && !strip) height = Math.max(height, short * 0.09)
  const pad = logoWay(b, surface).way === 'label' ? 2 * Math.round(height * LABEL_PAD) : 0
  const widest = Math.min(width, frame.width * (strip ? 0.15 : 0.2) + pad)
  if (height * ratio + pad > widest) height = (widest - pad) / ratio
  if (strip) height = Math.min(height, frame.height - 2 * frame.margin - pad)
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
    if (hang === 'start') {
      taken = { x: from, y: 0, width: x + outer.width - from, height: b.frame.height }
      radius = [0, r, r, 0]
    } else if (y <= b.frame.margin * 1.5) {
      taken = { x, y: 0, width: outer.width, height: y + outer.height }
      radius = [0, 0, r, r]
    }
    b.tree.add('logo-label', { ...rect('Logo label', taken, solid(way.label), { radius }), role: 'decoration' })
  }
  const bound = content.assetId === b.kitLogo
  const crop = content.look?.subject
  const drawn = picture('Logo', box, content, { fit: 'fit', logo: bound, ...(crop ? { crop } : {}) })
  if (way.way === 'ink') {
    // The logo's shape masks a fill of the ink, so the logo is drawn in it.
    b.tree.add('logo', { type: 'box', name: 'Logo', role: 'logo', props: { ...box, clip: false } })
    b.tree.add('logo-shape', { ...drawn, name: 'Logo shape', props: { ...drawn.props, mask: 'alpha' } }, 'logo')
    b.tree.add('logo-ink', { ...rect('Logo ink', box, solid(way.ink)), role: 'decoration' }, 'logo')
  } else b.tree.add('logo', { ...drawn, role: 'logo' })
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
 * The logo at the top of `room`, lined up as the style lines its words, on `surface`; the room left under it, the
 * margin between. A wide room, or one too low to hold the words under it, takes it at its start, beside them. The
 * room is all left without a logo, or where it is too narrow for the logo beside the words.
 */
export function logoOnTop(b: Build, room: Rect, surface: Swatch): Rect {
  if (!b.content.logo) return room
  const { frame } = b
  const over = logoRoom(b, { x: room.x, y: room.y }, room.width, surface)
  const under = room.height - over.height - frame.margin * 0.8
  if (room.width > room.height * WIDE_ROOM || under < frame.readable * WORDS_UNDER_LOGO) {
    // A wide or low room takes the logo at its start, beside the words; one too narrow for both leaves it out.
    const box = logoRoom(b, { x: room.x, y: room.y }, room.width * 0.3, surface)
    if (room.width - box.width - frame.margin < frame.readable * ROW_TEXT_LEAST) return room
    box.y = Math.round(room.y + (room.height - box.height) / 2)
    if (!logo(b, box, 'start', surface)) return room
    const right = box.x + box.width + frame.margin
    return { ...room, x: right, width: room.x + room.width - right }
  }
  const centred = b.style.align === 'center'
  if (centred) over.x = Math.round(room.x + (room.width - over.width) / 2)
  const placed = logo(b, over, centred ? 'center' : 'start', surface)
  if (!placed) return room
  const below = over.y + over.height + frame.margin * 0.8 - room.y
  return { ...room, y: room.y + below, height: room.height - below }
}

/**
 * The logo at the start of a strip's `room`, on `surface`, its label from the room's edge a margin before it; the
 * room left after it, the margin between. A strip too narrow to hold the logo and leave `leave` (as rowLeast gives
 * it) for the words and button after it is left without one.
 */
export function logoAtStart(b: Build, room: Rect, surface: Swatch, leave = rowLeast(b)): Rect {
  if (!b.content.logo) return room
  const box = logoRoom(b, { x: room.x, y: room.y }, room.width * 0.3, surface)
  if (room.width - box.width - b.frame.margin < leave) return room
  box.y = Math.round(room.y + (room.height - box.height) / 2)
  const from = Math.max(0, room.x - b.frame.margin)
  const placed = logo(b, box, 'start', surface, { hang: 'start', from })
  if (!placed) return room
  const right = Math.max(box.x + box.width, placed.x + placed.width) + b.frame.margin
  return { ...room, x: right, width: room.x + room.width - right }
}

/**
 * The least width a strip's words and button take: the headline at the readable size, some ten words' letters of
 * it a line, and the button with its label at the readable size and the margin before it.
 */
export function rowLeast(b: Build): number {
  const { frame, content } = b
  const button = content.button ? buttonSize(b, content.button, frame.readable).width + frame.margin : 0
  return Math.round(frame.readable * ROW_TEXT_LEAST + button)
}

/** The least width a strip takes for its logo on the words' ground, its words and its button, with its margins. */
export function stripLeast(b: Build): number {
  const { frame } = b
  const logoWidth = b.content.logo ? logoRoom(b, { x: 0, y: 0 }, frame.width, groundColour(b)).width + frame.margin : 0
  return rowLeast(b) + logoWidth + 2 * frame.margin
}

/**
 * The logo on the photo, in the first of its top corners, then its bottom ones, clear of the subject and inside the
 * safe room; whether it found one.
 */
export function photoLogo(b: Build, { photo: box }: { photo: Rect }, shot: Cropped | undefined): boolean {
  if (!b.content.logo || !shot) return false
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
  const left = Math.max(keep.x, frame.safe.x) + room.width + frame.margin * 0.5
  const top = Math.max(keep.y, frame.safe.y) + room.height + frame.margin * 0.5
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

/** The logo's ink's width over its height: its subject's, where its pixels were read, else the picture's. */
function inkRatio({ content }: Build): number {
  const logo = content.logo
  if (!logo) return 3
  const ink = logo.look?.subject ?? { width: logo.width, height: logo.height }
  return ink.width / ink.height
}

/**
 * How the logo is drawn on `surface`. Read from its pixels: as it is where its ink reads and it has no box of its own
 * in another colour; in the surface's ink where it is of one colour; else on a label of its own box's colour, or of
 * the kit's background. Unread, it is drawn as it is on the kit's background, else on a label of it.
 */
function logoWay({ content, palette }: Build, surface: Swatch): LogoWay {
  const look = content.logo?.look
  const onBackground: LogoWay =
    contrast(surface.value, palette.background.value) <= SAME_COLOUR
      ? { way: 'as-is' }
      : { way: 'label', label: palette.background }
  if (!look) return onBackground
  if (look.backdrop)
    return contrast(look.backdrop, surface.value) < 1.1
      ? { way: 'as-is' }
      : { way: 'label', label: { value: look.backdrop } }
  if (inkReads(look, surface.value)) return { way: 'as-is' }
  if (oneInk(look)) return { way: 'ink', ink: inkOn(surface.value, [palette.text, palette.background], 3) }
  if (inkReads(look, palette.background.value)) return { way: 'label', label: palette.background }
  return { way: 'label', label: inkOn(look.inks[0]?.colour ?? '#000000FF', [palette.background, palette.text], 3) }
}
