// A hand edit ends a binding (ADR-0018): after a command writes a layer, each binding whose value
// the command changed comes off, in the same transaction, so it is part of the command's step. A
// bound value is compared as the list of bindable properties reads it and its kind compares it, a
// colour whole, alpha included, and a text's look whole: an edit that leaves it as it was keeps the
// binding.
import { BINDABLE_PROPERTIES, BindableProperty, VALUE_KINDS } from '@dazbee/schema'

import type { StoreWrite } from '../store.ts'

/** What a command's `apply` is given and returns. */
type Apply<C extends { w: StoreWrite }, I, R> = (ctx: C, input: I) => R

/**
 * `apply`, ending each binding of a layer it wrote whose bound value it changed. A layer it created
 * had no value before, so it keeps the bindings it is made with; one it deleted has none to end.
 */
export function endingEditedBindings<C extends { w: StoreWrite }, I, R>(apply: Apply<C, I, R>): Apply<C, I, R> {
  return (ctx, input) => {
    const { w } = ctx
    const noted = notingWrites(w)
    const result = apply({ ...ctx, w: noted.w }, input)
    for (const [id, before] of noted.before) {
      if (noted.created.has(id) || !w.has('layer', id)) continue
      for (const property of BindableProperty.options) {
        const { prop, read, kind } = BINDABLE_PROPERTIES[property]
        if (!before.has(prop) || w.binding(id, property) === undefined) continue
        if (!VALUE_KINDS[kind].same(read({ [prop]: before.get(prop) }), read({ [prop]: w.prop(id, prop) })))
          w.unsetBinding(id, property)
      }
    }
    return result
  }
}

/**
 * A store write that writes through `w`, noting for each layer each prop's value before its first
 * write, and the layers it created.
 */
function notingWrites(w: StoreWrite) {
  /** Each written layer's props, by prop, as they were before the first write of each. */
  const before = new Map<string, Map<string, unknown>>()
  /** The layers created through it. */
  const created = new Set<string>()

  function note(id: string, path: string) {
    if (!w.has('layer', id)) return
    let props = before.get(id)
    if (!props) before.set(id, (props = new Map()))
    if (!props.has(path)) props.set(path, w.prop(id, path))
  }

  // Every member passes through to `w`; only the writes it notes do more.
  const noting: StoreWrite = {
    has: (part, id) => w.has(part, id),
    prop: (id, path) => w.prop(id, path),
    binding: (id, property) => w.binding(id, property),
    isLive: (id) => w.isLive(id),
    create: (part, id, record) => {
      if (part === 'layer') created.add(id)
      w.create(part, id, record)
    },
    set: (part, id, key, value) => w.set(part, id, key, value),
    unset: (part, id, key) => w.unset(part, id, key),
    setProp: (id, path, value) => {
      note(id, path)
      w.setProp(id, path, value)
    },
    unsetProp: (id, path) => {
      note(id, path)
      w.unsetProp(id, path)
    },
    setBinding: (id, property, ref) => w.setBinding(id, property, ref),
    unsetBinding: (id, property) => w.unsetBinding(id, property),
    remove: (part, id) => w.remove(part, id),
    editText: (id, op) => w.editText(id, op),
    setMeta: (key, value) => w.setMeta(key, value),
    markRestore: (mark) => w.markRestore(mark),
  }
  return { w: noting, before, created }
}
