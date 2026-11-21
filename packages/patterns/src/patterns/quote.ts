// Quote: what a customer said, large, under drawn quotation marks, with who said it beside their photo in a circle.
// The style draws the marks and the stars: big accent marks and five stars on brand colour (bold), fine marks on the
// background (minimal), marks in a soft disc with stars (playful), or gold marks inside a fine frame line on a dark
// ground (premium).
import type { Rect } from '@dazbee/schema'

import { type Build, logo, logoRoom } from '../build.ts'
import { insetFrame, quoteMarks } from '../decorations.ts'
import { contrast, type Swatch } from '../palette.ts'
import { ellipse, picture, rect, round, solid, star } from '../tree.ts'
import type { Pattern } from '../types.ts'
import { rowWords, stackWords, type Words } from '../words.ts'

export const QUOTE: Pattern = {
  id: 'quote',
  name: 'Quote',
  kinds: ['quote or testimonial'],
  description:
    'What a customer said, as the headline under drawn quotation marks, with who said it (attribution) beside their photo in a circle.',
  needs: ['headline', 'attribution'],
  takes: ['photo', 'button', 'logo'],
}

/** Builds the quote in the frame. */
export function quote(b: Build) {
  const { frame, styleName, palette, content } = b
  const { width, height, shape, margin, safe } = frame
  const short = Math.min(width, height)
  const ground = groundColour(b)
  if (ground !== palette.background)
    b.tree.add('ground', { ...rect('Ground', { x: 0, y: 0, width, height }, solid(ground)), role: 'background' })
  const markColour = contrast(palette.accent.value, ground.value) >= 1.6 ? palette.accent : palette.primary
  const centred = b.style.align === 'center'
  let room: Rect = { ...safe }
  // The logo across the top, but in a strip or banner.
  if (shape !== 'strip' && shape !== 'banner') {
    const top = logoRoom(b, { x: safe.x, y: safe.y }, safe.width)
    if (centred) top.x = Math.round(safe.x + (safe.width - top.width) / 2)
    if (logo(b, top, centred ? 'center' : 'start', ground)) {
      const below = top.height + margin
      room = { ...room, y: room.y + below, height: room.height - below }
    }
  }
  // The person's photo: on the left in a wide frame, banner or strip, else over the marks.
  const side = shape === 'wide' || shape === 'banner' || shape === 'strip'
  if (content.photo) {
    const d = Math.round(
      side
        ? Math.min(room.height * (shape === 'wide' ? 0.6 : 1), room.width * 0.3)
        : Math.min(short * 0.17, room.height * 0.2),
    )
    const at = side
      ? { x: room.x, y: room.y + (room.height - d) / 2 }
      : { x: centred ? room.x + (room.width - d) / 2 : room.x, y: room.y }
    const box = { x: round(at.x), y: round(at.y), width: d, height: d }
    if (styleName === 'playful' || styleName === 'bold') {
      const ring = Math.max(2, Math.round(d * 0.05))
      b.tree.add(
        'photo-ring',
        ellipse(
          'Ring',
          { x: box.x - ring, y: box.y - ring, width: d + 2 * ring, height: d + 2 * ring },
          solid(markColour),
        ),
      )
    }
    b.tree.add('photo', { ...picture('Photo', box, content.photo, { radius: d / 2 }), role: 'person' })
    const gap = Math.round(margin * 0.6)
    room = side
      ? { ...room, x: room.x + d + gap * 1.5, width: room.width - d - gap * 1.5 }
      : { ...room, y: room.y + d + gap, height: room.height - d - gap }
  }
  // The marks over the words, and five stars in a bold or playful style; a banner or strip has no room for them.
  if (shape !== 'strip' && shape !== 'banner') {
    const markHeight = Math.round(Math.max(frame.readable * 1.5, Math.min(short * 0.075, room.height * 0.12)))
    const markWidth = Math.round(markHeight * 1.22)
    const marks = {
      x: centred ? Math.round(room.x + (room.width - markWidth) / 2) : room.x,
      y: room.y,
      width: markWidth,
      height: markHeight,
    }
    quoteMarks(b, marks, markColour)
    let below = markHeight + Math.round(margin * 0.4)
    if (styleName === 'bold' || styleName === 'playful') {
      const starSize = Math.round(markHeight * 0.55)
      const row = starSize * 5 + Math.round(starSize * 0.2) * 4
      const x0 = centred ? room.x + (room.width - row) / 2 : room.x + markWidth + starSize
      const y0 = centred ? room.y + markHeight + Math.round(margin * 0.3) : room.y + (markHeight - starSize) / 2
      for (let i = 0; i < 5; i++)
        b.tree.add(
          `star-${i + 1}`,
          star(
            `Star ${i + 1}`,
            { x: round(x0 + i * starSize * 1.2), y: round(y0), width: starSize, height: starSize },
            { points: 5, inner: 0.45 },
            solid(markColour),
          ),
        )
      if (centred) below += starSize + Math.round(margin * 0.3)
    }
    room = { ...room, y: room.y + below, height: room.height - below }
  }
  const words: Words = {
    parts: [
      { kind: 'headline', text: content.headline },
      ...(content.attribution ? [{ kind: 'attribution' as const, text: content.attribution }] : []),
    ],
    room,
    surface: ground.value,
    justify: 'center',
    most: Math.round(short * b.style.headlineMax * 0.85),
    ...(content.button ? { button: content.button, buttonFill: buttonColour(b, ground) } : {}),
  }
  if (shape === 'strip') rowWords(b.tree, b, words)
  else {
    const set = stackWords(b.tree, b, words)
    // Over the words, the photo, marks and stars come down with them, so the whole sits in the middle.
    const dy = set.box.y - room.y
    if (!side && dy > 0)
      for (const key of ['photo-ring', 'photo', 'quote-marks', ...[1, 2, 3, 4, 5].map((i) => `star-${i}`)])
        if (b.tree.tree().nodes[key]) b.tree.moveDown(key, dy)
  }
  if (styleName === 'premium' && shape !== 'strip') insetFrame(b, palette.accent, Math.round(margin * 0.4), 0.8)
}

/** The ground: the primary (bold), a dark (premium), else the kit's background. */
function groundColour({ styleName, palette }: Build): Swatch {
  if (styleName === 'bold') return palette.primary
  if (styleName === 'premium') return palette.secondary
  return palette.background
}

/** The button's colour: the accent where it stands out from the ground, else the primary. */
function buttonColour({ palette }: Build, ground: Swatch): Swatch {
  return contrast(palette.accent.value, ground.value) >= 1.6 ? palette.accent : palette.primary
}
