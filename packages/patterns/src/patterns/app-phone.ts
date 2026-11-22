// App on a phone: a phone, drawn whole, showing the app's screen (the photo, best a screenshot), with the words and a
// download button beside or under it. The style sets the phone on its ground: over a slanted block of the accent
// (bold), on a pale disc (minimal), on a large disc of the accent with a group of dots (playful), or in a soft light
// inside a fine ring (premium).
import type { Rect } from '@dazbee/schema'

import { type Build, ground, roles, usualWords } from '../build.ts'
import { ctaFill } from '../button.ts'
import { coverCrop } from '../crop.ts'
import { dotGroup, glow } from '../decorations.ts'
import { layOut } from '../layout.ts'
import { contrast, INK, inkOn, mixed, ornamentColour, type Swatch, withAlpha } from '../palette.ts'
import { ellipse, path, picture, rect, round, solid, stroke } from '../tree.ts'
import type { Pattern } from '../types.ts'

export const APP_PHONE: Pattern = {
  id: 'app-phone',
  name: 'App on a phone',
  kinds: ['app download'],
  description:
    'A phone, drawn whole, showing the app’s screen (`photo`, best a screenshot), with the words and a download button beside or under it.',
  needs: ['headline', 'photo'],
  takes: ['kicker', 'subline', 'button', 'highlight', 'logo'],
}

/** The phone's width over its height, its body's corners and its screen's border, as shares of its width. */
const PHONE_RATIO = 0.5
const CORNER = 0.15
const BORDER = 0.04
/** The phone's backing's size: as a share of its height, and at most of its width, so it keeps off the words. */
const BACKING = 0.9
const BACKING_ACROSS = 1.4
/** The contrast under which a phone's dark body is edged in the ground's ink, so it keeps its outline. */
const BODY_SEEN = 1.6

/** Builds the app on a phone in the frame. */
export function appPhone(b: Build) {
  const { palette, content } = b
  const colour = ground(b)
  layOut(b, {
    ground: colour,
    words: {
      parts: usualWords(content),
      ...(content.button ? { button: content.button, buttonFill: ctaFill(palette, colour, roles(b).cta) } : {}),
    },
    visual: { ratio: PHONE_RATIO, draw: (box) => phone(b, box, colour), short: false },
  })
}

/** The phone in `box` on the style's backing, its screen showing the photo. */
function phone(b: Build, box: Rect, colour: Swatch) {
  const { styleName, palette, frame, content } = b
  backing(b, box, colour)
  const body = { value: mixed(INK.value, colour.value, 0.08) }
  const edged = contrast(body.value, colour.value) < BODY_SEEN
  const radius = Math.round(box.width * CORNER)
  const edge = edged
    ? {
        strokes: [
          stroke(
            withAlpha(inkOn(colour.value, [palette.background, palette.text]).value, 0.5),
            Math.max(1, round(box.width * 0.012)),
          ),
        ],
      }
    : {}
  b.tree.add('phone', { ...rect('Phone', box, solid(body), { radius, ...edge }), role: 'decoration' })
  const border = Math.round(box.width * BORDER)
  const screen = {
    x: box.x + border,
    y: box.y + border,
    width: box.width - 2 * border,
    height: box.height - 2 * border,
  }
  if (content.photo) {
    const shot = coverCrop(content.photo, screen)
    b.tree.add('screen', {
      ...picture('Screen', screen, content.photo, { radius: radius - border, crop: shot.crop }),
      role: 'product',
    })
  }
  // The camera's island at the top of the screen.
  const island = {
    x: box.x + box.width * 0.36,
    y: screen.y + box.width * 0.035,
    width: box.width * 0.28,
    height: box.width * 0.07,
  }
  b.tree.add('island', rect('Camera', island, solid(body), { radius: Math.round(island.height / 2) }))
  if (styleName === 'playful') {
    const dot = Math.min(frame.width, frame.height) * 0.022
    dotGroup(b, 'dot', { x: box.x + box.width + dot * 2.2, y: box.y + box.height * 0.2 }, dot, { x: 0.4, y: 1 }, [
      palette.accent,
      palette.secondary,
      palette.primary,
    ])
  }
}

/** What the phone stands on, in the style's way, centred on it. */
function backing(b: Build, box: Rect, colour: Swatch) {
  const { styleName, palette } = b
  const cx = box.x + box.width / 2
  const cy = box.y + box.height / 2
  const side = Math.min(box.height * BACKING, box.width * BACKING_ACROSS)
  const disc = { x: round(cx - side / 2), y: round(cy - side / 2), width: round(side), height: round(side) }
  const shows = (swatch: Swatch) => swatch.value !== colour.value && contrast(swatch.value, colour.value) >= 1.2
  const first = [palette.accent, palette.secondary, palette.background].find(shows) ?? palette.accent
  if (styleName === 'bold') {
    // A slanted block behind the phone's lower half.
    const block = {
      x: box.x - box.width * 0.2,
      y: box.y + box.height * 0.3,
      width: box.width * 1.4,
      height: box.height * 0.55,
    }
    const lean = block.height * 0.25
    const d = `M 0 ${round(lean)} L ${round(block.width)} 0 L ${round(block.width)} ${round(block.height - lean)} L 0 ${round(block.height)} Z`
    b.tree.add('backing', path('Backing', block, d, solid(first)))
  } else if (styleName === 'minimal') {
    b.tree.add('backing', ellipse('Backing', disc, solid({ value: mixed(colour.value, palette.primary.value, 0.08) })))
  } else if (styleName === 'playful') {
    b.tree.add('backing', ellipse('Backing', disc, solid(first)))
  } else {
    glow(b, 'backing', disc, first.value, 0.35)
    const { colour: line, opacity } = ornamentColour(palette, colour.value)
    const ring = ellipse(
      'Ring',
      disc,
      { fills: [] },
      { strokes: [stroke(line.value, Math.max(1, round(side * 0.004)))] },
    )
    b.tree.add('ring', { ...ring, props: { ...ring.props, opacity } })
  }
}
