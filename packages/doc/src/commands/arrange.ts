// Commands that move layers to another parent or another place among their siblings, copy them, and place a
// tree of them.
import { z } from 'zod'

import {
  type Design,
  FrameId,
  frameIdOf,
  type Layer as LayerT,
  LayerTree,
  LinkId,
  NodeId,
  PageId,
} from '@dazbee/schema'

import { ancestorsOf, descendants, isInside } from '../children.ts'
import { flowPlaces } from '../flow.ts'
import { centreOf, normalAngle, turn } from '../geometry.ts'
import { isMask } from '../masks.ts'
import { type BoxPlan, DrawnBoxes, keepEmptied, writeDrawn } from './box-plan.ts'
import { missingLayer, parentProblem } from './checks.ts'
import { defineCommand, strict } from './define.ts'
import { copyLayers, drawnOrder, layerSlots, linkMaker, orderIndexes, type Slot, writeOrder } from './tree.ts'

/** What `design.place` returns with `withIds`: the top layers' new ids, bottom to top, and each placed layer's new id by its key in the tree. */
export interface PlacedTree {
  roots: string[]
  ids: Record<string, string>
}

/**
 * Moves a layer to another parent, or another place among its siblings, in its own frame or another
 * frame of its page. The layer and what it holds are first stored at their `drawn` boxes, what each
 * holds moved along, so a layer leaving a flow stays where the flow drew it; the containers around it
 * in `holders` turn it about where they are drawn, and a laid-out box it leaves with nothing in its
 * flow keeps the size `holders` says it is drawn at. Into another frame, it stays where it is drawn
 * on the page, and each layer of it takes, in tree order, the link id `links` names for it, else its
 * own, unless the new frame holds that one or a layer of it took it first; then it takes a new one.
 */
export const nodeMove = defineCommand({
  name: 'node.move',
  description:
    'Moves a layer into another group, box or frame of its page, or to another place among its siblings, keeping where it is drawn on the page; into another frame, each layer of it whose link id that frame holds takes a new one. It refuses a missing layer, a parent that cannot hold it, another page, a layer locked in place going to another frame, a place inside the layer itself, and a sibling to go before that is not under the new parent.',
  step: 'move',
  input: z.strictObject({
    id: NodeId.describe('The layer to move.'),
    parentId: z.union([FrameId, NodeId]).describe('The frame, or the group or box, of its page it goes into.'),
    before: NodeId.optional().describe('The sibling it goes just below; on top of the others when left out.'),
    drawn: DrawnBoxes.optional().describe(
      'Where the layer and what it holds are drawn, so a layer leaving a row, column or grid stays where it is.',
    ),
    holders: DrawnBoxes.optional().describe(
      'Where the groups and boxes around it are drawn, so it keeps its place and a laid-out box it leaves empty keeps its size.',
    ),
    links: z
      .record(NodeId, LinkId)
      .optional()
      .describe(
        'Into another frame, the link id each layer of it takes there instead of its own, where that frame holds none; read only for the layer and what it holds.',
      ),
  }),
  check: ({ design }, { id, parentId, before }) => {
    const node = design.nodes[id]
    if (!node) return missingLayer(design, [id])
    const problem = parentProblem(design, parentId, node.type)
    if (problem) return problem
    const [from, to] = [frameIdOf(design, id), frameIdOf(design, parentId)]
    if (from !== to && design.frames[from ?? '']?.pageId !== design.frames[to ?? '']?.pageId)
      return `can't move "${id}" to another page`
    if (from !== to && node.lock?.move) return `"${id}" is locked in place`
    if (isInside(design, parentId, id)) return `can't move "${id}" inside itself`
    if (before === id) return `can't place "${id}" before itself`
    if (before && design.nodes[before]?.parentId !== parentId) return `"${before}" is not under "${parentId}"`
    return undefined
  },
  apply: ({ w, design, newId }, { id, parentId, before, drawn = {}, holders = {}, links = {} }) => {
    const siblings = layerSlots(design, parentId).filter(([sibling]) => sibling !== id)
    const at = before ? siblings.findIndex(([sibling]) => sibling === before) : siblings.length
    const order = siblings.toSpliced(at, 0, [id, design.nodes[id]?.index ?? null])
    // The layer and what it holds go where they are drawn; the containers around it turn it there.
    const leaving = design.nodes[id]?.parentId === parentId ? new Set<string>() : new Set([id])
    const [fromFrame, toFrame] = [frameIdOf(design, id) as string, frameIdOf(design, parentId) as string]
    const [from, to] = [design.frames[fromFrame], design.frames[toFrame]]
    // Into another frame, the step from the old frame's space to the new one's.
    const shift = fromFrame !== toFrame && from && to ? { x: from.x - to.x, y: from.y - to.y } : null
    writeDrawn(w, design, [id], drawn, (plan) => {
      keepDrawnPlace(plan, design, id, parentId, id in drawn, holders, shift)
      keepEmptied(plan, design, leaving, holders)
    })
    if (shift) {
      const held = new Set(descendants(design, toFrame).map((layer) => design.nodes[layer]?.link ?? ''))
      const linkOf = linkMaker({ held }, newId)
      for (const layer of [id, ...descendants(design, id)]) {
        const own = design.nodes[layer]?.link as string
        const link = linkOf(links[layer] ?? own)
        if (link !== own) w.set('layer', layer, 'link', link)
      }
    }
    w.set('layer', id, 'parentId', parentId)
    writeOrder(w, 'layer', order, new Set([id]))
  },
})

/**
 * Brings layers forward or back one step, or to the front or back, among their siblings. Only the
 * moved layers get new indexes, and siblings that shared one, so a concurrent change to the others
 * merges.
 */
export const nodeReorder = defineCommand({
  name: 'node.reorder',
  description:
    'Brings layers forward or back one step among their siblings, or to the front or the back. It refuses a missing layer.',
  step: 'reorder',
  input: z.strictObject({
    ids: NodeId.array().min(1).describe('The layers to bring forward or send back.'),
    to: z
      .enum(['forward', 'backward', 'front', 'back'])
      .describe('One step forward or backward, or all the way to the front or back.'),
  }),
  check: ({ design }, { ids }) => missingLayer(design, ids),
  apply: ({ w, design }, { ids, to }) => {
    const moving = new Set(ids)
    const parents = new Set(ids.map((id) => design.nodes[id]?.parentId as string))
    for (const parentId of parents) {
      const before = new Map(layerSlots(design, parentId))
      const after = restack([...before.keys()], moving, to)
      writeOrder(
        w,
        'layer',
        after.map((id) => [id, before.get(id) as string]),
        moving,
      )
    }
  },
})

/**
 * Copies layers, each right above its original, stored where `places` says or where its original
 * is. A mask in a group copied without that group has its masking turned off, so a Mask group
 * stays one. Returns the copies' ids, one for each layer of `ids` no other one of them holds, in
 * their order. Callers pair each layer of a copy with its original by this contract: a copy holds
 * what its original holds, in its original's order, all the way down.
 */
export const nodeDuplicate = defineCommand({
  name: 'node.duplicate',
  description:
    'Copies layers, each copy right above its original and stored where places says, else where its original is, and returns the copies’ ids. A mask in a group copied without that group has its masking turned off. It refuses a missing layer.',
  step: 'duplicate',
  input: z.strictObject({
    ids: NodeId.array().min(1).describe('The layers to copy; a layer inside another one listed comes along with it.'),
    places: z
      .record(
        NodeId,
        z.strictObject({
          x: z.number().describe('The left edge to store, in pixels.'),
          y: z.number().describe('The top edge to store, in pixels.'),
        }),
      )
      .optional()
      .describe(
        'Where each copy is stored, by its original’s id, for the layers copied and those inside them: its x and y. One left out is stored where its original is.',
      ),
  }),
  check: ({ design }, { ids }) => missingLayer(design, ids),
  apply: (ctx, { ids, places = {} }) => {
    const { w, design } = ctx
    // A layer inside another one being copied comes along with it.
    const roots = ids.filter((id) => !ids.some((other) => other !== id && isInside(design, id, other)))
    /** The index of each copy under a parent, once every copy that goes there is in its place. */
    const indexesUnder = new Map<string, (id: string) => string>()
    const copies = copyLayers(
      ctx,
      roots,
      (root, ids) => {
        const { parentId } = design.nodes[root] as LayerT
        let indexOf = indexesUnder.get(parentId)
        if (!indexOf) {
          const copied = (id: string): Slot[] => (roots.includes(id) ? [[ids.get(id) as string, null]] : [])
          const order = layerSlots(design, parentId).flatMap((slot) => [slot, ...copied(slot[0])])
          indexOf = writeOrder(w, 'layer', order, new Set(roots.map((id) => ids.get(id) as string)))
          indexesUnder.set(parentId, indexOf)
        }
        return { parentId, index: indexOf(ids.get(root) as string) }
      },
      { places },
    )
    // A mask in a group copied without that group has its masking turned off, so a Mask group stays one.
    for (const root of roots) {
      const node = design.nodes[root] as LayerT
      if (isMask(node) && design.nodes[node.parentId]?.type === 'group') w.unsetProp(copies.get(root) as string, 'mask')
    }
    return roots.map((root) => copies.get(root) as string)
  },
})

/**
 * Places a tree of layers, such as the clipboard's, in a frame or container (#49): every layer gets
 * a fresh id and, unless `keepLinksFrom` keeps its own, a new link id; the roots go on top in their
 * order, and everything moves by `dx`, `dy`. Placing the same tree twice gives two copies. Returns
 * the new roots' ids, bottom to top; with `withIds`, those and each placed layer's new id by its key.
 */
export const designPlace = defineCommand({
  name: 'design.place',
  description:
    'Places a tree of layers, such as copied ones, on top of what a frame or a group or box holds, every layer with a new id, and returns the list of the ids of the tree’s top layers; with withIds, it returns { roots, ids }, roots that list and ids each placed layer’s new id by its id in the tree. It refuses a parent that does not exist or cannot hold the tree’s top layers.',
  step: 'place',
  input: z.strictObject({
    parentId: z.union([FrameId, NodeId]).describe('The frame, or the group or box, the layers go into, on top.'),
    tree: strict(LayerTree).describe('The layers to place: each by its old id, and the ids of the top ones in order.'),
    dx: z.number().default(0).describe('How far right to move every placed layer, in pixels.'),
    dy: z.number().default(0).describe('How far down to move every placed layer, in pixels.'),
    /**
     * The page the tree was copied from. Into a frame of that page, each layer, in the tree's order,
     * keeps its link id where the frame holds no layer with it and no layer placed before it kept
     * it, so it is a linked copy; the rest, and every layer placed on another page, get new ones.
     */
    keepLinksFrom: PageId.optional().describe(
      'The page the layers were copied from: placed in a frame of that page, a layer stays linked to its original where it can.',
    ),
    withIds: z
      .literal(true)
      .optional()
      .describe(
        'Returns { roots, ids } instead of the list: roots the top layers’ new ids, ids each placed layer’s new id by its id in the tree.',
      ),
  }),
  check: ({ design }, { parentId, tree }) =>
    tree.roots.map((root) => parentProblem(design, parentId, tree.nodes[root]?.type ?? '')).find(Boolean),
  apply: ({ w, design, newId }, { parentId, tree, dx, dy, keepLinksFrom, withIds }): string[] | PlacedTree => {
    const frameId = frameIdOf(design, parentId)
    const keeps =
      frameId !== undefined && keepLinksFrom !== undefined && design.frames[frameId]?.pageId === keepLinksFrom
    const linkOf = linkMaker(
      keeps ? { held: new Set(descendants(design, frameId).map((id) => design.nodes[id]?.link ?? '')) } : 'new',
      newId,
    )
    const ids = new Map(Object.keys(tree.nodes).map((id) => [id, newId()]))
    const fresh = (old: string) => ids.get(old) as string
    const tops = tree.roots.map((root): Slot => [fresh(root), null])
    const topIndex = writeOrder(w, 'layer', [...layerSlots(design, parentId), ...tops], new Set(tops.map(([id]) => id)))
    /** The tree's layers under each of its layers, in the order they are drawn, with indexes of their own. */
    const inside = new Map<string, Slot[]>()
    for (const [old, node] of Object.entries(tree.nodes)) {
      if (!tree.roots.includes(old))
        inside.set(node.parentId, [...(inside.get(node.parentId) ?? []), [old, node.index]])
    }
    const indexOf = new Map<string, string>()
    for (const slots of inside.values()) {
      const changes = orderIndexes(drawnOrder(slots))
      for (const [old, index] of slots) indexOf.set(old, changes.get(old) ?? (index as string))
    }
    for (const [old, node] of Object.entries(tree.nodes)) {
      const where = tree.roots.includes(old)
        ? { parentId, index: topIndex(fresh(old)) }
        : { parentId: fresh(node.parentId), index: indexOf.get(old) as string }
      const props = { ...node.props, x: node.props.x + dx, y: node.props.y + dy }
      w.create('layer', fresh(old), { ...node, ...where, link: linkOf(node.link), props } as LayerT)
    }
    const roots = tree.roots.map(fresh)
    return withIds ? { roots, ids: Object.fromEntries(ids) } : roots
  },
})

/** The top layers' new ids `design.place` returned, with `withIds` or without. */
export function placedRoots(placed: string[] | PlacedTree): string[] {
  return Array.isArray(placed) ? placed : placed.roots
}

/**
 * Plans a layer to stay where it is drawn as it moves under `parentId`: each layer it sits in turns
 * what it holds around its own centre, as drawn (`around`) or stored, so the layer takes the turns it
 * leaves and gives back the ones it enters, and what it holds moves with it. `placed` says the plan
 * already holds where a flow it leaves draws it. Into another frame, `shift` carries it from the old
 * frame's space into the new one's, between the turns it leaves and those it enters.
 */
function keepDrawnPlace(
  plan: BoxPlan,
  design: Design,
  id: string,
  parentId: string,
  placed: boolean,
  around: DrawnBoxes,
  shift: { x: number; y: number } | null,
) {
  const node = design.nodes[id]
  if (!node || node.parentId === parentId) return
  // A flow it enters places it again: there is nothing to keep but its frame's space. One it leaves
  // drew it where the plan says, if the caller said where; its stored box is stale.
  if (flowPlaces(design, parentId, node) || (flowPlaces(design, node.parentId, node) && !placed)) {
    if (shift) moveAll(plan, design, id, shift)
    return
  }
  const container = (up: string) => ({ ...plan.get(up), ...around[up] })
  const was = plan.get(id)
  const from = centreOf(was)
  let drawn = from
  let turned = 0
  for (const up of ancestorsOf(design, node.parentId)) {
    const outer = container(up)
    drawn = turn(drawn, centreOf(outer), outer.rotation)
    turned += outer.rotation
  }
  if (shift) drawn = { x: drawn.x + shift.x, y: drawn.y + shift.y }
  for (const up of [...ancestorsOf(design, parentId)].reverse()) {
    const outer = container(up)
    drawn = turn(drawn, centreOf(outer), -outer.rotation)
    turned -= outer.rotation
  }
  const dx = drawn.x - from.x
  const dy = drawn.y - from.y
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9 && normalAngle(turned) === 0) return
  plan.set(id, { x: was.x + dx, y: was.y + dy, rotation: normalAngle(was.rotation + turned) })
  for (const inner of descendants(design, id)) {
    const at = plan.get(inner)
    plan.set(inner, { x: at.x + dx, y: at.y + dy })
  }
}

/** Plans a layer and every layer it holds moved by a step. */
function moveAll(plan: BoxPlan, design: Design, id: string, step: { x: number; y: number }) {
  for (const layer of [id, ...descendants(design, id)]) {
    const at = plan.get(layer)
    plan.set(layer, { x: at.x + step.x, y: at.y + step.y })
  }
}

/** Each sibling list after a z-order change, as ids bottom to top. */
function restack(order: string[], moving: Set<string>, to: 'forward' | 'backward' | 'front' | 'back') {
  if (to === 'front') return [...order.filter((id) => !moving.has(id)), ...order.filter((id) => moving.has(id))]
  if (to === 'back') return [...order.filter((id) => moving.has(id)), ...order.filter((id) => !moving.has(id))]
  const next = [...order]
  // One step past the nearest sibling that isn't moving; a moving block keeps its own order.
  const up = to === 'forward'
  for (let i = up ? next.length - 2 : 1; up ? i >= 0 : i < next.length; i += up ? -1 : 1) {
    const id = next[i] as string
    const j = up ? i + 1 : i - 1
    if (!moving.has(id) || moving.has(next[j] as string)) continue
    next[i] = next[j] as string
    next[j] = id
  }
  return next
}
