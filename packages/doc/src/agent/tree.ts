// A frame's layers as compact JSON, for an agent to read: each layer's id, name, type, whether it
// shows and its text cut short, with the props the caller names added, and long lists of layers
// cut to fit a size budget.
import { type Design, LAYER_PROPS } from '@dazbee/schema'

import { childrenOf } from '../children.ts'

/** What `compactTree` adds and how large it may grow. */
export interface TreeOptions {
  /**
   * Props to add to each layer that has them, by name, such as `x`, `fills` or `role`: a text's
   * `text` is then given in full. Each must be one some layer type has.
   */
  fields?: readonly string[]
  /**
   * The most bytes the tree's JSON, written without spaces, may take (`DEFAULT_TREE_BYTES` unless
   * given): past it, the lists of layers longer than a cap keep their first ones only.
   */
  maxBytes?: number
}

/**
 * One layer in a compact tree, or the frame at its root: the layers it holds, back to front, and
 * how many of them were cut from the end of that list to fit the budget, when any were.
 */
export interface TreeLayer {
  id: string
  name: string
  type: string
  visible?: boolean
  text?: string
  children?: TreeLayer[]
  leftOut?: number
  [field: string]: unknown
}

/** How many bytes a compact tree takes unless the caller says. */
export const DEFAULT_TREE_BYTES = 100_000
/** How many characters (Unicode code points) of a layer's text the outline keeps. */
export const OUTLINE_TEXT_LENGTH = 120

/** The props `fields` may name: those of every layer type, and what a layer has beside them. */
const FIELDS = [
  ...new Set([...Object.values(LAYER_PROPS).flatMap((props) => Object.keys(props.shape)), 'role', 'lock', 'bindings']),
].sort()

/**
 * The frame `frameId` and the layers it holds as compact JSON (see `TreeLayer`): the frame's id,
 * name, width and height, and each layer's id, name, type, whether it shows, and a text's first
 * 120 characters, followed by `...` where there are more. It throws on a frame the design does
 * not have and on a field no layer type has.
 */
export function compactTree(design: Design, frameId: string, options: TreeOptions = {}): TreeLayer {
  const frame = design.frames[frameId]
  if (!frame) throw new Error(`no frame "${frameId}" in the design`)
  const fields = options.fields ?? []
  const unknown = fields.find((field) => !FIELDS.includes(field))
  if (unknown !== undefined) throw new Error(`no layer has "${unknown}": the fields are ${FIELDS.join(', ')}`)
  const maxBytes = options.maxBytes ?? DEFAULT_TREE_BYTES
  const build = (cap: number): TreeLayer => ({
    id: frameId,
    name: frame.name,
    type: 'frame',
    width: frame.width,
    height: frame.height,
    ...childrenAt(design, frameId, fields, cap),
  })
  const whole = build(Infinity)
  if (bytesOf(whole) <= maxBytes) return whole
  // The largest cap on every list of layers at which the tree fits, found by bisection: the size
  // only grows with the cap. Below the longest list's length, at least one list is cut.
  let [low, high] = [0, longestList(design, frameId) - 1]
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (bytesOf(build(mid)) <= maxBytes) low = mid
    else high = mid - 1
  }
  return build(low)
}

/**
 * The `children` of the frame or layer `parentId`, its first `cap` layers, with `leftOut` saying
 * how many more it holds, when any; nothing when it holds none.
 */
function childrenAt(design: Design, parentId: string, fields: readonly string[], cap: number) {
  const children = childrenOf(design, parentId)
  if (children.length === 0) return {}
  const shown = children.slice(0, cap).map(([id, layer]): TreeLayer => {
    const props = layer.props as Record<string, unknown>
    const own: Record<string, unknown> = { ...props, role: layer.role, lock: layer.lock, bindings: layer.bindings }
    const added = Object.fromEntries(fields.filter((field) => own[field] !== undefined).map((f) => [f, own[f]]))
    return {
      id,
      name: layer.name,
      type: layer.type,
      visible: layer.props.visible,
      ...(layer.type === 'text' && { text: cut(layer.props.text) }),
      ...added,
      ...childrenAt(design, id, fields, cap),
    }
  })
  const leftOut = children.length - shown.length
  return leftOut > 0 ? { children: shown, leftOut } : { children: shown }
}

/** A text's first characters, as the outline gives it. */
function cut(text: string) {
  const characters = Array.from(text)
  return characters.length > OUTLINE_TEXT_LENGTH ? `${characters.slice(0, OUTLINE_TEXT_LENGTH).join('')}...` : text
}

function bytesOf(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

/** How many layers the longest list under the frame or layer `parentId` holds. */
function longestList(design: Design, parentId: string): number {
  const children = childrenOf(design, parentId)
  return Math.max(children.length, ...children.map(([id]) => longestList(design, id)))
}
