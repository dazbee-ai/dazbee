// Auto layout, solved while a scene is built so the editor, exports and the server lay out
// alike. A box with `layout` places the children in its flow, in a row, a column or a grid,
// sizing each one fixed, hugging what it holds or filling the room left, held between its least
// and most; a row or column that wraps runs onto more lines. Children marked `absolute` stay
// where they are put, moved with their box when a flow moves it. A turned child takes the room of
// its turned bounds and is drawn at its own size in their middle. Boxes stay in frame space and
// unturned: a turned box turns its laid-out children about its centre when drawn, as it does any child.
import {
  type Axis,
  boundsOf,
  fillStretches,
  flows,
  flowWraps,
  isLaidOutBox,
  type LaidOutBox,
  type MeasureText,
  sizingOf,
} from '@dazbee/doc'
import { type AutoLayout, gridColumns, type LayerLimits } from '@dazbee/schema'

import { breakLines, clampTo, rangeOf, shareRoom, spreadLines } from './layout-lines.ts'
import type { SceneLayer } from './scene.ts'

export type { MeasureText }

type Size = { width: number; height: number }
type Rect = Size & { x: number; y: number }

interface Item {
  layer: SceneLayer
  /** The room it takes in the flow: its size, or its turned bounds when it is turned. */
  width: number
  height: number
  /** A turned layer's own size, drawn in the middle of the room it takes. */
  own?: Size
  /** A laid-out box that fits its content on a side, as solved at its size here; none for other layers. */
  laid: SceneLayer | undefined
  fillMain: boolean
  fillCross: boolean
  /** Its least and most width and height. */
  limits: LayerLimits
  /** A text that fits its words, held to another width by its limits: drawn wrapped at that width. */
  wrapped: boolean
}

/** How a curved text sizes in a flow: to its curve both ways. */
const CURVED_SIZING = { width: 'hug', height: 'hug' } as const

/** Layers solved before, by the layer as built and the measure used, so an unchanged box is laid out once. */
const solved = new WeakMap<SceneLayer, { measure: MeasureText | undefined; layer: SceneLayer }>()
/** Each laid-out grid's cells, by the box as laid out. */
const cellsOf = new WeakMap<SceneLayer, readonly Rect[]>()

/** Lays out every auto layout box among `layers` and inside them; layers with none inside come back as they were. */
export function applyLayout(layers: SceneLayer[], measure?: MeasureText): SceneLayer[] {
  let changed = false
  const next = layers.map((layer) => {
    const out = layoutOne(layer, measure)
    if (out !== layer) changed = true
    return out
  })
  return changed ? next : layers
}

/**
 * The cells of a grid box as laid out, row after row, on to the end of its last row: each one cell
 * wide and as tall as its row, where the layer in it is placed. None for any other layer.
 */
export function gridCells(box: SceneLayer): readonly Rect[] {
  return cellsOf.get(box) ?? []
}

function layoutOne(layer: SceneLayer, measure?: MeasureText): SceneLayer {
  const before = solved.get(layer)
  if (before && before.measure === measure) return before.layer
  let out: SceneLayer
  if (isLaidOutBox(layer)) {
    out = solveBox(layer, {}, measure)
  } else {
    const children = applyLayout(layer.children, measure)
    out = children === layer.children ? layer : ({ ...layer, children } as SceneLayer)
  }
  solved.set(layer, { measure, layer: out })
  return out
}

/**
 * Lays out an auto layout box: its own size where `given` says (its parent's flow decided it)
 * or where it hugs, then each child's size and place. Returns the box with its new size and
 * children; absolute children are laid out where they are put. A grid is a row broken into lines
 * of `columns` layers, each slot one equal cell wide, its lines `gap` apart.
 */
function solveBox(outer: LaidOutBox<SceneLayer>, given: Partial<Size>, measure?: MeasureText): SceneLayer {
  const { layout } = outer.props
  const { padding: pad } = layout
  const grid = layout.direction === 'grid'
  const row = layout.direction !== 'column'
  const own = sizingOf(outer)
  const ownLimits = limitsOf(outer)
  // A side that fits its content keeps its stored size while nothing is in its flow.
  const flow = outer.children.filter(flows)
  const hugW = given.width === undefined && own.width === 'hug' && flow.length > 0
  const hugH = given.height === undefined && own.height === 'hug' && flow.length > 0
  // A side the box keeps is held to its limits from the start; one that fits, once it is fitted.
  let width = clampTo(given.width ?? outer.props.width, rangeOf(ownLimits, 'width'))
  let height = clampTo(given.height ?? outer.props.height, rangeOf(ownLimits, 'height'))
  const hugMain = row ? hugW : hugH
  const hugCross = row ? hugH : hugW
  const wraps = flowWraps(layout, hugMain)
  const lineGap = layout.lineGap ?? layout.gap
  const mainAxis: Axis = row ? 'width' : 'height'
  const crossAxis: Axis = row ? 'height' : 'width'
  const padMain = row ? pad.left + pad.right : pad.top + pad.bottom
  const padCross = row ? pad.top + pad.bottom : pad.left + pad.right
  const innerMain = () => (row ? width : height) - padMain
  const innerCross = () => (row ? height : width) - padCross
  const columns = grid ? gridColumns(layout) : 0
  // Known before any layer is sized: a grid's cell where the grid keeps its width, and the room
  // across a row or column that doesn't fit its content across.
  const fixedCell = grid && !hugMain ? Math.max(0, (innerMain() - layout.gap * (columns - 1)) / columns) : undefined
  const crossKnown = !grid && !hugCross
  /** The sides a layer fills whose size is known before any layer is sized. */
  const knownFill = (fillMain: boolean, fillCross: boolean): Partial<Size> => {
    const main = fillMain ? fixedCell : undefined
    const cross = fillCross && crossKnown ? Math.max(0, innerCross()) : undefined
    const [w, h] = row ? [main, cross] : [cross, main]
    return { ...(w === undefined ? {} : { width: w }), ...(h === undefined ? {} : { height: h }) }
  }

  // Each child's size, held to its limits: widths first, since text that hugs its height needs its
  // width. Fill along the flow shares the room a box that doesn't fit its content leaves, or in a
  // grid takes its cell; fill across takes the room across. A layer turned by other than a half
  // turn keeps its own size, since its turn leaves no one width or height to fill. A curved text
  // takes the size of its curve, whatever its sizing and limits.
  const items: Item[] = flow.map((layer) => {
    const curved = layer.type === 'text' && layer.props.curve !== undefined
    const s = curved ? CURVED_SIZING : sizingOf(layer)
    const limits = curved ? {} : limitsOf(layer)
    // Turned by other than a half turn, its turned bounds differ from its own box.
    const turned = layer.props.rotation % 180 !== 0
    const fits = { width: hugW, height: hugH }
    const fillW = s.width === 'fill' && fillStretches(layout.direction, fits, layer.props.rotation, 'width')
    const fillH = s.height === 'fill' && fillStretches(layout.direction, fits, layer.props.rotation, 'height')
    const hugs = s.width === 'hug' || s.height === 'hug'
    // A laid-out box that fits its content on a side is solved for it, at the sides it fills where they are known.
    const laid =
      hugs && isLaidOutBox(layer)
        ? solveBox(layer, knownFill(row ? fillW : fillH, row ? fillH : fillW), measure)
        : undefined
    const natural = () => {
      if (layer.type === 'text') return textSize(layer, s.width === 'hug' ? null : layer.props.width, measure)
      const { width, height } = (laid ?? layer).props
      return { width, height }
    }
    const n = hugs ? natural() : null
    const w = clampTo(s.width === 'hug' && n ? n.width : layer.props.width, rangeOf(limits, 'width'))
    let h = s.height === 'hug' && n ? n.height : layer.props.height
    // Text that fits its words at another width, set or held by its limits, wraps at that width.
    const wrapped = layer.type === 'text' && s.width === 'hug' && n !== null && w !== n.width
    if (layer.type === 'text' && s.height === 'hug' && (s.width !== 'hug' || wrapped))
      h = textSize(layer, w, measure).height
    h = clampTo(h, rangeOf(limits, 'height'))
    const fills = { fillMain: row ? fillW : fillH, fillCross: row ? fillH : fillW }
    if (!turned) return { layer, width: w, height: h, laid, ...fills, limits, wrapped }
    const bounds = boundsOf([{ x: 0, y: 0, width: w, height: h, rotation: layer.props.rotation }])
    const own = { width: w, height: h }
    return { layer, width: bounds.width, height: bounds.height, own, laid, ...fills, limits, wrapped }
  })
  const mainOf = (i: Item) => (row ? i.width : i.height)
  const crossOf = (i: Item) => (row ? i.height : i.width)
  // A filled side is held to the layer's limits.
  const setMain = (i: Item, v: number) => {
    const held = clampTo(v, rangeOf(i.limits, mainAxis))
    if (row) i.width = held
    else i.height = held
  }
  const setCross = (i: Item, v: number) => {
    const held = clampTo(v, rangeOf(i.limits, crossAxis))
    if (row) i.height = held
    else i.width = held
  }
  // A layer that fits its content on one side is measured again once the side it fills is set:
  // text that hugs its height at the width it fills, a laid-out box solved at the sides it fills.
  const refit = (i: Item) => {
    const filled = { width: row ? i.fillMain : i.fillCross, height: row ? i.fillCross : i.fillMain }
    if (i.layer.type === 'text') {
      if (filled.width && sizingOf(i.layer).height === 'hug')
        i.height = clampTo(textSize(i.layer, i.width, measure).height, rangeOf(i.limits, 'height'))
      return
    }
    if (!i.laid || !isLaidOutBox(i.layer)) return
    const given: Partial<Size> = {}
    if (filled.width && i.width !== i.laid.props.width) given.width = i.width
    if (filled.height && i.height !== i.laid.props.height) given.height = i.height
    if (given.width === undefined && given.height === undefined) return
    i.laid = solveBox(i.layer, given, measure)
    i.width = i.laid.props.width
    i.height = i.laid.props.height
  }

  // Lines: one, a grid's rows of `columns` layers each, or, wrapping, as many as the room along
  // takes, a layer that fills along counting as its least length.
  const lines: Item[][] = []
  if (grid) for (let at = 0; at < items.length; at += columns) lines.push(items.slice(at, at + columns))
  else if (wraps)
    lines.push(
      ...breakLines(items, innerMain(), layout.gap, (i) =>
        i.fillMain ? (rangeOf(i.limits, mainAxis)[0] ?? 0) : mainOf(i),
      ),
    )
  else lines.push(items)

  // A grid's cells share the width inside its paddings equally; fitting its width, each is as wide
  // as its widest layer that doesn't fill, or, when every layer fills, its widest layer.
  const unfilled = items.filter((i) => !i.fillMain)
  const cell = !grid ? 0 : (fixedCell ?? Math.max(0, ...(unfilled.length > 0 ? unfilled : items).map(mainOf)))

  // Fill across the flow takes the line's room: the box's, or, in a grid's row or a box that fits
  // its content, the tallest layer in the line that doesn't fill; a line of only such layers keeps
  // their own sizes. It comes before the share along the flow where the room is known up front,
  // and in a column, whose widths come first since a height that fits what it holds needs its
  // width; in a row or grid that fits its height, the room waits for the widths the share gives.
  const lineCross = (line: Item[]) => {
    const set = line.filter((i) => !i.fillCross)
    return Math.max(0, ...(set.length > 0 ? set : line).map(crossOf))
  }
  const fillAcross = (line: Item[], room: number) => {
    for (const i of line) {
      if (!i.fillCross) continue
      setCross(i, Math.max(0, room))
      refit(i)
    }
  }
  const fillAcrossLines = () => {
    if (crossKnown) fillAcross(items, innerCross())
    else for (const line of lines) if (line.some((i) => !i.fillCross)) fillAcross(line, lineCross(line))
  }
  // Wrapped lines fill across once each line's room is known, after the share along.
  const acrossFirst = !wraps && (crossKnown || !row)
  if (acrossFirst) fillAcrossLines()

  // Fill along the flow shares what each line leaves, by turns where limits hold some, or in a
  // grid takes its cell; in a grid that fits its width with every layer filling, they keep their own sizes.
  const fills = items.filter((i) => i.fillMain)
  if (grid && (unfilled.length > 0 || !hugMain)) for (const i of fills) setMain(i, cell)
  else if (!grid)
    for (const line of lines) {
      const filling = line.filter((i) => i.fillMain)
      if (filling.length === 0) continue
      const fixed = line.reduce((sum, i) => sum + (i.fillMain ? 0 : mainOf(i)), 0)
      const free = innerMain() - fixed - layout.gap * (line.length - 1)
      const shares = shareRoom(
        free,
        filling.map((i) => rangeOf(i.limits, mainAxis)),
      )
      filling.forEach((i, k) => setMain(i, shares[k] ?? 0))
    }
  for (const i of fills) refit(i)
  if (!acrossFirst && !wraps) fillAcrossLines()

  const lineMain = (line: Item[]) =>
    line.reduce((sum, i) => sum + mainOf(i), 0) + layout.gap * Math.max(0, line.length - 1)
  const fitMain = () => {
    const main = (grid ? cell * columns + layout.gap * (columns - 1) : lineMain(items)) + padMain
    if (row) width = clampTo(main, rangeOf(ownLimits, 'width'))
    else height = clampTo(main, rangeOf(ownLimits, 'height'))
  }
  if (hugMain) fitMain()
  if (hugCross) {
    const cross =
      lines.reduce((sum, line) => sum + lineCross(line), 0) + lineGap * Math.max(0, lines.length - 1) + padCross
    if (row) height = cross
    else width = cross
  }
  const fitted = innerCross()
  width = clampTo(width, rangeOf(ownLimits, 'width'))
  height = clampTo(height, rangeOf(ownLimits, 'height'))
  // One line across a box its limits held to another size than it fits: what fills across takes
  // that, and the box fits its length along the flow to them again.
  if (!grid && !wraps && hugCross && innerCross() !== fitted) {
    fillAcross(items, innerCross())
    if (hugMain) fitMain()
  }

  // Each line's room across: a grid row's tallest layer; one line, the box's; wrapped lines, each
  // its tallest, taking the room left as the layout says, then filled across.
  let rooms = lines.map((line) => (grid ? lineCross(line) : innerCross()))
  let between = lineGap
  let crossOffset = 0
  if (wraps) {
    if (lines.length > 1) {
      const spread = spreadLines(
        lines.map(lineCross),
        innerCross(),
        lineGap,
        layout,
        items.every((i) => i.fillCross),
      )
      rooms = spread.rooms
      between = spread.gap
      crossOffset = spread.offset
    }
    lines.forEach((line, k) => fillAcross(line, rooms[k] ?? 0))
  }

  // Places: along the flow by justify, across it by align, line after line. In a grid, justify
  // places a layer within its cell and align within its row, and nothing spreads out.
  const placed = new Map<SceneLayer, SceneLayer>()
  const cells: Rect[] = []
  const startMain = row ? outer.props.x + pad.left : outer.props.y + pad.top
  let crossAt = (row ? outer.props.y + pad.top : outer.props.x + pad.left) + crossOffset
  const lineUp = (spare: number, to: AutoLayout['justify']) => (to === 'center' ? spare / 2 : to === 'end' ? spare : 0)
  for (const [k, line] of lines.entries()) {
    const free = innerMain() - lineMain(line)
    let gap = layout.gap
    let at = startMain + (grid ? 0 : lineUp(free, layout.justify))
    if (!grid && layout.justify === 'space-between' && line.length > 1) gap = layout.gap + free / (line.length - 1)
    const room = rooms[k] ?? 0
    // A grid's line holds a cell in each column, a layer in it or not; a grid runs in rows.
    const lineCells = Array.from({ length: columns }, (_, k) => ({
      x: startMain + k * (cell + layout.gap),
      y: crossAt,
      width: cell,
      height: room,
    }))
    cells.push(...lineCells)
    line.forEach((i, k) => {
      const main = grid ? (lineCells[k] as Rect).x + lineUp(cell - mainOf(i), layout.justify) : at
      const across = crossAt + lineUp(room - crossOf(i), layout.align)
      const box = row
        ? { x: main, y: across, width: i.width, height: i.height }
        : { x: across, y: main, width: i.width, height: i.height }
      const to = i.own ? middleOf(box, i.own) : box
      // A box already solved at its size here is moved there as it is.
      const { laid } = i
      const shown = i.wrapped ? wrappedText(i.layer) : i.layer
      placed.set(i.layer, laid ? shift(laid, to.x - laid.props.x, to.y - laid.props.y) : place(shown, to, measure))
      at += mainOf(i) + gap
    })
    crossAt += room + between
  }

  // Absolute children stay where they are put, laid out on their own like any layer.
  const children = outer.children.map((c) => placed.get(c) ?? layoutOne(c, measure))
  const laid = { ...outer, props: { ...outer.props, width, height }, children } as SceneLayer
  if (grid) cellsOf.set(laid, cells)
  return laid
}

/** A layer's least and most width and height; a group or boolean, which takes its box from what it holds, has none. */
function limitsOf(layer: SceneLayer): LayerLimits {
  return layer.props as LayerLimits
}

/**
 * A text that fits its words, drawn so it wraps at the width it is placed at: as Auto height, or in a
 * fixed box where it keeps its height.
 */
function wrappedText(layer: SceneLayer): SceneLayer {
  const boxMode = sizingOf(layer).height === 'hug' ? 'autoHeight' : 'fixed'
  return { ...layer, props: { ...layer.props, boxMode } } as SceneLayer
}

/** A text layer's size where it hugs: natural, or at the width it was given. */
function textSize(layer: Extract<SceneLayer, { type: 'text' }>, width: number | null, measure?: MeasureText): Size {
  if (!measure) return { width: width ?? layer.props.width, height: layer.props.height }
  return measure(layer.props, width)
}

/** A size in the middle of a rect. */
function middleOf(box: Rect, size: Size): Rect {
  return { x: box.x + (box.width - size.width) / 2, y: box.y + (box.height - size.height) / 2, ...size }
}

/**
 * A layer placed by its box at a rect, moved there with what it holds: an auto layout box laid out
 * at that size, its absolute layers moved with it, text at its width, and a group or plain box at
 * its own size (only auto layout reaches inside).
 */
function place(layer: SceneLayer, box: Rect, measure?: MeasureText): SceneLayer {
  const dx = box.x - layer.props.x
  const dy = box.y - layer.props.y
  if (isLaidOutBox(layer)) {
    // The flow places the rest of what it holds.
    const children = layer.children.map((c) => (flows(c) ? c : shift(c, dx, dy)))
    const at = { ...layer, props: { ...layer.props, x: box.x, y: box.y }, children }
    return solveBox(at, { width: box.width, height: box.height }, measure)
  }
  const moved = shift(layer, dx, dy)
  const resized =
    layer.type === 'group'
      ? moved
      : ({ ...moved, props: { ...moved.props, width: box.width, height: box.height } } as SceneLayer)
  return { ...resized, children: applyLayout(resized.children, measure) } as SceneLayer
}

/** Moves a layer and everything inside it, a grid's cells too. */
function shift(layer: SceneLayer, dx: number, dy: number): SceneLayer {
  if (dx === 0 && dy === 0) return layer
  const moved = {
    ...layer,
    props: { ...layer.props, x: layer.props.x + dx, y: layer.props.y + dy },
    children: layer.children.map((c) => shift(c, dx, dy)),
  } as SceneLayer
  const cells = cellsOf.get(layer)
  if (cells)
    cellsOf.set(
      moved,
      cells.map((c) => ({ ...c, x: c.x + dx, y: c.y + dy })),
    )
  return moved
}
