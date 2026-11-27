// What drawing a connector shows on the overlay, while the Arrow shape is the tool: the four dots of
// the frame or section the pointer is near, and while one is dragged from, the frame or section it
// would join, lit, and the curve it would draw. They are short-lived, so the overlay draws them,
// though the connectors themselves are drawn under the frames by the stage's surface.
import type { ShownConnecting } from '../gestures/drawing/connecting.ts'
import { arrowheadOf, type ConnectorCurve } from './connectors.ts'
import { px } from './rulers.ts'

const SVG = 'http://www.w3.org/2000/svg'

/** The dots, the lit frame or section and the curve a drag draws, as overlay elements; none while nothing shows. */
export function connectorParts({ dots, hot, preview, lit }: ShownConnecting): Element[] {
  const parts: Element[] = dots.map((at, side) => {
    const dot = document.createElement('div')
    dot.className = 'connector-dot'
    dot.dataset.side = String(side)
    if (side === hot) dot.dataset.hot = ''
    Object.assign(dot.style, { left: px(at.x), top: px(at.y) })
    return dot
  })
  if (lit) {
    const box = document.createElement('div')
    box.className = 'connector-target'
    if (lit.section) {
      box.dataset.section = ''
      box.style.borderRadius = px(lit.radius)
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
  // The line stops at its arrowhead's base, so it never shows through the head.
  const { head, line } = arrowheadOf(curve)
  const svg = document.createElementNS(SVG, 'svg')
  svg.setAttribute('class', 'connector-preview')
  const path = document.createElementNS(SVG, 'path')
  const { from, c1, c2, to } = line
  path.setAttribute('d', `M ${from.x} ${from.y} C ${c1.x} ${c1.y} ${c2.x} ${c2.y} ${to.x} ${to.y}`)
  const { tip, left, right } = head
  const arrow = document.createElementNS(SVG, 'path')
  arrow.setAttribute('d', `M ${tip.x} ${tip.y} L ${left.x} ${left.y} L ${right.x} ${right.y} Z`)
  arrow.dataset.head = ''
  svg.append(path, arrow)
  return svg
}
