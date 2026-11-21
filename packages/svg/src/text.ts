// SVG text as a text layer: its lines, size, weight and colours, placed where the text starts.

import { withOpacity } from './color.ts'
import { length, numbers } from './lengths.ts'
import { paintOf } from './shapes.ts'
import type { Style } from './style.ts'
import { apply, lengthScale, type Matrix, nearestTurnAndFlipOf, rotate } from './transform.ts'
import type { Context, Piece } from './types.ts'
import type { XmlElement } from './xml.ts'

export function textLayer(context: Context, element: XmlElement, style: Style, m: Matrix): Piece | null {
  const { nodes, skipped, newId, fontFamily } = context
  if (style.visibility === 'hidden' || style.visibility === 'collapse') return null
  // Each tspan with its own y starts a line.
  const lines: string[] = []
  let line = ''
  let lineY: number | undefined
  const walk = (node: XmlElement, first: boolean) => {
    for (const child of node.children) {
      if (typeof child === 'string') {
        line += child.replace(/\s+/g, ' ')
        continue
      }
      if (child.name === 'textPath') skipped.add('text-path')
      const y = child.attrs.y === undefined ? undefined : numbers(child.attrs.y)[0]
      if (child.name === 'tspan' && y !== undefined && lineY !== undefined && y !== lineY && line.trim()) {
        lines.push(line.trim())
        line = ''
      }
      if (y !== undefined) lineY = y
      walk(child, false)
    }
    if (first) lines.push(line.trim())
  }
  walk(element, true)
  const content = lines.filter(Boolean).join('\n')
  if (!content) return null
  context.count('characters', content.length)
  const firstSpan = element.children.find((c): c is XmlElement => typeof c !== 'string' && c.name === 'tspan')
  const x = numbers(element.attrs.x ?? firstSpan?.attrs.x)[0] ?? 0
  const y = numbers(element.attrs.y ?? firstSpan?.attrs.y)[0] ?? 0
  const k = lengthScale(m)
  const fontSize = length(style['font-size'], 16, 16) * k
  if (!(fontSize > 0)) return null
  const fillPaint = paintOf(
    context,
    style.fill ?? 'black',
    style['fill-opacity'],
    style,
    m,
    { x: 0, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 1, height: 1 },
  )
  const color = !fillPaint
    ? '#00000000'
    : fillPaint.type === 'solid'
      ? withOpacity(fillPaint.color, fillPaint.opacity ?? 1)
      : 'stops' in fillPaint
        ? (fillPaint.stops[0]?.color ?? '#000000FF')
        : '#000000FF'
  // A stroke along the letters is the text's outline, in its first colour.
  const strokePaint = paintOf(
    context,
    style.stroke,
    style['stroke-opacity'],
    style,
    m,
    { x: 0, y: 0, width: 1, height: 1 },
    { x: 0, y: 0, width: 1, height: 1 },
  )
  const outlineWidth = length(style['stroke-width'], 16, 1) * k
  const outlineColor = !strokePaint
    ? null
    : strokePaint.type === 'solid'
      ? withOpacity(strokePaint.color, strokePaint.opacity ?? 1)
      : 'stops' in strokePaint
        ? (strokePaint.stops[0]?.color ?? null)
        : null
  const outline = outlineColor && outlineWidth > 0 ? { width: outlineWidth, color: outlineColor } : null
  const anchor = style['text-anchor'] ?? 'start'
  const rows = content.split('\n')
  // The width is a guess from the letters until the editor lays the text out.
  const width = Math.max(...rows.map((r) => r.length)) * fontSize * 0.55
  const height = rows.length * fontSize * 1.2
  const at = apply(m, x, y)
  const shift = anchor === 'middle' ? width / 2 : anchor === 'end' ? width : 0
  // The box turns, and a mirrored text flips, about the box's centre: the centre goes where that
  // puts the point the words start from at the point the file draws them from.
  const { rotation, ...flips } = nearestTurnAndFlipOf(m)
  const across = width / 2 - shift
  const down = height / 2 - fontSize * 0.9
  const toCentre = apply(rotate(rotation), flips.flipX ? -across : across, flips.flipY ? -down : down)
  const box = { x: at.x + toCentre.x - width / 2, y: at.y + toCentre.y - height / 2, width, height }
  const weight =
    style['font-weight'] === 'bold'
      ? 700
      : style['font-weight'] === 'normal'
        ? 400
        : Number.parseInt(style['font-weight'] ?? '400', 10)
  const families = (style['font-family'] ?? '')
    .split(',')
    .map((f) => f.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
  const id = newId()
  nodes[id] = {
    type: 'text',
    parentId: 'root',
    link: id,
    index: 'a0',
    name: content.slice(0, 40).replace(/\n/g, ' '),
    props: {
      ...box,
      ...(Math.abs(rotation) > 0.01 ? { rotation } : {}),
      ...flips,
      text: content,
      style: {
        fontFamily: fontFamily(families),
        fontSize,
        color,
        fontWeight: Number.isFinite(weight) ? Math.min(900, Math.max(100, Math.round(weight / 100) * 100)) : 400,
        fontStyle: style['font-style'] === 'italic' || style['font-style'] === 'oblique' ? 'italic' : 'normal',
        ...(outline ? { outline } : {}),
      },
      align: anchor === 'middle' ? 'center' : anchor === 'end' ? 'end' : 'start',
      boxMode: 'autoWidth',
    },
  }
  return { id, box }
}
