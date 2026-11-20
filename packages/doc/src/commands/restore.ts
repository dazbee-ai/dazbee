// Restoring a version: the working design's pages, frames and layers become a version's, its meta
// kept, as one step marked with the version it restores (the tab sends the mark with its change set).
import { z } from 'zod'

import { type BindableProperty, Design, RestoreMark, type Target, type VariableRef } from '@dazbee/schema'

import { sameValue } from '../same-value.ts'
import type { Part, StoreWrite } from '../store.ts'
import { BINDINGS_KEY, targetKey, targetsOf, valueAt } from '../sync/changes.ts'
import { type CommandContext, defineCommand, strict } from './define.ts'

/** A record as the command compares it: its keys and their values. */
type Fields = Readonly<Record<string, unknown>>

/** Each part's records in a design, by the part. */
const RECORDS = { page: 'pages', frame: 'frames', layer: 'nodes' } as const

/**
 * Makes every page, frame and layer of the design equal the input design's: what the input lacks
 * is removed, what it adds is created under its own id, and each value that differs is set. The
 * design's meta (its id and name) is never written. The step is marked with `mark`.
 */
export const designRestore = defineCommand({
  name: 'design.restore',
  description:
    'Replaces every page, frame and layer of the design with a version’s, keeping the design’s id and name, as one step that carries the version’s mark to the other tabs. It refuses a version that gives an id the design holds as another part, or a layer of another type.',
  step: 'restore',
  input: z.strictObject({
    design: strict(Design).describe('The version’s design, whole: its meta is not written.'),
    mark: RestoreMark.describe('The version restored: its id, kind, name and when it was taken.'),
  }),
  check: (ctx, { design: version }) => idsProblem(ctx, version),
  apply: ({ w, design: now }, { design: version, mark }) => {
    w.markRestore(mark)
    for (const [id, page] of Object.entries(version.pages)) writeRecord(w, 'page', id, now.pages[id], page)
    for (const [id, frame] of Object.entries(version.frames)) writeRecord(w, 'frame', id, now.frames[id], frame)
    for (const id of holdersFirst(version)) writeRecord(w, 'layer', id, now.nodes[id], version.nodes[id] as Fields)
    // Removed once everything the version keeps sits where the version has it, so nothing kept goes with them.
    for (const id of Object.keys(now.nodes)) if (!Object.hasOwn(version.nodes, id)) w.remove('layer', id)
    for (const id of Object.keys(now.frames)) if (!Object.hasOwn(version.frames, id)) w.remove('frame', id)
    for (const id of Object.keys(now.pages)) if (!Object.hasOwn(version.pages, id)) w.remove('page', id)
  },
})

/**
 * Why the version can't be written over the design, if it can't: it gives an id the design holds
 * as another part (C27), or a layer of another type than the design's under its id (set once, C28).
 */
function idsProblem({ w, design }: CommandContext, version: Design): string | undefined {
  for (const part of ['page', 'frame', 'layer'] as const) {
    const others = (['page', 'frame', 'layer'] as const).filter((other) => other !== part)
    for (const id of Object.keys(version[RECORDS[part]])) {
      const held = others.find((other) => w.has(other, id))
      if (held) return `the version's ${part} "${id}" is a ${held} of the design`
    }
  }
  for (const [id, layer] of Object.entries(version.nodes)) {
    const type = design.nodes[id]?.type
    if (type && type !== layer.type) return `the version's layer "${id}" is a ${layer.type}, the design's a ${type}`
  }
  return undefined
}

/**
 * Writes a page, a frame or a layer as `next` has it: created when the design has none (one the
 * read left out is replaced), else each value that differs set or taken out, as the sync core
 * names its values (a text's text and runs are one; each binding is one). A layer's type is set only
 * when it is made.
 */
function writeRecord(w: StoreWrite, part: Part, id: string, was: Fields | undefined, next: Fields) {
  if (!was) {
    if (w.has(part, id)) w.remove(part, id)
    w.create(part, id, next as never)
    return
  }
  const targets = new Map<string, Target>()
  for (const t of [...targetsOf(part, id, was), ...targetsOf(part, id, next)]) targets.set(targetKey(t), t)
  for (const t of targets.values()) {
    const to = valueAt(next, t)
    if (t.key === 'type' || sameValue(valueAt(was, t), to)) continue
    if (t.key === BINDINGS_KEY && t.prop !== undefined) {
      const property = t.prop as BindableProperty
      if (to === undefined) w.unsetBinding(id, property)
      else w.setBinding(id, property, to as VariableRef)
    } else if (t.prop !== undefined) {
      if (to === undefined) w.unsetProp(id, t.prop)
      else w.setProp(id, t.prop, to)
    } else if (to === undefined) w.unset(part, id, t.key)
    else w.set(part, id, t.key, to)
  }
}

/** The version's layers, each after the layer holding it, so a layer is created under its holder. */
function holdersFirst(design: Design): string[] {
  const depth = new Map<string, number>()
  const depthOf = (id: string): number => {
    const known = depth.get(id)
    if (known !== undefined) return known
    const parent = design.nodes[id]?.parentId ?? ''
    const found = Object.hasOwn(design.nodes, parent) ? depthOf(parent) + 1 : 0
    depth.set(id, found)
    return found
  }
  return Object.keys(design.nodes).sort((a, b) => depthOf(a) - depthOf(b))
}
