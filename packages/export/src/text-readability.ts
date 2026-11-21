// Whether a text reads: its letters at least the readable size for its frame, and standing out from
// what is drawn around them, measured on the pixels the CPU surface draws (ADR-0005): the frame and
// every layer up to the text, the text included, so photos, gradients, the text's own outline and its
// shadows all count. A frame that is transparent there shows on white.
import type { CanvasKit } from '@dazbee/canvaskit'
import { cornersOf } from '@dazbee/doc'
import { drawScene, layerReach, layoutText, type Resources, type Scene, type SceneLayer } from '@dazbee/renderer'
import { readableTextSize, type Rect, shownScale, type TextProps, withRunStyle } from '@dazbee/schema'

import { drawnRegion, fitScale, inkOf, placed, type Turn } from './layer-ink.ts'
import type { Check, TextLayer } from './types.ts'

/** The size and weight of some of a text's letters. */
export interface Letters {
  size: number
  weight: number
}

/** WCAG 2's contrast ratios: for text, and for large text, from LARGE_TEXT_PX, or LARGE_BOLD_TEXT_PX when bold. */
const TEXT_CONTRAST = 4.5
const LARGE_TEXT_CONTRAST = 3
/** WCAG 2's large text, 18 point, and 14 point bold, in CSS pixels at 4/3 a point. */
const LARGE_TEXT_PX = 24
const LARGE_BOLD_TEXT_PX = (14 * 4) / 3

/** The size, in drawn pixels, the smallest letters are drawn at to be measured, up to MAX_MEASURE_SCALE. */
const MEASURE_SIZE = 32
const MAX_MEASURE_SCALE = 4
/** How far around its letters, as a share of the smallest size, a text is compared with what is drawn there. */
const RING_SHARE = 0.08
/** The share of a letter's coverage that counts as its inside, clear of its anti-aliased edge. */
const CORE_SHARE = 0.9
/** The share of a text's letters whose contrast is told of: the ratio a tenth of them are at or under. */
const LOW_SHARE = 0.1

/** Tells of a text whose letters, the smallest being `smallest`, are hard to read against what is drawn around them. */
export function contrastWarning(check: Check, layer: TextLayer, turns: readonly Turn[], smallest: Letters) {
  const { ck, resources, scene, frame } = check
  const shown = smallest.size / shownScale(frame.width, frame.height)
  const large = shown >= LARGE_TEXT_PX || (shown >= LARGE_BOLD_TEXT_PX && smallest.weight >= 700)
  const needed = large ? LARGE_TEXT_CONTRAST : TEXT_CONTRAST
  const ratio = lowContrast(ck, scene, layer, turns, resources, smallest.size)
  if (ratio !== undefined && ratio < needed)
    check.warn(
      layer.id,
      'lowContrast',
      `Text "${check.nameOf(layer.id)}" is hard to read against what is drawn behind it: its contrast is ${(Math.floor(ratio * 10) / 10).toFixed(1)}:1 where lowest, and text this size needs ${needed}:1.`,
    )
}

/** Tells of a text whose smallest letters, `smallest`, are under the readable size for its frame. */
export function tooSmallWarning(check: Check, layer: TextLayer, smallest: Letters) {
  const { width, height } = check.frame
  const readable = readableTextSize(width, height)
  if (smallest.size < readable)
    check.warn(
      layer.id,
      'tooSmall',
      `Text "${check.nameOf(layer.id)}" is set at ${tenths(smallest.size)} px, under the readable size of ${Math.ceil(readable)} px for a ${width} × ${height} frame.`,
    )
}

/** A text's smallest letters as it is laid out to draw, shrink to fit included. */
export function drawnSmallest({ ck, resources }: Check, layer: TextLayer): Letters | undefined {
  const laid = layoutText(ck, layer.props, resources)
  try {
    return smallestLetters(layer.props, laid.scale)
  } finally {
    laid.delete()
  }
}

/**
 * The size, as drawn with `scale` for shrink to fit, and weight of a text's smallest letters, the
 * thinnest of those; undefined for a text of only spaces.
 */
export function smallestLetters(props: TextProps, scale: number): Letters | undefined {
  const edges = [...new Set([0, props.text.length, ...props.runs.flatMap((r) => [r.start, r.end])])].sort(
    (a, b) => a - b,
  )
  let smallest: Letters | undefined
  for (let i = 0; i + 1 < edges.length; i++) {
    const start = edges[i] ?? 0
    const end = edges[i + 1] ?? start
    if (!/\S/u.test(props.text.slice(start, end))) continue
    let style = props.style
    for (const run of props.runs) if (run.start <= start && run.end >= end) style = withRunStyle(style, run.style)
    const piece = { size: style.fontSize * scale, weight: style.fontWeight }
    if (!smallest || piece.size < smallest.size || (piece.size === smallest.size && piece.weight < smallest.weight))
      smallest = piece
  }
  return smallest
}

/**
 * The contrast ratio, as WCAG 2 reckons it, a tenth of a text's letters are at or under against what is
 * drawn around them in `scene`, `smallest` being the size of its smallest letters; undefined where
 * nothing of it shows in the frame. The text is cut into squares as big as its smallest letters; in
 * each, the median colour of its letters' insides is compared with the median of a thin ring around
 * them, and each square counts as much as the letters in it.
 */
function lowContrast(
  ck: CanvasKit,
  scene: Scene,
  layer: TextLayer,
  turns: readonly Turn[],
  resources: Resources,
  smallest: number,
): number | undefined {
  const frame = { x: 0, y: 0, width: scene.width, height: scene.height }
  const wanted = Math.min(MAX_MEASURE_SCALE, Math.max(1, MEASURE_SIZE / smallest))
  const reach = placed(cornersOf({ ...layerReach(ck, layer, resources), rotation: 0 }), turns)
  const region = within(grown(reach, smallest * RING_SHARE + 2), frame)
  if (!region) return undefined
  const scale = fitScale(region, wanted)
  const ring = Math.max(2, Math.round(smallest * scale * RING_SHARE))
  const drawn = drawnRegion(ck, region, scale, (canvas) => {
    canvas.clipRect(ck.XYWHRect(0, 0, scene.width, scene.height), ck.ClipOp.Intersect, true)
    drawScene(ck, canvas, { ...scene, layers: upTo(scene.layers, layer.id) }, resources)
  })
  const letters = inkOf(ck, lettersOnly(layer), turns, resources, region, scale)
  const { most } = letters
  if (most === 0) return undefined
  const { width, height } = letters
  const touched = letters.alpha.map((a) => (a > 0 ? 1 : 0))
  const near = dilated(touched, width, height, ring)
  const side = Math.max(4, Math.round(smallest * scale))
  const across = Math.ceil(width / side)
  const cells = new Map<number, { inside: number[]; around: number[] }>()
  for (let row = 0; row < height; row++)
    for (let col = 0; col < width; col++) {
      const i = row * width + col
      const a = letters.alpha[i] ?? 0
      const inside = a >= most * CORE_SHARE
      const around = a === 0 && near[i] === 1
      if (!inside && !around) continue
      const key = Math.floor(row / side) * across + Math.floor(col / side)
      const cell = cells.get(key) ?? { inside: [], around: [] }
      cells.set(key, cell)
      ;(inside ? cell.inside : cell.around).push(luminance(drawn.pixels, i))
    }
  const ratios = [...cells.values()]
    .filter(({ inside, around }) => inside.length > 0 && around.length > 0)
    .map(({ inside, around }) => ({ ratio: contrast(median(inside), median(around)), weight: inside.length }))
    .sort((a, b) => a.ratio - b.ratio)
  const total = ratios.reduce((sum, { weight }) => sum + weight, 0)
  let seen = 0
  for (const { ratio, weight } of ratios) {
    seen += weight
    if (seen >= total * LOW_SHARE) return ratio
  }
  return undefined
}

/** A number to a tenth, as a sentence gives it. */
function tenths(value: number): number {
  return Math.round(value * 10) / 10
}

/** `box` grown by `by` on every side. */
function grown(box: Rect, by: number): Rect {
  return { x: box.x - by, y: box.y - by, width: box.width + 2 * by, height: box.height + 2 * by }
}

/** The part of `box` inside `frame`, or undefined when none is. */
function within(box: Rect, frame: Rect): Rect | undefined {
  const x = Math.max(box.x, frame.x)
  const y = Math.max(box.y, frame.y)
  const right = Math.min(box.x + box.width, frame.x + frame.width)
  const bottom = Math.min(box.y + box.height, frame.y + frame.height)
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined
}

/** The layers drawn up to layer `id`, it included: a container holding it keeps only its layers up to it. */
function upTo(layers: readonly SceneLayer[], id: string): SceneLayer[] {
  const kept: SceneLayer[] = []
  for (const layer of layers) {
    if (layer.id === id) return [...kept, layer]
    const inside = upTo(layer.children, id)
    if (inside.length > 0) return [...kept, { ...layer, children: inside } as SceneLayer]
    kept.push(layer)
  }
  return []
}

/** The text with only its letters' fill: no outline over or under them. */
function lettersOnly(layer: TextLayer): TextLayer {
  const { props } = layer
  const plain = <S extends { outline?: { width: number } | undefined }>(style: S): S =>
    style.outline ? { ...style, outline: { ...style.outline, width: 0 } } : style
  return {
    ...layer,
    props: {
      ...props,
      style: plain(props.style),
      runs: props.runs.map((run) => ({ ...run, style: plain(run.style) })),
    },
  }
}

/** Marks every pixel within `by` pixels, each way, of a marked one. */
function dilated(marks: Uint8Array, width: number, height: number, by: number): Uint8Array {
  const across = new Uint8Array(marks.length)
  for (let row = 0; row < height; row++) spread(marks, across, row * width, 1, width, by)
  const out = new Uint8Array(marks.length)
  for (let col = 0; col < width; col++) spread(across, out, col, width, height, by)
  return out
}

/** Marks in `to` each of `count` cells from `start`, `step` apart, that has a marked cell of `from` within `by` cells. */
function spread(from: Uint8Array, to: Uint8Array, start: number, step: number, count: number, by: number) {
  let behind = -Infinity
  for (let i = 0; i < count; i++) {
    if (from[start + i * step]) behind = i
    if (i - behind <= by) to[start + i * step] = 1
  }
  let ahead = Infinity
  for (let i = count - 1; i >= 0; i--) {
    if (from[start + i * step]) ahead = i
    if (ahead - i <= by) to[start + i * step] = 1
  }
}

/** A drawn pixel's relative luminance, as WCAG 2 reckons it, over white where it is transparent. */
function luminance(pixels: Uint8Array, i: number): number {
  const a = (pixels[i * 4 + 3] ?? 0) / 255
  const linear = (c: number) => {
    const v = (c / 255) * a + (1 - a)
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * linear(pixels[i * 4] ?? 0) +
    0.7152 * linear(pixels[i * 4 + 1] ?? 0) +
    0.0722 * linear(pixels[i * 4 + 2] ?? 0)
  )
}

/** The contrast ratio of two relative luminances, from 1 to 21. */
function contrast(a: number, b: number): number {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

/** The middle value; the mean of the two middle ones for an even count. */
function median(values: number[]): number {
  values.sort((a, b) => a - b)
  const middle = values.length >> 1
  return values.length % 2 === 1 ? (values[middle] ?? 0) : ((values[middle - 1] ?? 0) + (values[middle] ?? 0)) / 2
}
