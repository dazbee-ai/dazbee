// Event date: the date as a calendar page, its day large under a strip holding the rest (the month, the weekday),
// with the event's words and button beside or under it. The style draws the page: white on brand colour under an
// accent strip, over a hard shadow (bold), a pale page edged in a fine line under a primary strip (minimal), rounded
// with two rings on its strip (playful), or the light colour under a deep strip with a fine accent line (premium). A
// short frame sets the date as a chip before its words.
import { type Rect, TextProps } from '@dazbee/schema'

import { type Build, ground, isShort, roles, usualWords } from '../build.ts'
import { ctaFill } from '../button.ts'
import { card } from '../card.ts'
import { layOut } from '../layout.ts'
import { apart, deepColour, mixed, ornamentColour, type Swatch, withAlpha } from '../palette.ts'
import { inkFor, lookStyle } from '../text-look.ts'
import { ellipse, rect, round, solid, stroke } from '../tree.ts'
import type { Pattern } from '../types.ts'

export const EVENT_DATE: Pattern = {
  id: 'event-date',
  name: 'Event date',
  kinds: ['event'],
  description:
    'The date (`number`, such as “28 Nov”) as a calendar page, its day large under a strip with the month, and the event’s words and button beside or under it.',
  needs: ['headline', 'number'],
  takes: ['kicker', 'subline', 'button', 'highlight', 'logo'],
}

/** The page's width over its height, its strip's share of its height, and the room round its words. */
const PAGE_RATIO = 0.86
const STRIP = 0.27
/** The least height of the strip, as a multiple of the readable size, so its words fit it. */
const STRIP_LEAST = 1.7
const PAGE_PAD = 0.12
/** How plainly the page stands apart from the ground. */
const PAGE_APART = { ratio: 1.3, difference: 18 }
/** A day of the month, with or without its ending. */
const DAY = /^\d{1,2}(st|nd|rd|th)?$/iu

/** Builds the event date in the frame. */
export function eventDate(b: Build) {
  const { palette, content } = b
  // A short frame, with no room for the page, sets the date as a chip before its words, as a ticket does.
  if (isShort(b)) {
    card(b, { stub: [{ kind: 'number', text: content.number ?? '' }], tear: 'holes', shortOn: 'ground' })
    return
  }
  const colour = ground(b)
  layOut(b, {
    ground: colour,
    words: {
      parts: usualWords(content),
      ...(content.button ? { button: content.button, buttonFill: ctaFill(palette, colour, roles(b).cta) } : {}),
    },
    visual: { ratio: PAGE_RATIO, draw: (box) => page(b, box, colour) },
  })
}

/** The date's day and the rest of it: the day where one word of it is a day of the month, else the whole date. */
export function dateParts(date: string): { day: string; rest: string } {
  const words = date.trim().split(/\s+/u)
  const at = words.findIndex((word) => DAY.test(word.replace(/[,.]$/u, '')))
  if (at < 0 || words.length === 1) return { day: date.trim(), rest: '' }
  return { day: words[at]?.replace(/[,.]$/u, '') ?? '', rest: words.filter((_, i) => i !== at).join(' ') }
}

/** The calendar page in `box`: the page, its strip with the rest of the date, and the day. */
function page(b: Build, box: Rect, colour: Swatch) {
  const { palette, styleName, frame } = b
  const fill = pageColour(b, colour)
  const radius = Math.round(box.width * Math.max(b.style.round * 1.2, styleName === 'bold' ? 0 : 0.04))
  if (styleName === 'bold') {
    const by = Math.max(3, Math.round(Math.min(frame.width, frame.height) * 0.014))
    b.tree.add(
      'page-shadow',
      rect('Page shadow', { ...box, x: box.x + by, y: box.y + by }, solid(deepColour(palette)), { radius }),
    )
  }
  const edge =
    styleName === 'minimal'
      ? { strokes: [stroke(withAlpha(palette.primary.value, 0.45), Math.max(1, round(box.width * 0.006)))] }
      : {}
  b.tree.add('page', rect('Page', box, solid(fill), { radius, ...edge }))
  const stripColour = stripOf(b, fill)
  const strip = { ...box, height: Math.round(Math.max(box.height * STRIP, frame.readable * STRIP_LEAST)) }
  b.tree.add('page-strip', rect('Page strip', strip, solid(stripColour), { radius: [radius, radius, 0, 0] }))
  if (styleName === 'playful') {
    const ring = Math.round(box.width * 0.07)
    for (const [i, at] of [0.28, 0.72].entries())
      b.tree.add(
        `ring-${i + 1}`,
        ellipse(
          `Ring ${i + 1}`,
          { x: round(box.x + box.width * at - ring / 2), y: round(strip.y - ring / 2), width: ring, height: ring },
          { fills: [] },
          { strokes: [stroke(deepColour(palette).value, Math.max(2, round(ring * 0.18)))] },
        ),
      )
  }
  if (styleName === 'premium') {
    const { colour: line } = ornamentColour(palette, stripColour.value)
    const thick = Math.max(1, round(box.width * 0.006))
    b.tree.add(
      'page-line',
      rect('Page line', { x: box.x, y: strip.y + strip.height - thick, width: box.width, height: thick }, solid(line)),
    )
  }
  const { day, rest } = dateParts(b.content.number ?? '')
  const pad = box.width * PAGE_PAD
  if (rest) {
    const size = Math.max(frame.readable, Math.round(strip.height * 0.38))
    dateText(
      b,
      'date-rest',
      'Month',
      rest,
      { x: box.x + pad, y: strip.y, width: box.width - 2 * pad, height: strip.height },
      size,
      stripColour,
      b.style.kicker,
    )
  }
  const body = {
    x: box.x + pad,
    y: strip.y + strip.height,
    width: box.width - 2 * pad,
    height: box.height - strip.height,
  }
  const at = 100
  const wide = b.measure(dateProps(b, day, at, body.width, '#000000FF', b.style.headline), null).width
  const size = Math.max(frame.readable, Math.floor(Math.min((body.width / Math.max(1, wide)) * at, body.height * 0.66)))
  dateText(b, 'date-day', 'Day', day, body, size, fill, b.style.headline)
}

/** A text of the date centred in `box` at `size`, in an ink that reads on `surface`, bound to its font and ink. */
function dateText(
  b: Build,
  key: string,
  name: string,
  text: string,
  box: Rect,
  size: number,
  surface: Swatch,
  look: Build['style']['headline'],
) {
  const ink = inkFor(b, surface.value, size)
  const props = {
    ...dateProps(b, text, size, box.width, ink.value, look),
    x: round(box.x),
    y: round(box.y),
    height: round(box.height),
  }
  const font = b.palette[look.font]
  b.tree.add(key, {
    type: 'text',
    name,
    role: key === 'date-day' ? 'price' : 'body',
    props,
    bindings: { ...(font.ref ? { fontFamily: font.ref } : {}), ...(ink.ref ? { textColor: ink.ref } : {}) },
  })
}

/** A text of the date in a look at `size`, centred in a box `width` wide. */
function dateProps(
  b: Build,
  text: string,
  size: number,
  width: number,
  colour: string,
  look: Build['style']['headline'],
) {
  return TextProps.parse({
    x: 0,
    y: 0,
    width,
    height: size,
    text,
    style: { ...lookStyle(b, look, size), color: colour, lineHeight: 1 },
    align: 'center',
    verticalAlign: 'middle',
    boxMode: 'fixed',
  })
}

/** The page's colour: a pale tint in a minimal style, else the first of the kit's light colours apart from the ground. */
function pageColour(b: Build, colour: Swatch): Swatch {
  const { palette } = b
  if (b.styleName === 'minimal') return { value: mixed(colour.value, palette.primary.value, 0.05) }
  const offered = [palette.background, palette.secondary, palette.primary, deepColour(palette)]
  const shows = (swatch: Swatch) =>
    swatch.value !== colour.value && apart(swatch.value, colour.value, PAGE_APART.ratio, PAGE_APART.difference)
  return offered.find(shows) ?? { value: mixed(colour.value, palette.text.value, 0.08) }
}

/** The strip's colour on the page: the accent (bold, playful), the primary (minimal) or the deep colour (premium). */
function stripOf(b: Build, page: Swatch): Swatch {
  const { palette, styleName } = b
  if (styleName === 'premium') return deepColour(palette)
  return ctaFill(palette, page, styleName === 'minimal' ? 'primary' : 'accent').fill
}
