import { z } from 'zod'

import { type Design, NodeId } from '@dazbee/schema'

import { descendants, isInside } from '../children.ts'
import { flowOf, laidOutBox } from '../flow.ts'
import { type Box, round } from '../geometry.ts'
import type { StoreWrite } from '../store.ts'
import { depthOf } from './tree.ts'

/** Where a layer is, and whether it shows. */
export type Placed = Box & { visible: boolean }
/** A plan of layers' boxes and visibility, as `boxPlan` makes it. */
export type BoxPlan = ReturnType<typeof boxPlan>
type Path = keyof Placed

/**
 * Layers' boxes as they are drawn, by layer, in the space they are stored in. A command's `drawn`
 * gives where to store layers so they are drawn where the caller sees them now; its `holders` gives
 * the containers around them, which it only reads. Inside an auto layout box the flow places them,
 * and a box that fits its layers is sized as it is drawn, not by its stored box; only the renderer
 * lays the flow out, so the caller works them out.
 */
export const DrawnBoxes = z.record(
  NodeId,
  z.strictObject({
    x: z.number().describe('The left edge as drawn, in pixels.'),
    y: z.number().describe('The top edge as drawn, in pixels.'),
    width: z.number().min(0).describe('The width as drawn, in pixels.'),
    height: z.number().min(0).describe('The height as drawn, in pixels.'),
  }),
)
export type DrawnBoxes = z.infer<typeof DrawnBoxes>

/** Whether two values are alike as the document keeps them: numbers to their hundredths. */
export const same = (a: unknown, b: unknown) =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 0.005 : a === b

/**
 * Layers' boxes and visibility as a command plans them: read from the design, changed in the
 * plan, written once, rounded, only where they changed. Commands that keep layers where they are
 * on screen (move, group, ungroup, hug) plan from what the layers show now.
 */
export function boxPlan(design: Design) {
  const want = new Map<string, Partial<Placed>>()

  /** What the layer's props hold now. */
  const stored = (id: string): Placed => {
    const p = (design.nodes[id]?.props ?? {}) as Partial<Placed>
    return {
      x: p.x ?? 0,
      y: p.y ?? 0,
      width: p.width ?? 0,
      height: p.height ?? 0,
      rotation: p.rotation ?? 0,
      visible: p.visible ?? true,
    }
  }

  /** A layer with what has been planned for it so far over its props. */
  function get(id: string): Placed {
    return { ...stored(id), ...want.get(id) }
  }

  /** Plans a change, its numbers rounded as the document keeps them. */
  function set(id: string, patch: Partial<Placed>) {
    const rounded = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, typeof v === 'number' ? round(v) : v]))
    want.set(id, { ...want.get(id), ...rounded })
  }

  /** Writes each planned value that differs from the layer's props. */
  function write(w: Pick<StoreWrite, 'setProp'>) {
    for (const [id, patch] of want) {
      const was = stored(id)
      for (const [path, value] of Object.entries(patch)) if (!same(was[path as Path], value)) w.setProp(id, path, value)
    }
  }

  return { get, set, write }
}

/**
 * Plans each layer at the box it is drawn in, as an auto layout box places and sizes it, and what it
 * holds moved by as much. Outer layers go first, so a layer inside one that has a drawn box of its
 * own ends at it.
 */
export function placeDrawn(plan: BoxPlan, design: Design, drawn: DrawnBoxes) {
  const outerFirst = Object.entries(drawn)
    .filter(([child]) => design.nodes[child])
    .sort(([a], [b]) => depthOf(design, a) - depthOf(design, b))
  for (const [child, box] of outerFirst) {
    const was = plan.get(child)
    plan.set(child, box)
    for (const inner of descendants(design, child)) {
      const at = plan.get(inner)
      plan.set(inner, { x: at.x + box.x - was.x, y: at.y + box.y - was.y })
    }
  }
}

/**
 * Stores the layers a command acts on, `roots` and what they hold, at their `drawn` boxes, what each
 * holds moved along, with whatever `more` plans from there, in one write; gives the plan for what
 * reads it after. Drawn boxes of other layers are left as they are stored.
 */
export function writeDrawn(
  w: StoreWrite,
  design: Design,
  roots: readonly string[],
  drawn: DrawnBoxes,
  more?: (plan: BoxPlan) => void,
): BoxPlan {
  const plan = boxPlan(design)
  const own = Object.entries(drawn).filter(([layer]) => roots.some((root) => isInside(design, layer, root)))
  placeDrawn(plan, design, Object.fromEntries(own))
  more?.(plan)
  plan.write(w)
  return plan
}

/**
 * Plans each laid-out box that `leaving` leave with nothing in its flow at the size `holders` says
 * it is drawn: a side that fits its content keeps its stored size while nothing is in its flow, and
 * that size is stale.
 */
export function keepEmptied(plan: BoxPlan, design: Design, leaving: ReadonlySet<string>, holders: DrawnBoxes) {
  const boxes = new Set([...leaving].map((id) => design.nodes[id]?.parentId ?? ''))
  for (const box of boxes) {
    const size = holders[box]
    if (!size || !laidOutBox(design, box)) continue
    const flow = flowOf(design, box)
    if (flow.length > 0 && flow.every(([id]) => leaving.has(id)))
      plan.set(box, { width: size.width, height: size.height })
  }
}
