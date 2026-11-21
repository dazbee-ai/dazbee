// A bundled icon as an SVG file whose every shape is filled with one colour, for the SVG reader to make layers of:
// a filled style's paths as the set draws them, and a style of lines outlined, each opacity's lines and dots joined
// into one filled shape, so every layer it becomes has a fill a colour or brand role can bind.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { CanvasKit, Path } from '@dazbee/canvaskit'
import { pathData } from '@dazbee/svg'

import { ICON_SETS, type IconSetId } from './sets.ts'

/** How one path is drawn where it differs from its style: a style of lines strokes and doesn't fill, any other fills. */
export interface PathHow {
  fill?: boolean
  stroke?: boolean
  opacity?: number
}

/** A path as the bundle keeps it: its SVG data, with how it differs from its style when it does. */
export type IconPath = string | [d: string, how: PathHow]

/** How an icon is drawn. */
export interface IconLook {
  /** The colour every shape is filled with, as #RRGGBBAA. */
  colour: string
  /** The side, in design pixels, it will be placed at: a style of lines is outlined finely enough for it. */
  size: number
}

/** A filled shape of the SVG file: its path data, its opacity, and whether its holes are by the even-odd rule. */
interface FilledShape {
  d: string
  opacity?: number
  evenOdd?: boolean
}

/** Each style's drawings once read, by `set/style`. */
const drawings = new Map<string, Readonly<Record<string, IconPath[]>>>()

/** The icon `name` of `set` in `style` as an SVG file of filled shapes; throws when the set doesn't draw it so. */
export function iconSvg(ck: CanvasKit, set: IconSetId, name: string, style: string, look: IconLook): string {
  const { size, lines } = ICON_SETS[set]
  const paths = drawingsOf(set, style)[name]
  if (!paths) throw new Error(`${set} has no ${style} drawing of ${name}`)
  const shapes: FilledShape[] =
    lines?.style === style
      ? outlined(ck, paths, { width: lines.width, precision: Math.max(1, look.size / size) })
      : paths.map((path) => (typeof path === 'string' ? { d: path } : { d: path[0], ...path[1] }))
  const body = shapes
    .map(({ d, opacity, evenOdd }) => {
      const extra = `${opacity === undefined || opacity === 1 ? '' : ` opacity="${opacity}"`}${evenOdd ? ' fill-rule="evenodd"' : ''}`
      return `<path d="${d}" fill="${look.colour}"${extra}/>`
    })
    .join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${body}</svg>`
}

/** A style's drawings, read from `sets/<set>/<style>.json` the first time. */
function drawingsOf(set: IconSetId, style: string): Readonly<Record<string, IconPath[]>> {
  const key = `${set}/${style}`
  const read = drawings.get(key)
  if (read) return read
  const file = join(import.meta.dirname, '..', 'sets', set, `${style}.json`)
  const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, IconPath[]>
  drawings.set(key, parsed)
  return parsed
}

/**
 * A style of lines' paths as filled shapes: each stroke outlined with round ends and corners, joined with the
 * filled paths of its opacity into one shape. When joining fails, the shapes stay apart, which draws the same.
 */
function outlined(ck: CanvasKit, paths: IconPath[], stroke: { width: number; precision: number }): FilledShape[] {
  const byOpacity = new Map<number, Path[]>()
  for (const path of paths) {
    const [d, how] = typeof path === 'string' ? [path, {}] : path
    const shape = filledShape(ck, d, { fill: how.fill ?? false, stroke: how.stroke ?? true }, stroke)
    if (!shape) continue
    const opacity = how.opacity ?? 1
    byOpacity.set(opacity, [...(byOpacity.get(opacity) ?? []), shape])
  }
  return [...byOpacity].flatMap(([opacity, shapes]) => {
    const joined = joinAll(ck, shapes)
    return joined.map((shape) => {
      const out = { d: pathData(shape), opacity, evenOdd: shape.getFillType() === ck.FillType.EvenOdd }
      shape.delete()
      return out
    })
  })
}

/** One path as the area it covers: filled, its stroke outlined, or both joined; null when it draws nothing. */
function filledShape(
  ck: CanvasKit,
  d: string,
  how: { fill: boolean; stroke: boolean },
  { width, precision }: { width: number; precision: number },
): Path | null {
  const path = ck.Path.MakeFromSVGString(d)
  if (!path) return null
  if (!how.stroke) return how.fill ? path : (path.delete(), null)
  const outline = path.makeStroked({ width, precision, cap: ck.StrokeCap.Round, join: ck.StrokeJoin.Round })
  if (!how.fill || !outline) {
    path.delete()
    return outline
  }
  return joinAll(ck, [path, outline])[0] ?? null
}

/** The shapes joined into one, freeing them; the shapes themselves when a join fails. */
function joinAll(ck: CanvasKit, shapes: Path[]): Path[] {
  const [first, ...rest] = shapes
  if (!first) return []
  let joined = first
  for (const [i, shape] of rest.entries()) {
    // Path.makeCombined is typed but not bound in this build; the factory is.
    const next: Path | null = ck.Path.MakeFromOp(joined, shape, ck.PathOp.Union)
    if (!next) return [joined, ...rest.slice(i)]
    joined.delete()
    shape.delete()
    joined = next
  }
  return [joined]
}
