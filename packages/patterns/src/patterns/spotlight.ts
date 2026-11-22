// Spotlight: the product, best a cut-out, in a beam of light falling from above onto a pool of light on the floor, as
// a thing unveiled, with the words and button under or beside it. The style lights it: an accent beam on brand
// colour (bold), a pale beam of the primary on the background (minimal), an accent beam with sparkles (playful), or
// a gold beam on a deep ground (premium).
import type { Rect } from '@dazbee/schema'

import { type Build, ground, roles, usualWords } from '../build.ts'
import { ctaFill } from '../button.ts'
import { meets } from '../crop.ts'
import { glow } from '../decorations.ts'
import { layOut } from '../layout.ts'
import { contrast, inkOn, type Swatch, withAlpha } from '../palette.ts'
import { standProduct } from '../product-stage.ts'
import { linear, path, round, solid, star } from '../tree.ts'
import type { Pattern } from '../types.ts'

export const SPOTLIGHT: Pattern = {
  id: 'spotlight',
  name: 'Spotlight',
  kinds: ['product launch', 'single product'],
  description:
    'The product, best a cut-out, in a beam of light falling onto it from above, as something unveiled, with the words and button under or beside it.',
  needs: ['headline', 'photo'],
  takes: ['kicker', 'subline', 'button', 'highlight', 'logo'],
}

/** The beam and product's width over their height. */
const BEAM_RATIO = 0.86
/** The beam's width at its top and at its foot, as shares of the visual's width. */
const BEAM = { top: 0.22, foot: 0.96 }
/** The strength of the beam at its top and its foot, and of the pool of light on the floor. */
const STRENGTH = { top: 0.5, foot: 0.12, pool: 0.55 }
/** The contrast under which a beam's light doesn't show on the ground, and the style's primary is used. */
const SHOWS = 1.3

/** Builds the spotlight in the frame. */
export function spotlight(b: Build) {
  const { palette, content } = b
  const colour = ground(b)
  layOut(b, {
    ground: colour,
    words: {
      parts: usualWords(content),
      ...(content.button ? { button: content.button, buttonFill: ctaFill(palette, colour, roles(b).cta) } : {}),
    },
    visual: { ratio: BEAM_RATIO, draw: (box) => drawBeam(b, box, colour), short: false },
  })
}

/** The beam falling down `box` onto its floor, the pool of light, and the product standing in it. */
function drawBeam(b: Build, box: Rect, colour: Swatch) {
  const { styleName, palette } = b
  const light = beamColour(b, colour)
  const top = box.width * BEAM.top
  const foot = box.width * BEAM.foot
  const floor = box.y + box.height * 0.9
  const beam = { x: box.x + (box.width - foot) / 2, y: box.y, width: foot, height: floor - box.y }
  const inset = (foot - top) / 2
  const d = `M ${round(inset)} 0 L ${round(foot - inset)} 0 L ${round(foot)} ${round(beam.height)} L 0 ${round(beam.height)} Z`
  const fill = linear([0.5, 0], [0.5, 1], [withAlpha(light.value, STRENGTH.top), withAlpha(light.value, STRENGTH.foot)])
  b.tree.add('beam', { ...path('Beam', beam, d, fill), role: 'decoration' })
  const pool = { x: beam.x - foot * 0.04, y: floor - box.height * 0.09, width: foot * 1.08, height: box.height * 0.18 }
  glow(b, 'pool', pool, light.value, STRENGTH.pool)
  const room = {
    x: box.x + box.width * 0.1,
    y: box.y + box.height * 0.22,
    width: box.width * 0.8,
    height: floor - box.y - box.height * 0.22 + box.height * 0.02,
  }
  const product = standProduct(b, room, colour)
  if (styleName === 'playful' && product) sparkles(b, box, product.box, palette.accent)
}

/** The beam's light on `ground`: the accent (bold, playful, premium) or primary (minimal), else the ground's ink. */
function beamColour({ palette, styleName }: Build, ground: Swatch): Swatch {
  const first = styleName === 'minimal' ? palette.primary : styleName === 'premium' ? palette.accent : palette.accent
  if (contrast(first.value, ground.value) >= SHOWS) return first
  return inkOn(ground.value, [palette.background, palette.text])
}

/** Three sparkles round the product's top, each kept off it. */
function sparkles(b: Build, box: Rect, product: Rect, colour: Swatch) {
  const size = box.width * 0.07
  const spots = [
    { x: box.x + box.width * 0.1, y: box.y + box.height * 0.3, s: size },
    { x: box.x + box.width * 0.82, y: box.y + box.height * 0.18, s: size * 0.7 },
    { x: box.x + box.width * 0.74, y: box.y + box.height * 0.42, s: size * 0.5 },
  ]
  for (const [i, { x, y, s }] of spots.entries()) {
    const at = { x: round(x), y: round(y), width: round(s), height: round(s) }
    if (meets(at, product, s * 0.3)) continue
    b.tree.add(`sparkle-${i + 1}`, star(`Sparkle ${i + 1}`, at, { points: 4, inner: 0.35 }, solid(colour)))
  }
}
