// The records of a design as the sync core holds them, and the values a change reads and writes in
// them. The wire shapes of a change (`Part`, `Target`, `Change`) are the schema's; this is what they
// mean for a record.
import {
  BindableProperty,
  type Change,
  DesignMeta,
  type DesignRecords,
  Frame,
  type HeldPart,
  isRecord,
  Layer,
  LAYER_PROPS,
  Page,
  type Part,
  type Target,
} from '@dazbee/schema'

/** A record as the design holds it: plain JSON, never changed in place once it is read. */
export type Rec = Readonly<Record<string, unknown>>

/** `part/id`: names one record in sets and maps (ids hold no `/`). */
export type RecordKey = string

/** The meta's id: a design has one meta record. */
export const META_ID = 'meta'

/** The prop that holds a text layer's text and runs as one value. */
export const TEXT_PROP = 'text'

/** The key of a layer that holds its bindings, each a value of its own. */
export const BINDINGS_KEY = 'bindings'

/** Where each part's records sit in a design's records: a layer's in `nodes`. */
export const RECORDS_OF: Readonly<Record<HeldPart, Exclude<keyof DesignRecords, 'meta'>>> = {
  page: 'pages',
  frame: 'frames',
  layer: 'nodes',
}

/** The keys each part's record may hold, from the schema. */
export const RECORD_KEYS: Readonly<Record<Part, ReadonlySet<string>>> = {
  meta: new Set(Object.keys(DesignMeta.shape)),
  page: new Set(Object.keys(Page.shape)),
  frame: new Set(Object.keys(Frame.shape)),
  layer: new Set(Object.keys(Layer.options[0].shape)),
}

/** The keys each layer type's props may hold, from the schema. */
export const PROP_KEYS: Readonly<Record<string, ReadonlySet<string>>> = Object.fromEntries(
  Object.entries(LAYER_PROPS).map(([type, schema]) => [type, new Set(Object.keys(schema.shape))]),
)

/** Values set once, when their record is made: a layer's type (its props are the type's) and the design's id (C28). */
const WRITE_ONCE: ReadonlySet<string> = new Set(['layer/type', 'meta/designId'])

/** The keys of a layer that hold values set one by one, each under its own name: its props and its bindings. */
const ONE_BY_ONE: ReadonlySet<string> = new Set(['props', BINDINGS_KEY])

/** The names a binding may have: the bindable properties. */
const BINDABLE: ReadonlySet<string> = new Set(BindableProperty.options)

/** The key of a record that orders it among its siblings. */
export const ORDER_KEY: Readonly<Record<HeldPart, 'order' | 'index'>> = {
  page: 'order',
  frame: 'order',
  layer: 'index',
}

/** The key of a record that names what holds it: a frame's page, a layer's parent. */
const HOLDER_KEY: Partial<Record<Part, string>> = { frame: 'pageId', layer: 'parentId' }

const NAMES: Record<Part, string> = { meta: 'the design', page: 'page', frame: 'frame', layer: 'layer' }

/** Nothing is owned: every write copies. */
const NONE_OWNED: ReadonlySet<Rec> = new Set()

export function recordKey(part: Part, id: string): RecordKey {
  return `${part}/${id}`
}

/** The part and id a record key names. */
export function recordOf(key: RecordKey): { part: Part; id: string } {
  const at = key.indexOf('/')
  return { part: key.slice(0, at) as Part, id: key.slice(at + 1) }
}

/** Names one target in sets and maps. */
export function targetKey(t: Target): string {
  return t.prop === undefined ? `${t.part}/${t.id}/${t.key}` : `${t.part}/${t.id}/${t.key}/${t.prop}`
}

/** What holds a record: a frame's page id or a layer's parent id (undefined for a page or the meta). */
export function holderOf(part: Part, record: Rec): string | undefined {
  const key = HOLDER_KEY[part]
  const holder = key === undefined ? undefined : own(record, key)
  return typeof holder === 'string' ? holder : undefined
}

/** The target of a record that names what holds it, if it has one. */
export function holderTarget(part: Part, id: string): Target | undefined {
  const key = HOLDER_KEY[part]
  return key === undefined ? undefined : { part, id, key }
}

/** The target of a record that orders it among its siblings, if it has one. */
export function orderTarget(part: Part, id: string): Target | undefined {
  return part === 'meta' ? undefined : { part, id, key: ORDER_KEY[part] }
}

/**
 * How many items of `among` hold `start`, one inside the other, `start` included: the order in
 * which records created together go, holders first. A loop counts each item once.
 */
export function depthAmong<T>(
  among: ReadonlyMap<string, T>,
  start: T | undefined,
  holder: (item: T) => string | undefined,
): number {
  let depth = 0
  for (let at = start; at !== undefined && depth <= among.size; depth++) at = among.get(holder(at) ?? '')
  return depth
}

/** The record's part in words, with its id: `layer "abc"`. */
export function describe(part: Part, id: string): string {
  return part === 'meta' ? NAMES.meta : `${NAMES[part]} "${id}"`
}

/**
 * Why `t` is not a value a change may set on `record`, if it is not: a key its part has no place
 * for, one set only when the record is made (C28), a prop its layer's type has no place for, or a
 * binding of no bindable property. A layer's bindings are set one by one, or whole, as journals, tab
 * copies and saved queues may hold them.
 */
export function targetIssue(record: Rec, t: Target): string | undefined {
  if (!RECORD_KEYS[t.part].has(t.key)) return `${describe(t.part, t.id)} has no "${t.key}"`
  if (WRITE_ONCE.has(`${t.part}/${t.key}`)) return `${describe(t.part, t.id)}'s "${t.key}" is set only when it is made`
  if (t.part !== 'layer' || !ONE_BY_ONE.has(t.key)) {
    return t.prop === undefined ? undefined : `${describe(t.part, t.id)}'s "${t.key}" is one value`
  }
  if (t.key === BINDINGS_KEY) {
    return t.prop === undefined || BINDABLE.has(t.prop) ? undefined : `there is no bindable property "${t.prop}"`
  }
  if (t.prop === undefined) return `a layer's props are set one by one`
  if (record.type === 'text' && t.prop === 'runs') return `a text's runs are set with its text`
  const props =
    typeof record.type === 'string' && Object.hasOwn(PROP_KEYS, record.type) ? PROP_KEYS[record.type] : undefined
  return props?.has(t.prop) ? undefined : `${describe(t.part, t.id)} has no prop "${t.prop}"`
}

/** The value `record` holds at `t` (undefined when it holds none). */
export function valueAt(record: Rec, t: Target): unknown {
  if (t.prop === undefined) return own(record, t.key)
  const map = mapOf(record, t.key)
  if (isTextValue(record, t)) {
    const text = own(map, 'text')
    const runs = own(map, 'runs')
    if (text === undefined && runs === undefined) return undefined
    return runs === undefined ? { text } : { text, runs }
  }
  return own(map, t.prop)
}

/**
 * `record` with `to` at `t` (undefined: without it). The record and its props or bindings are
 * copied before they are written, but for those in `owned`, which the caller made and nobody else
 * holds: those are written into. A layer's bindings are made with its first binding and taken out
 * with its last.
 */
export function withValue(record: Rec, t: Target, to: unknown, owned: ReadonlySet<Rec> = NONE_OWNED): Rec {
  if (t.prop === undefined) return write(record, t.key, to, owned)
  const map = mapOf(record, t.key)
  let next: Rec
  if (isTextValue(record, t)) {
    const both = isRecord(to) ? to : {}
    next = write(write(map, 'text', own(both, 'text'), owned), 'runs', own(both, 'runs'), owned)
  } else next = write(map, t.prop, to, owned)
  const empty = t.key === BINDINGS_KEY && Object.keys(next).length === 0
  return write(record, t.key, empty ? undefined : next, owned)
}

/** Every target `record` holds a value at: a layer's props and bindings one by one. */
export function targetsOf(part: Part, id: string, record: Rec): Target[] {
  const out: Target[] = []
  for (const key of Object.keys(record)) if (part !== 'layer' || !ONE_BY_ONE.has(key)) out.push({ part, id, key })
  if (part !== 'layer') return out
  for (const prop of Object.keys(mapOf(record, BINDINGS_KEY))) out.push({ part, id, key: BINDINGS_KEY, prop })
  const props = mapOf(record, 'props')
  const text = record.type === 'text'
  if (text && (Object.hasOwn(props, 'text') || Object.hasOwn(props, 'runs'))) {
    out.push({ part, id, key: 'props', prop: TEXT_PROP })
  }
  for (const prop of Object.keys(props)) {
    if (!text || (prop !== 'text' && prop !== 'runs')) out.push({ part, id, key: 'props', prop })
  }
  return out
}

/** The change that writes `to` at `value` (undefined: unsets it). */
export function setOf(value: Target, to: unknown): Change {
  return to === undefined ? { op: 'set', value } : { op: 'set', value, to }
}

/** The record a change names. */
export function changedRecord(change: Change): RecordKey {
  return change.op === 'set' ? recordKey(change.value.part, change.value.id) : recordKey(change.part, change.id)
}

/** A record's own value at `key`: never one an object inherits, such as `constructor`. */
function own(record: Readonly<Record<string, unknown>>, key: string): unknown {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

/** What a layer holds at `key`, its props or its bindings, as an object: empty where it holds none. */
function mapOf(record: Rec, key: string): Readonly<Record<string, unknown>> {
  const map = own(record, key)
  return isRecord(map) ? map : {}
}

/** Whether `t` is a text layer's text and runs, set as one value. */
function isTextValue(record: Rec, t: Target): boolean {
  return t.key === 'props' && t.prop === TEXT_PROP && record.type === 'text'
}

/** `object` with `value` at `key` (without `key` when the value is undefined): itself when it is in `owned`, else a copy. */
function write(object: Rec, key: string, value: unknown, owned: ReadonlySet<Rec>): Rec {
  if (!owned.has(object)) return assign(object, key, value)
  const into = object as Record<string, unknown>
  if (value === undefined) Reflect.deleteProperty(into, key)
  else into[key] = value
  return object
}

/** A copy of `object` with `value` at `key`, or without `key` when the value is undefined. */
function assign(object: Readonly<Record<string, unknown>>, key: string, value: unknown): Rec {
  const out: Record<string, unknown> = { ...object }
  if (value === undefined) Reflect.deleteProperty(out, key)
  else out[key] = value
  return out
}
