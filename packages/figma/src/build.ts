// One frame's layers as the import makes them: the keys they are given, the layers themselves
// before they are placed, the Figma paints each takes, and the report they add to.

import { generateKeyBetween } from 'fractional-indexing'
import type { z } from 'zod'

import type { CanvasKit } from '@dazbee/canvaskit'
import type { Box, Point } from '@dazbee/doc'
import { Layer, NodeId } from '@dazbee/schema'
import type { Matrix } from '@dazbee/svg'

import { field, type FigmaNode, list } from './read.ts'
import type { Reporter } from './report.ts'

/** A layer as the import writes it, before the schema fills in its defaults. */
export type LayerInput = z.input<typeof Layer>

/** A layer made from a node: its key and its unturned box in its frame's pixels. */
export interface Piece {
  id: string
  box: Box
}

/**
 * The Figma paints a layer takes, for the paints step to map: its fills as the file lists them, the
 * node whose strokes it draws live, and where its gradients' handles go.
 */
export interface LayerPaints {
  fills: readonly unknown[]
  strokes?: FigmaNode
  /** Takes a point of the Figma node's unit box, where its gradients' handles are, to the layer's unit box. */
  handles: Matrix
}

/** One frame's layers as they are made, with the keys they are given and the report they add to. */
export interface LayerBuild {
  ck: CanvasKit
  nodes: Record<string, LayerInput>
  /** Each key made from a Figma node, mapped to the node's Figma id. */
  figmaIds: Record<string, string>
  /** The Figma paints each layer takes, by its key. */
  paints: Record<string, LayerPaints>
  /** How far each container's layers move so that its turn draws them where they are, by its key. */
  shifts: Map<string, Point>
  report: Reporter
  /** A key no layer of the frame has, and no Figma id under it will be given. */
  fresh(): string
  /** The key reserved for a node: its Figma id in the link's form, or a fresh one. */
  keyOf(node: FigmaNode): string
}

/** Figma node types that become a frame at the top of a page, and a box inside a frame. */
export const FRAME_TYPES: ReadonlySet<string> = new Set(['FRAME', 'COMPONENT', 'COMPONENT_SET', 'INSTANCE'])
/** Of those, the ones that stop being components when they come in. */
export const COMPONENT_TYPES: ReadonlySet<string> = new Set(['COMPONENT', 'COMPONENT_SET', 'INSTANCE'])

/** The parent a frame's top layers name until they are placed. */
export const ROOT = 'root'
const MAX_NAME = 200

/**
 * A build for one frame's layers. Every node under `within` that has a Figma id, which in the
 * link's form (`:` as `-`, `;` as `_`) is a key no node before it took, keeps that key; the rest
 * are given fresh ones, `n1`, `n2` and so on, skipping the reserved.
 */
export function newLayerBuild(within: readonly FigmaNode[], report: Reporter, ck: CanvasKit): LayerBuild {
  const reserved = new Map<FigmaNode, string>()
  // `root` is the parent the tree's top layers name, so no layer is keyed by it.
  const taken = new Set<string>([ROOT])
  // In the file's order, so the first of two nodes with one key keeps it.
  const stack = [...within].reverse()
  for (let n = stack.pop(); n; n = stack.pop()) {
    const key = n.id.replaceAll(':', '-').replaceAll(';', '_')
    if (n.id && !taken.has(key) && NodeId.safeParse(key).success) {
      reserved.set(n, key)
      taken.add(key)
    }
    for (let i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i] as FigmaNode)
  }
  let next = 0
  const fresh = () => {
    let key = `n${++next}`
    while (taken.has(key)) key = `n${++next}`
    taken.add(key)
    return key
  }
  return {
    ck,
    nodes: {},
    figmaIds: {},
    paints: {},
    shifts: new Map(),
    report,
    fresh,
    keyOf: (n) => reserved.get(n) ?? fresh(),
  }
}

/** Puts `pieces` inside `parentId`, bottom to top. */
export function adopt(build: LayerBuild, parentId: string, pieces: readonly Piece[]) {
  let index: string | null = null
  for (const piece of pieces) {
    index = generateKeyBetween(index, null)
    Object.assign(build.nodes[piece.id] as object, { parentId, index })
  }
}

/**
 * A layer of `type` named `name` with `props`, a mask when `from` masks the layers in front of it,
 * placed nowhere until it is adopted.
 */
export function layer<T extends LayerInput['type']>(
  id: string,
  type: T,
  name: string,
  props: object,
  from?: FigmaNode,
): LayerInput {
  const mask =
    from && field(from.fields, 'isMask') === true
      ? field(from.fields, 'maskType') === 'LUMINANCE'
        ? 'luminance'
        : 'alpha'
      : undefined
  return {
    type,
    parentId: ROOT,
    link: id,
    index: 'a0',
    name: name.slice(0, MAX_NAME),
    props: { ...props, ...(mask ? { mask } : {}) },
  } as LayerInput
}

/** Makes the layer of `type` a node becomes, keyed by the node unless `id` is given, and maps its key to the node. */
export function made(
  build: LayerBuild,
  n: FigmaNode,
  type: LayerInput['type'],
  props: object,
  id = build.keyOf(n),
): string {
  build.nodes[id] = layer(id, type, n.name, props, n)
  build.figmaIds[id] = n.id
  return id
}

/** The paints of a layer that draws a node's own fills and strokes, its gradients' handles taken by `handles`. */
export function paintsOf(n: FigmaNode, handles: Matrix): LayerPaints {
  return { fills: list(field(n.fields, 'fills')), strokes: n, handles }
}

export function unreadable(build: LayerBuild, n: FigmaNode): null {
  build.report.add('unreadable-layers', n)
  return null
}
