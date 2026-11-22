// App icon: the app's icon (the logo on a rounded tile, or the logo's own box rounded) large, as a phone shows it, with
// the words and a download button beside or under it. The tile is in a colour the logo reads on, apart from the
// ground. A short frame sets the logo at its start instead. The style sets the tile: over a hard offset tile of the deep colour (bold), with a soft shadow (minimal), on
// two soft rings of the accent with a group of dots (playful), or inside a fine accent line (premium).
import type { Rect } from '@dazbee/schema'

import { type Build, ground, isShort, roles, usualWords } from '../build.ts'
import { ctaFill } from '../button.ts'
import { dotGroup } from '../decorations.ts'
import { layOut } from '../layout.ts'
import { contrast, deepColour, INK, ornamentColour, type Swatch, WHITE, withAlpha } from '../palette.ts'
import { leastInkContrast } from '../picture-look.ts'
import { ellipse, fitted, picture, rect, round, solid, stroke } from '../tree.ts'
import type { Pattern, Picture } from '../types.ts'

export const APP_ICON: Pattern = {
  id: 'app-icon',
  name: 'App icon',
  kinds: ['app download'],
  description:
    'The app’s icon, the logo on a rounded tile, large as a phone shows it, with the words and a download button beside or under it.',
  needs: ['headline', 'logo'],
  takes: ['kicker', 'subline', 'button', 'highlight'],
}

/** A tile's corners, as a share of its side, as a phone rounds an app's icon. */
const CORNER = 0.22
/** The room round the logo on its tile, as a share of the tile's side. */
const INSET = 0.18
/** The contrast under which a tile doesn't show on the ground; and at which a logo's ink reads on its tile. */
const TILE_SHOWS = 1.25
const INK_READS = 3

/** Builds the app icon in the frame. */
export function appIcon(b: Build) {
  const { palette, content } = b
  const colour = ground(b)
  const logo = content.logo
  // A short frame, with no room for the icon, sets the logo at its start as any pattern does; elsewhere the logo is
  // the icon, so the frame places it nowhere else.
  const words = { ...content }
  if (!isShort(b)) delete words.logo
  const plain: Build = { ...b, content: words }
  layOut(plain, {
    ground: colour,
    words: {
      parts: usualWords(words),
      ...(words.button ? { button: words.button, buttonFill: ctaFill(palette, colour, roles(b).cta) } : {}),
    },
    ...(logo && !isShort(b) ? { visual: { ratio: 1, draw: (box: Rect) => icon(b, box, colour, logo) } } : {}),
  })
}

/** The icon in `box`: its tile in the style's way, and the logo on it. */
function icon(b: Build, box: Rect, colour: Swatch, logo: Picture) {
  const { styleName, palette, frame } = b
  const side = Math.round(Math.min(box.width, box.height) * (styleName === 'bold' ? 0.94 : 1))
  const tile = { x: box.x, y: box.y, width: side, height: side }
  const radius = Math.round(side * CORNER)
  if (styleName === 'playful') {
    for (const [i, grow] of [0.5, 0.25].entries()) {
      const by = side * grow * 0.5
      const ring = { x: tile.x - by, y: tile.y - by, width: side + 2 * by, height: side + 2 * by }
      b.tree.add(`ring-${i + 1}`, ellipse(`Ring ${i + 1}`, ring, solid(palette.accent, 0.18 + i * 0.12)))
    }
    const dot = Math.min(frame.width, frame.height) * 0.022
    dotGroup(b, 'dot', { x: tile.x + side + dot, y: tile.y - dot }, dot, { x: 0.6, y: 1 }, [
      palette.accent,
      palette.secondary,
      palette.primary,
    ])
  }
  if (styleName === 'bold') {
    const by = Math.round(box.width - side)
    b.tree.add(
      'tile-shadow',
      rect('Tile shadow', { ...tile, x: tile.x + by, y: tile.y + by }, solid(deepColour(palette)), { radius }),
    )
  }
  if (styleName === 'premium') {
    const by = Math.round(side * 0.06)
    const { colour: line, opacity } = ornamentColour(palette, colour.value)
    const frameLine = rect(
      'Icon line',
      { x: tile.x - by, y: tile.y - by, width: side + 2 * by, height: side + 2 * by },
      { fills: [] },
      { radius: radius + by, strokes: [stroke(line.value, Math.max(1, round(side * 0.008)))] },
    )
    b.tree.add('icon-line', { ...frameLine, props: { ...frameLine.props, opacity } })
  }
  const shadow =
    styleName === 'minimal' || styleName === 'premium'
      ? {
          effects: [
            {
              type: 'dropShadow',
              x: 0,
              y: Math.round(side * 0.04),
              blur: Math.round(side * 0.1),
              spread: 0,
              color: withAlpha(INK.value, 0.22),
            },
          ],
        }
      : {}
  const bound = logo.assetId === b.kitLogo
  if (logo.look?.backdrop) {
    // A logo on a box of its own is the icon, drawn whole as the brand drew it.
    const part = picture('Logo', fitted(logo, tile), logo, { fit: 'fit', logo: bound })
    b.tree.add('logo', { ...part, role: 'logo', props: { ...part.props, ...shadow } })
    return
  }
  const fill = tileColour(b, colour, logo)
  b.tree.add('tile', { ...rect('Tile', tile, solid(fill), { radius, ...shadow }), role: 'decoration' })
  const inset = side * INSET
  const room = { x: tile.x + inset, y: tile.y + inset, width: side - 2 * inset, height: side - 2 * inset }
  const ink = logo.look?.subject ?? { x: 0, y: 0, width: logo.width, height: logo.height }
  const at = fitted(ink, room)
  const part = picture('Logo', at, logo, { fit: 'fit', logo: bound, ...(logo.look ? { crop: logo.look.subject } : {}) })
  b.tree.add('logo', { ...part, role: 'logo' })
}

/** The tile's colour: of the kit's background, white, its secondary and primary, and near black, the first apart from the ground that the logo's ink reads on. */
function tileColour(b: Build, colour: Swatch, logo: Picture): Swatch {
  const { palette } = b
  const offered = [palette.background, WHITE, palette.secondary, palette.primary, INK].filter(
    (swatch) => contrast(swatch.value, colour.value) >= TILE_SHOWS,
  )
  const pool = offered.length > 0 ? offered : [WHITE, INK]
  const look = logo.look
  if (!look) return pool[0] ?? WHITE
  return (
    pool.find((swatch) => leastInkContrast(look, swatch.value) >= INK_READS) ??
    pool.reduce((a, c) => (leastInkContrast(look, c.value) > leastInkContrast(look, a.value) ? c : a))
  )
}
