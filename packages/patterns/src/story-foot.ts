// A 9:16 frame's foot: under its safe room, where the platforms' caption and buttons go, a block in the style's way
// where no photo fills it, so a story is composed down its whole height and never ends in a blank field.
import { isNineBySixteen, type Rect } from '@dazbee/schema'

import { type Build, roles } from './build.ts'
import { ctaFill } from './button.ts'
import { apart, deepColour, INK, inkOn, isDark, lchOf, mixed, ornamentColour, type Swatch } from './palette.ts'
import { path, rect, round, solid } from './tree.ts'

/** The share of a brand colour a minimal 9:16 frame's foot is tinted with, and the least chroma of that tint. */
const FOOT_TINT = 0.1
const FOOT_CHROMA = 8
/** The share of the margin a 9:16 frame's foot starts under its safe room's foot. */
const FOOT_GAP = 0.6
/** How much of a 9:16 frame's foot a photo covers for the foot to be filled, and a ground covers for the foot to go on it. */
const FOOT_FILLED = 0.5
const FOOT_SURFACE = 0.9
/** How deep a foot's slanted or waved top edge is, as a share of the frame's shorter side. */
const FOOT_EDGE_DEPTH = 0.06
/** How plainly a loud foot's colour is apart from the ground and the button: by contrast, or by CIEDE2000. */
const FOOT_APART = { ratio: 1.5, difference: 22 }
/** The share of a shade a foot is mixed with where no brand colour is apart from the ground, and on a premium ground. */
const FOOT_SHADE = 0.25
/**
 * A 9:16 frame's foot, under its safe room, where the platforms' caption and buttons go: where no photo fills it, a
 * block in the style's way over the plain colour that reaches it, so the story is composed down its whole height and
 * never ends in a blank field. A loud style (bold, playful) sets a block of a second brand colour, its top edge the
 * style's; minimal a pale tint of a brand colour with a straight top; premium a deeper shade of the ground under a
 * fine line. Nothing that must be read is set there.
 */
export function storyFoot(b: Build): void {
  const { frame, tree } = b
  if (!isNineBySixteen(frame.width, frame.height)) return
  const top = Math.round(frame.safe.y + frame.safe.height + frame.margin * FOOT_GAP)
  const foot = { x: 0, y: top, width: frame.width, height: frame.height - top }
  const { nodes, roots } = tree.tree()
  const covered = (id: string) => {
    const props = nodes[id]?.props
    if (!props) return 0
    const x = Math.max(foot.x, props.x)
    const y = Math.max(foot.y, props.y)
    const right = Math.min(foot.x + foot.width, props.x + props.width)
    const bottom = Math.min(foot.y + foot.height, props.y + props.height)
    return (Math.max(0, right - x) * Math.max(0, bottom - y)) / (foot.width * foot.height)
  }
  const fillOf = (id: string) => {
    const node = nodes[id]
    return node?.type === 'graphic' ? node.props.fills[0] : undefined
  }
  if (roots.some((id) => fillOf(id)?.type === 'image' && covered(id) >= FOOT_FILLED)) return
  // The plain colour the foot is on: the topmost ground, band or panel of one colour that covers it.
  const surface = roots.findLast((id) => {
    const fill = fillOf(id)
    return nodes[id]?.role === 'background' && fill?.type === 'solid' && covered(id) >= FOOT_SURFACE
  })
  const fill = surface ? fillOf(surface) : undefined
  if (!surface || fill?.type !== 'solid' || (fill.opacity ?? 1) < 1) return
  const bound = nodes[surface]?.bindings?.fill
  const ground: Swatch = { value: fill.color, ...(bound ? { ref: bound } : {}) }
  const block = footBlock(b, ground)
  const depth = Math.round(Math.min(frame.width, frame.height) * FOOT_EDGE_DEPTH)
  // A slanted or waved top edge is drawn inside the foot, so it keeps under the safe room.
  const part =
    block.edge === 'straight'
      ? rect('Foot', foot, solid(block.colour))
      : path('Foot', foot, footOutline(foot, block.edge, depth), solid(block.colour))
  tree.addOver('foot', { ...part, role: 'background' }, surface)
  if (block.line) {
    const thick = Math.max(1, Math.round(Math.min(frame.width, frame.height) * 0.004))
    const box = { x: 0, y: foot.y, width: frame.width, height: thick }
    const line = rect('Foot line', box, solid(block.line.colour, block.line.opacity))
    tree.addOver('foot-line', { ...line, role: 'decoration' }, 'foot')
  }
}

/** The colour and top edge of a 9:16 frame's foot on `ground`, in the style's way, and the fine line over it. */
function footBlock(
  b: Build,
  ground: Swatch,
): { colour: Swatch; edge: 'straight' | 'slant' | 'wave'; line?: { colour: Swatch; opacity?: number } } {
  const { palette, styleName } = b
  if (styleName === 'bold' || styleName === 'playful') {
    // A brand colour plainly apart from the ground, and from the button where one is, so the button stands clear.
    const button = ctaFill(palette, ground, roles(b).cta).fill
    const shows = (swatch: Swatch) =>
      swatch.value !== ground.value && apart(swatch.value, ground.value, FOOT_APART.ratio, FOOT_APART.difference)
    const clear = (swatch: Swatch) =>
      shows(swatch) && apart(swatch.value, button.value, FOOT_APART.ratio, FOOT_APART.difference)
    const offered = [palette.accent, palette.secondary, palette.primary, deepColour(palette)]
    const shade = mixed(ground.value, inkOn(ground.value, [palette.text, palette.background]).value, FOOT_SHADE)
    const colour = offered.find(clear) ?? offered.find(shows) ?? { value: shade }
    return { colour, edge: styleName === 'bold' ? 'slant' : 'wave' }
  }
  if (styleName === 'minimal') {
    // A tint of the primary, or of the accent where that tint would read as grey.
    const tinted = (swatch: Swatch) => mixed(ground.value, swatch.value, FOOT_TINT)
    const colour = lchOf(tinted(palette.primary)).chroma >= FOOT_CHROMA ? palette.primary : palette.accent
    return { colour: { value: tinted(colour) }, edge: 'straight' }
  }
  const deeper = mixed(ground.value, isDark(ground.value) ? INK.value : palette.text.value, FOOT_SHADE)
  const { colour, opacity } = ornamentColour(palette, deeper)
  return { colour: { value: deeper }, edge: 'straight', line: { colour, ...(opacity === 1 ? {} : { opacity }) } }
}

/** A foot's outline as SVG path data in its box's pixels: its top slanted across `depth`, or waved within it. */
function footOutline(box: Rect, edge: 'slant' | 'wave', depth: number): string {
  const { width, height } = box
  const far = `L ${width} ${height} L 0 ${height} Z`
  if (edge === 'slant') return `M 0 ${depth} L ${width} 0 ${far}`
  const half = depth / 2
  const waves = Math.max(2, Math.round(width / (depth * 5)))
  const step = width / (waves * 2)
  let d = `M 0 ${half}`
  for (let i = 0; i < waves * 2; i++)
    d += ` Q ${round(step * (i + 0.5))} ${round(i % 2 === 0 ? -half : 3 * half)} ${round(step * (i + 1))} ${half}`
  return `${d} ${far}`
}
