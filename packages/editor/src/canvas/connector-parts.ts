// What drawing a connector shows on the overlay, while the Arrow shape is the tool: the four dots of
// the frame or section the pointer is near, and while one is dragged from, the frame or section it
// would join, lit, and the curve it would draw. They are short-lived, so the overlay draws them,
// though the connectors themselves are drawn under the frames by the stage's surface.
import type { ShownConnecting } from '../gestures/drawing/connecting.ts'
import { arrowAngle, type ConnectorCurve } from './connectors.ts'
import { px } from './rulers.ts'
import { OUTLINE_RADIUS } from './sections.ts'

/** The arrowhead of the curve a drag draws: its length along the curve and its half-width across it, in screen pixels. */
const ARROW_LENGTH = 9
const ARROW_HALF_WIDTH = 4.5
const SVG = 'http://www.w3.org/2000/svg'

/** The dots, the lit frame or section and the curve a drag draws, as overlay elements; none while nothing shows. */
export function connectorParts({ dots, preview, lit }: ShownConnecting): Element[] {
  const parts: Element[] = dots.map((at, side) => {
    const dot = document.createElement('div')
    dot.className = 'connector-dot'
    dot.dataset.side = String(side)
    Object.assign(dot.style, { left: px(at.x), top: px(at.y) })
    return dot
  })
  if (lit) {
    const box = document.createElement('div')
    box.className = 'connector-target'
    if (lit.section) {
      box.dataset.section = ''
      box.style.borderRadius = px(OUTLINE_RADIUS)
    }
    Object.assign(box.style, {
      left: px(lit.box.x),
      top: px(lit.box.y),
      width: px(lit.box.width),
      height: px(lit.box.height),
    })
    parts.push(box)
  }
  if (preview) parts.push(previewCurve(preview))
  return parts
}

/** The curve a drag draws, with its arrowhead, as an SVG over the stage. */
function previewCurve(curve: ConnectorCurve) {
  const { from, c1, c2, to } = curve
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'connector-preview')
  const line = document.createElementNS(SVG, 'path')
  line.setAttribute('d', `M ${from.x} ${from.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}`)
  const angle = arrowAngle(curve)
  const [ax, ay] = [Math.cos(angle), Math.sin(angle)]
  const back = { x: to.x - ax * ARROW_LENGTH, y: to.y - ay * ARROW_LENGTH }
  const head = document.createElementNS(SVG, 'path')
  head.setAttribute(
    'd',
    `M ${to.x} ${to.y} L ${back.x - ay * ARROW_HALF_WIDTH} ${back.y + ax * ARROW_HALF_WIDTH} L ${back.x + ay * ARROW_HALF_WIDTH} ${back.y - ax * ARROW_HALF_WIDTH} Z`,
  )
  head.dataset.head = ''
  svg.append(line, head)
  return svg
}
