// Commands that change layers where they are, in their own frame: create, edit, delete, rename, lock,
// bind and mask.
import { z } from 'zod'

import {
  BINDABLE_PROPERTIES,
  BindableProperty,
  canBind,
  fitsProperty,
  FrameId,
  type Layer as LayerT,
  LAYER_PROPS,
  LayerLock,
  LOCK_FLAGS,
  NodeId,
  parseLayer,
  UnplacedLayer,
  valueKindOf,
  VariableRef,
} from '@dazbee/schema'

import { childrenOf, descendants } from '../children.ts'
import { flows } from '../flow.ts'
import { sameValue } from '../same-value.ts'
import { droppedIssue } from '../sync/checks.ts'
import { boxPlan, DrawnBoxes, keepEmptied, writeDrawn } from './box-plan.ts'
import { idProblem, lockFor, lockProblem, missingLayer, parentProblem } from './checks.ts'
import { defineCommand } from './define.ts'
import { keepDrawnIn } from './paths.ts'
import { layerSlots, writeOrder } from './tree.ts'

/** A layer with nothing locked: the schema's own defaults. */
const UNLOCKED = LayerLock.parse({})
/** What each lock flag keeps a layer from, as `node.lock` says it. */
const LOCK_FLAGS_SAY: Record<(typeof LOCK_FLAGS)[number], string> = {
  move: 'Locks its place and its constraints: true to lock, false to unlock.',
  resize: 'Locks its size, turn and flip: true to lock, false to unlock.',
  content: 'Locks its text: true to lock, false to unlock.',
  style:
    'Locks its look, every property but its place, size, turn, flip, text and whether it shows: true to lock, false to unlock.',
  delete: 'Locks it against deleting: true to lock, false to unlock.',
}

/**
 * A layer to add, without where it goes: validated as a layer of its type without its place, so
 * `apply` gets its props as the schema takes them, defaults filled.
 */
const LayerInput = z
  .strictObject({
    type: z.enum(Object.keys(LAYER_PROPS) as [keyof typeof LAYER_PROPS]),
    name: z.string(),
    role: z.string().optional(),
    props: z.record(z.string(), z.unknown()),
  })
  .transform((layer, ctx) => {
    const parsed = UnplacedLayer.safeParse(layer)
    if (parsed.success) return parsed.data
    for (const { path, message } of parsed.error.issues) ctx.addIssue({ code: 'custom', path, message })
    return z.NEVER
  })

/** Adds a layer on top of what its frame or parent layer holds, with a link id of its own. Returns its id. */
export const nodeCreate = defineCommand({
  name: 'node.create',
  description:
    'Adds a new layer on top of what a frame or a group or box holds. It refuses an id already in use, a parent that does not exist, and a layer its parent cannot hold, such as a text inside a combined shape.',
  step: 'add',
  input: z.strictObject({
    id: NodeId.optional().describe('The new layer’s id; a fresh one is made when left out.'),
    parentId: z.union([FrameId, NodeId]).describe('The frame, or the group or box, the layer goes into, on top.'),
    layer: LayerInput.describe('The layer: its type, its name, an optional role, and its properties.'),
  }),
  check: (ctx, { id, parentId, layer }) => {
    const { design } = ctx
    const taken = idProblem(ctx, id)
    if (taken) return taken
    return parentProblem(design, parentId, layer.type)
  },
  apply: ({ w, design, newId }, { id = newId(), parentId, layer }) => {
    const indexOf = writeOrder(w, 'layer', [...layerSlots(design, parentId), [id, null]], new Set([id]))
    w.create('layer', id, { ...layer, parentId, link: newId(), index: indexOf(id) })
    return id
  },
})

/**
 * Sets properties of layers, those that change. Layers with `drawn` boxes are first stored where
 * they are drawn, what they hold moved along, so a patch that takes one out of a flow or fixes a
 * side that fitted or filled leaves it where it is; a laid-out box in `holders` that the patch
 * leaves with nothing in its flow keeps the size it is drawn at. Their linked copies in other
 * frames stay as they are.
 */
export const nodeUpdate = defineCommand({
  name: 'node.update',
  description:
    'Sets properties of layers, such as their place, size, turn or look, leaving the rest as they are. A change to the value of a property bound to a brand kit token (a fill’s colour, a text’s colour or font) ends that binding. It refuses a missing layer, a property its type does not have or a value it does not take, a property the layer’s lock keeps, and the text of a text layer, which text.edit changes.',
  step: 'edit',
  batchable: true,
  input: z.strictObject({
    ids: NodeId.array().min(1).describe('The layers to change.'),
    patch: z
      .record(z.string(), z.unknown())
      .describe('The properties to set, by name, with their new values; the same for every layer.'),
    drawn: DrawnBoxes.optional().describe(
      'Where the layers and what they hold are drawn, so a layer the change takes out of a row, column or grid stays where it is.',
    ),
    holders: DrawnBoxes.optional().describe(
      'Where the boxes around the layers are drawn, so a laid-out box the change leaves empty keeps its size.',
    ),
  }),
  check: ({ design }, { ids, patch }) => {
    // Only the patched layers are checked: nothing else changes (#29).
    for (const id of ids) {
      const node = design.nodes[id]
      if (!node) return missingLayer(design, [id])
      for (const path of Object.keys(patch)) {
        if (!Object.hasOwn(LAYER_PROPS[node.type].shape, path)) return `a ${node.type} has no property "${path}"`
        const locked = lockProblem(id, node, lockFor(path))
        if (locked) return locked
        if (node.type === 'text' && (path === 'text' || path === 'runs')) return 'change text with text.edit'
      }
      const patched = { ...node, props: { ...node.props, ...patch } }
      const layer = parseLayer(patched)
      if (!layer.success) return layer.errors.map((e) => `${id}.${e.replace(/^props\./, '')}`).join('; ')
      // A key the parse drops would be stored as sent, which the server refuses.
      const dropped = droppedIssue(patched, layer.layer)
      if (dropped) return `${id}: ${dropped}`
    }
    return undefined
  },
  apply: ({ w, design }, { ids, patch, drawn, holders }) => {
    if (drawn || holders) {
      const leaving = ids.filter((id) => {
        const node = design.nodes[id]
        return node && flows(node) && !flows({ props: { ...node.props, ...patch } as typeof node.props })
      })
      writeDrawn(w, design, ids, drawn ?? {}, (plan) => keepEmptied(plan, design, new Set(leaving), holders ?? {}))
    }
    for (const id of ids) {
      if ('width' in patch || 'height' in patch) keepDrawnIn(w, design, id)
      // A value the layer already has is left as it is, so a change to nothing writes nothing and adds no undo step.
      for (const [path, value] of Object.entries(patch))
        if (!sameValue(w.prop(id, path), value)) w.setProp(id, path, value)
    }
  },
})

/**
 * Deletes layers and everything under them. A laid-out box in `holders` that the delete leaves with
 * nothing in its flow keeps the size it is drawn at. Their linked copies in other frames stay.
 */
export const nodeDelete = defineCommand({
  name: 'node.delete',
  description:
    'Deletes layers and everything inside them; their linked copies in other frames stay. It refuses a missing layer, and one locked against deleting or holding a layer that is.',
  step: 'delete',
  input: z.strictObject({
    ids: NodeId.array().min(1).describe('The layers to delete.'),
    holders: DrawnBoxes.optional().describe(
      'Where the boxes around the layers are drawn, so a laid-out box the delete leaves empty keeps its size.',
    ),
  }),
  check: ({ design }, { ids }) => {
    for (const id of ids) {
      const node = design.nodes[id]
      if (!node) return missingLayer(design, [id])
      const locked = [id, ...descendants(design, id)]
        .map((inner) => lockProblem(inner, design.nodes[inner] as LayerT, 'delete'))
        .find(Boolean)
      if (locked) return locked
    }
    return undefined
  },
  apply: ({ w, design }, { ids, holders }) => {
    if (holders) {
      const plan = boxPlan(design)
      keepEmptied(plan, design, new Set(ids.filter((id) => design.nodes[id] && flows(design.nodes[id]))), holders)
      plan.write(w)
    }
    const doomed = new Set<string>()
    const take = (id: string) => {
      if (doomed.has(id)) return
      doomed.add(id)
      for (const [child] of childrenOf(design, id)) take(child)
    }
    for (const id of ids) take(id)
    // The store keeps a deleted layer: undo brings it back, and edits another tab makes to it
    // meanwhile land in it instead of being lost.
    for (const id of doomed) w.remove('layer', id)
  },
})

/** Renames a layer (#59). A name is how the layers panel shows it; it changes nothing drawn, so no lock stops it. */
export const nodeRename = defineCommand({
  name: 'node.rename',
  description:
    'Gives a layer a new name, as the layers panel shows it; nothing drawn changes, so a lock does not stop it. It refuses a missing layer and an empty name.',
  step: 'rename',
  batchable: true,
  input: z.strictObject({
    id: NodeId.describe('The layer to rename.'),
    name: z.string().trim().min(1).max(120).describe('The new name, 1 to 120 characters once trimmed.'),
  }),
  check: ({ design }, { id }) => missingLayer(design, [id]),
  apply: ({ w }, { id, name }) => {
    w.set('layer', id, 'name', name)
  },
})

/** Sets some of layers' lock flags, keeping the others; a layer with nothing locked loses the field. */
export const nodeLock = defineCommand({
  name: 'node.lock',
  description:
    'Locks or unlocks layers against moving, resizing and turning, text changes, style changes or deleting, one flag at a time, keeping the flags not given. It refuses a missing layer.',
  step: 'lock',
  // Unlock while it only turns flags off.
  stepOf: ({ lock }) => {
    const set = Object.values(lock)
    return set.includes(false) && !set.includes(true) ? 'unlock' : 'lock'
  },
  batchable: true,
  input: z.strictObject({
    ids: NodeId.array().min(1).describe('The layers to lock or unlock.'),
    lock: z
      .strictObject(
        Object.fromEntries(LOCK_FLAGS.map((flag) => [flag, z.boolean().optional().describe(LOCK_FLAGS_SAY[flag])])),
      )
      .describe('The flags to set, each true to lock or false to unlock; a flag left out keeps its value.'),
  }),
  check: ({ design }, { ids }) => missingLayer(design, ids),
  apply: ({ w, design }, { ids, lock }) => {
    for (const id of ids) {
      const was = design.nodes[id]?.lock ?? UNLOCKED
      const next = Object.fromEntries(LOCK_FLAGS.map((flag) => [flag, lock[flag] ?? was[flag]]))
      if (LOCK_FLAGS.some((flag) => next[flag])) w.set('layer', id, 'lock', next)
      else w.unset('layer', id, 'lock')
    }
  },
})

/**
 * Binds a property of layers to a brand kit token, or unbinds it with a null ref (#53). Binding
 * also stores the token's value as the property's own, so a design drawn without the brand kit (or
 * before it loads) still looks as it did; a fill binds the topmost solid fill, added if there is none.
 * Unbinding keeps the value the property has.
 */
export const nodeBind = defineCommand({
  name: 'node.bind',
  description:
    'Binds a fill, text colour or font of layers to a brand kit token, storing the token’s value too, or unbinds it, keeping the value it has. It refuses a missing layer, one whose type has no such property, one with its style locked, and a binding without a value that fits.',
  step: 'bind',
  batchable: true,
  setsBindings: true,
  input: z.strictObject({
    ids: NodeId.array().min(1).describe('The layers to bind or unbind.'),
    property: BindableProperty.describe('The property to bind.'),
    ref: VariableRef.nullable().describe('The brand kit token to bind to, or null to unbind.'),
    value: z
      .string()
      .optional()
      .describe('The token’s value now: a colour as #RRGGBBAA or a font family’s name. Needed to bind.'),
  }),
  check: ({ design }, { ids, property, ref, value }) => {
    if (ref && value === undefined) return 'binding needs the value the token has now'
    if (value !== undefined && !fitsProperty(property, value)) return valueKindOf(property).unfit
    for (const id of ids) {
      const node = design.nodes[id]
      if (!node) return missingLayer(design, [id])
      if (!canBind(node.type, property)) return `a ${node.type} has no ${property} to bind`
      const locked = lockProblem(id, node, 'style')
      if (locked) return locked
    }
    return undefined
  },
  apply: ({ w, design }, { ids, property, ref, value }) => {
    const entry = BINDABLE_PROPERTIES[property]
    for (const id of ids) {
      if (!design.nodes[id]) continue
      if (ref) w.setBinding(id, property, ref)
      else w.unsetBinding(id, property)
      if (value === undefined) continue
      // Read as written so far: a batch binding a layer twice keeps both.
      let props: Record<string, unknown> = { [entry.prop]: w.prop(id, entry.prop) }
      // A fill with no solid fill that shows to take the value gets one on top.
      if (property === 'fill' && entry.read(props) === undefined)
        props = { fills: [...((props.fills ?? []) as unknown[]), { type: 'solid', color: value }] }
      w.setProp(id, entry.prop, entry.write(props, value)[entry.prop])
    }
  },
})

/** Makes layers masks, or plain layers again (#48). Their linked copies in other frames stay as they are. */
export const nodeMask = defineCommand({
  name: 'node.mask',
  description:
    'Makes layers masks that show what is above them only where they are drawn, or plain layers again. It refuses a missing layer and one with its style locked.',
  step: 'mask',
  batchable: true,
  input: z.strictObject({
    ids: NodeId.array().min(1).describe('The layers to make masks or plain layers.'),
    mask: z
      .enum(['alpha', 'luminance'])
      .nullable()
      .describe('How the mask shows what is above it: by its transparency or its lightness; null for a plain layer.'),
  }),
  check: ({ design }, { ids }) => {
    for (const id of ids) {
      const node = design.nodes[id]
      if (!node) return missingLayer(design, [id])
      const locked = lockProblem(id, node, 'style')
      if (locked) return locked
    }
    return undefined
  },
  apply: ({ w }, { ids, mask }) => {
    for (const id of ids) {
      if (mask) w.setProp(id, 'mask', mask)
      else w.unsetProp(id, 'mask')
    }
  },
})
