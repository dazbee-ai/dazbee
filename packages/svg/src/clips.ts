// An SVG clip path as a mask layer: the outlines of its shapes, joined and baked into the design's
// coordinates.

import type { Path } from '@dazbee/canvaskit'
import type { Rect } from '@dazbee/schema'

import { length } from './lengths.ts'
import { nameOf } from './names.ts'
import { boundsOf, pathData, transformed } from './path-data.ts'
import { outline, SHAPES } from './shapes.ts'
import { type Style, styleOf } from './style.ts'
import { type Matrix, multiply, parseTransform, scale, translate } from './transform.ts'
import type { Context, Piece } from './types.ts'
import type { XmlElement } from './xml.ts'

/**
 * The element's clip path as a mask layer, or undefined when it clips nothing away: a clip
 * that is one rectangle holding the whole of `inside`, as most design tools write, unless what
 * it clips `reaches` past `inside` with its effects.
 */
export function clipMask(
  context: Context,
  spend: () => void,
  id: string,
  m: Matrix,
  inside: Rect,
  reaches: boolean,
): Piece | null | undefined {
  const { ck, ids, rules, nodes, newId } = context
  const clip = ids.get(id)
  if (clip?.name !== 'clipPath') return undefined
  const units =
    clip.attrs.clipPathUnits === 'objectBoundingBox'
      ? multiply(translate(inside.x, inside.y), scale(inside.width, inside.height))
      : m
  const at = multiply(units, parseTransform(clip.attrs.transform ?? ''))
  // Each shape is joined to those before it, so the clip's shapes are counted before any is.
  context.count('clip shapes', clip.children.filter((c) => typeof c !== 'string').length)
  let combined: Path | null = null
  let rectangles = 0
  let parts = 0
  const add = (element: XmlElement, style: Style, mm: Matrix) => {
    spend()
    const own = outline(context, element, { ...style, 'fill-rule': style['clip-rule'] ?? 'nonzero' })
    if (!own) return
    parts++
    if (element.name === 'rect' && !element.attrs.rx && !element.attrs.ry && mm[1] === 0 && mm[2] === 0) rectangles++
    const drawn = transformed(ck, own, mm)
    own.delete()
    if (!combined) {
      combined = drawn
      return
    }
    const joined: Path | null = ck.Path.MakeFromOp(combined, drawn, ck.PathOp.Union)
    combined.delete()
    drawn.delete()
    combined = joined
  }
  const clipStyle = styleOf(clip, {}, rules)
  for (const child of clip.children) {
    if (typeof child === 'string') continue
    const style = styleOf(child, clipStyle, rules)
    if (style.display === 'none') continue
    const mm = multiply(at, parseTransform(child.attrs.transform ?? ''))
    if (SHAPES.has(child.name)) add(child, style, mm)
    else if (child.name === 'use') {
      const target = ids.get((child.attrs.href ?? '').replace(/^#/, ''))
      if (target && SHAPES.has(target.name)) {
        add(
          target,
          styleOf(target, style, rules),
          multiply(mm, translate(length(child.attrs.x), length(child.attrs.y))),
        )
      }
    }
  }
  const path = combined as Path | null
  if (!path) return null
  const box = boundsOf(path)
  const holds =
    box.x <= inside.x + 0.01 &&
    box.y <= inside.y + 0.01 &&
    box.x + box.width >= inside.x + inside.width - 0.01 &&
    box.y + box.height >= inside.y + inside.height - 0.01
  if (parts === 1 && rectangles === 1 && holds && !reaches) {
    path.delete()
    return undefined
  }
  const placed = new ck.PathBuilder(path).offset(-box.x, -box.y).detachAndDelete()
  path.delete()
  const d = pathData(placed)
  placed.delete()
  if (!d) return null
  const maskId = newId()
  nodes[maskId] = {
    type: 'graphic',
    parentId: 'root',
    link: maskId,
    index: 'a0',
    name: nameOf(clip, 'Clip'),
    props: {
      ...box,
      mask: 'alpha',
      shape: { kind: 'path', d, drawnIn: { width: box.width, height: box.height } },
      fills: [{ type: 'solid', color: '#000000FF' }],
    },
  }
  return { id: maskId, box }
}
