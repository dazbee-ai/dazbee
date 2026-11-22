// A pattern built round one visual (a product on a stage, a phone, a tile, a framed photo) and its words: the visual
// beside the words in a wide frame, a banner, a strip and a small display square, and over or under them in a larger
// square, a tall frame and a tower. In a 9:16 frame the logo heads the safe room, the visual fills its middle and the
// words sit with their button at its foot, so the story is composed down its height.
import type { Rect } from '@dazbee/schema'

import { type Build, isShort, isTall, logoAtStart, logoOnTop, pinsButton, rowed, stripHolds } from './build.ts'
import type { Swatch } from './palette.ts'
import { treeBuilder } from './tree.ts'
import { rowWords, type SetWords, stackWords, type Words } from './words.ts'

/** A visual a layout places: its shape, and what draws it in the box it is given. */
export interface Visual {
  /** Its width over its height; it is drawn at this shape, as large as fits the room it is given. */
  ratio: number
  /** Draws it in `box`, which has its ratio. */
  draw: (box: Rect) => void
  /** Whether a short frame keeps it where it holds it beside the logo, words and button; else it is left out there. */
  short?: boolean
  /** Whether it fills the whole room it is given in a square, tall frame or tower, whatever its shape. */
  fill?: boolean
}

/** What a layout sets: the words on their ground, and the visual. */
export interface VisualAndWords {
  /** The colour behind the words. */
  ground: Swatch
  /** The words, but their room and the colour behind them. */
  words: Omit<Words, 'room' | 'surface'>
  visual?: Visual
  /** Whether the visual goes first: over the words, or before them in a row. Over and before when left out. */
  first?: boolean
  /** The share of the room the words take across a wide frame, and down a square or tall one. */
  wordsShare?: { across?: number; down?: number }
  /**
   * Whether the button stands apart from the words, at the room's foot under the visual, where the words go first
   * down a square, tall frame or tower; with the words when left out.
   */
  buttonApart?: boolean
}

/** What a layout placed: the words as they were set, and the visual's box. */
export interface Placed {
  set: SetWords
  visual?: Rect
}

/** The shorter side under which a square frame is a small display one, its visual beside its words. */
const SMALL_SQUARE = 400
/** The most width over height of a visual a larger square sets beside its words, as it would be small over them. */
const BESIDE_RATIO = 1.1
/** The share of the room a button set apart takes at most, at its foot. */
const BUTTON_ROW = 0.2
/** The share of the room the words take, by default: across, and down a square, a tall frame and a tower. */
const ACROSS = 0.5
/** The share of a square's room its words take beside an upright visual, so they keep every part. */
const ACROSS_SQUARE = 0.56
const DOWN = { square: 0.38, tall: 0.38, tower: 0.5 }
/** The most of a banner's width its visual takes. */
const BANNER_VISUAL_MOST = 0.36
/** The room between the visual and the words, as a share of the margin. */
const BETWEEN = 0.8

/** Sets a pattern's visual and words in the frame, each where its shape puts it. */
export function placeVisualAndWords(b: Build, layout: VisualAndWords): Placed {
  const { frame } = b
  if (frame.shape === 'strip' || frame.shape === 'banner') return inBanner(b, layout)
  const square = frame.shape === 'square'
  const small = square && Math.min(frame.width, frame.height) < SMALL_SQUARE
  const upright = square && layout.visual && !layout.visual.fill && layout.visual.ratio <= BESIDE_RATIO
  if (frame.shape === 'wide' || small || upright) return sideBySide(b, layout)
  return stacked(b, layout)
}

/** The largest box of `ratio` inside `room`, centred down it, and across it or at its start. */
export function fitIn(room: Rect, ratio: number, align: 'start' | 'center' = 'center'): Rect {
  const width = Math.min(room.width, room.height * ratio)
  const height = width / ratio
  return {
    x: Math.round(room.x + (align === 'center' ? (room.width - width) / 2 : 0)),
    y: Math.round(room.y + (room.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  }
}

/** A banner or strip: the logo at its start, the visual at its start or end, the words between in a row or a stack. */
function inBanner(b: Build, { ground, words, visual, first = true }: VisualAndWords): Placed {
  const { frame } = b
  let room = frame.safe
  let box: Rect | undefined
  if (visual) {
    const height = frame.safe.height
    const width = Math.round(Math.min(height * visual.ratio, frame.width * BANNER_VISUAL_MOST))
    const shown = { width, height: Math.round(width / visual.ratio) }
    const keeps = !isShort(b) || (visual.short !== false && stripHolds(b, shown.width + frame.margin))
    if (keeps) {
      const y = Math.round((frame.height - shown.height) / 2)
      box = first ? { x: room.x, y, ...shown } : { x: room.x + room.width - shown.width, y, ...shown }
      const gap = Math.round(frame.margin * BETWEEN)
      room = first
        ? { ...room, x: room.x + shown.width + gap, width: room.width - shown.width - gap }
        : { ...room, width: room.width - shown.width - gap }
    }
  }
  if (box) visual?.draw(box)
  room = logoAtStart(b, room, ground)
  const set: Words = { ...words, room, surface: ground.value }
  return { set: rowed(b, set) ? rowWords(b.tree, b, set) : stackWords(b.tree, b, set), ...(box ? { visual: box } : {}) }
}

/** A wide frame or a small display square: the visual on one side, the logo and words on the other. */
function sideBySide(b: Build, { ground, words, visual, first = true, wordsShare }: VisualAndWords): Placed {
  const { frame } = b
  const { safe } = frame
  const gap = Math.round(frame.margin * BETWEEN)
  const share = visual ? (wordsShare?.across ?? (frame.shape === 'square' ? ACROSS_SQUARE : ACROSS)) : 1
  const wordsWidth = Math.round((safe.width - (visual ? gap : 0)) * share)
  const wordsRoom = { ...safe, width: wordsWidth, x: first && visual ? safe.x + safe.width - wordsWidth : safe.x }
  let box: Rect | undefined
  if (visual) {
    const width = safe.width - wordsWidth - gap
    const x = first ? safe.x : safe.x + wordsWidth + gap
    box = fitIn({ x, y: safe.y, width, height: safe.height }, visual.ratio)
    visual.draw(box)
  }
  const room = logoOnTop(b, wordsRoom, ground)
  const set = stackWords(b.tree, b, { justify: 'center', ...words, room, surface: ground.value })
  return { set, ...(box ? { visual: box } : {}) }
}

/**
 * A larger square, a tall frame and a tower: the logo heads the safe room; the words with their button take a share of
 * the room under it, at its foot where the visual goes first, else at its top; the visual fills the rest. A 9:16
 * frame keeps its words with their button at the safe room's foot.
 */
function stacked(b: Build, { ground, words, visual, first = true, wordsShare, buttonApart }: VisualAndWords): Placed {
  const { frame } = b
  const room = logoOnTop(b, frame.safe, ground)
  const tall = isTall(b)
  const down = wordsShare?.down ?? (frame.shape === 'tower' ? DOWN.tower : tall ? DOWN.tall : DOWN.square)
  const gap = Math.round(frame.margin * BETWEEN)
  if (!visual) {
    const set = stackWords(b.tree, b, {
      justify: 'optical',
      ...words,
      room,
      surface: ground.value,
      ...(pinsButton(b) ? { pin: true, together: true } : {}),
    })
    return { set }
  }
  const height = Math.round(room.height * down)
  const wordsRoom = first ? { ...room, y: room.y + room.height - height, height } : { ...room, height }
  const apart = Boolean(buttonApart && !first && words.button)
  const of = (at: Rect): Words => {
    const set: Words = {
      ...words,
      room: at,
      surface: ground.value,
      justify: first ? 'end' : 'start',
      ...(first && pinsButton(b) ? { pin: true, together: true } : {}),
    }
    if (apart) delete set.button
    return set
  }
  // The words as they set in their share, so the visual takes every pixel they leave.
  const tried = stackWords(treeBuilder(), b, of(wordsRoom))
  const top = first ? tried.box.y : tried.box.y + tried.box.height
  // A button set apart sits at the room's foot, under the lead by the style's step.
  const buttonRoom = {
    ...room,
    y: room.y + Math.round(room.height * (1 - BUTTON_ROW)),
    height: Math.round(room.height * BUTTON_ROW),
  }
  const buttonWords = (at: Rect): Words => ({
    key: 'button-row',
    parts: [],
    ...(words.button ? { button: words.button } : {}),
    ...(words.buttonFill ? { buttonFill: words.buttonFill } : {}),
    room: at,
    surface: ground.value,
    justify: 'end',
    leadElsewhere: tried.size,
    ...(words.align ? { align: words.align } : {}),
  })
  const foot = apart ? stackWords(treeBuilder(), b, buttonWords(buttonRoom)).box.y - gap : room.y + room.height
  const visualRoom = first
    ? { ...room, height: top - gap - room.y }
    : { ...room, y: top + gap, height: foot - top - gap }
  // A 9:16 frame's visual, which holds nothing that must be read, spans the frame inside its margin, past the sides
  // the platforms' interface may cover; elsewhere it lines up with the words.
  const across = pinsButton(b) ? { x: frame.margin, width: frame.width - 2 * frame.margin } : {}
  const align = words.align ?? b.style.align
  const spread = { ...visualRoom, ...across }
  const box = visual.fill ? spread : fitIn(spread, visual.ratio, pinsButton(b) ? 'center' : align)
  visual.draw(box)
  const set = stackWords(b.tree, b, of(wordsRoom))
  if (apart) stackWords(b.tree, b, buttonWords(buttonRoom))
  return { set, visual: box }
}
