import { canHold, deepFreeze, type Design, type Layer, parseLayer } from '@dazbee/schema'

import { buildChildIndex, registerChildIndex, siblingOrder } from './children.ts'
import { registerLinkIndex } from './links.ts'
import { idIssue, type LeftOut, repair } from './repair.ts'
import { sameValue } from './same-value.ts'
import { type DesignStore, readDesign } from './store.ts'

/** What a whole read left out and repaired to give the design. */
export interface Unread {
  leftOut: readonly LeftOut[]
  repairs: readonly string[]
}

type Head = Omit<Design, 'nodes'>

/** What a read that left nothing out and repaired nothing reports: one object, so two such reads report the same one. */
const NOTHING_UNREAD: Unread = Object.freeze({ leftOut: Object.freeze([]), repairs: Object.freeze([]) })

/**
 * A tab's validated design, kept up to date as the document changes (#23, #29). An edit that
 * changes layers' properties, which is nearly every edit, re-reads and validates only what it
 * touched: nothing it does grows with the number of layers. An edit that changes the meta, pages,
 * frames, sections or connectors reads and repairs the whole design, as `repair` does with the store's snapshot, and so
 * does one that adds, removes, re-parents or re-links a layer in a way only repair can settle, or
 * leaves a layer the schema does not take. Either way the design equals what `repair` makes of the
 * snapshot.
 *
 * The design it hands out is live: it always shows the document as it is now, so it never needs
 * copying. It can't be changed through, and each layer in it is frozen and replaced, never
 * changed, when the document changes, so holding one is safe.
 */
export function designView(store: DesignStore) {
  /** Each live layer as plain JSON, as the document holds it, before repair and validation. */
  const rawNodes = new Map<string, unknown>()
  /** The validated design's layers. */
  const layers = new Map<string, Layer>()
  /** Each parent's children, back to front. */
  let children = new Map<string, string[]>()
  /** The frame each layer is in. */
  const frameOfLayer = new Map<string, string>()
  /** The layer holding each link id, by frame. */
  const linkHolder = new Map<string, Map<string, string>>()
  /** The validated meta, pages, frames, sections and connectors; null until the first whole read. */
  let head: Head | null = null
  /** What the last whole read left out and repaired. */
  let unreadNow = NOTHING_UNREAD
  /** The keys the document's frames are stored under, read or left out, as the last whole read found them. */
  let frameKeys: Record<string, unknown> = {}
  /** The layers the last whole read left out: a change to one of them needs a whole read. */
  const unreadLayers = new Set<string>()
  /**
   * Whether the last whole read moved, dropped or re-linked a layer, or gave it an index: a later
   * change can undo what made repair do it, so only a whole read can tell. A layer left out is not
   * one of those: only a change to it, or to what holds it, can bring it back.
   */
  let layersRepaired = false
  /** Whether the whole design must be read again. */
  let whole = true
  /** The layers changed since the last read. */
  const dirtyNodes = new Set<string>()
  /** How many changes the store has told since the view opened, counted as each ends. */
  let changes = 0
  /**
   * How many reads gave a design that differs from the one the view held: a meta, page, frame,
   * section, connector or layer value not equal to what it replaced, or one that came or went.
   */
  let revisions = 0

  const nodes = readOnlyRecord(() => {
    refresh()
    return layers
  })
  const design = Object.freeze({
    get meta() {
      return current().meta
    },
    get pages() {
      return current().pages
    },
    get frames() {
      return current().frames
    },
    get sections() {
      return current().sections
    },
    get connectors() {
      return current().connectors
    },
    nodes,
  }) as unknown as Design

  function current() {
    refresh()
    if (!head) throw new Error('the design view was read inside a transaction before its first read')
    return head
  }

  function read(): Design {
    // Inside a transaction the changes so far haven't been reported yet: read them directly.
    if (store.inTransaction()) return readDesign(store)
    refresh()
    return design
  }

  /**
   * What the read of the design leaves out, for a value the schema does not take, and repairs.
   * It is the same object until a whole read finds something to leave out or repair again.
   */
  function unread(): Unread {
    refresh()
    return unreadNow
  }

  /** How many reads gave a design that differs from the one before, the view brought up to date first. */
  function revision(): number {
    refresh()
    return revisions
  }

  const loadNode = (id: string) => {
    const layer = store.layer(id)
    if (layer === undefined) rawNodes.delete(id)
    else rawNodes.set(id, layer)
  }
  const holdLink = (id: string, layer: Layer, frameId: string) => {
    frameOfLayer.set(id, frameId)
    const links = linkHolder.get(frameId) ?? new Map<string, string>()
    linkHolder.set(frameId, links)
    links.set(layer.link, id)
  }
  const releaseLink = (id: string, layer: Layer) => {
    const frameId = frameOfLayer.get(id)
    const links = frameId === undefined ? undefined : linkHolder.get(frameId)
    if (links?.get(layer.link) === id) links.delete(layer.link)
    frameOfLayer.delete(id)
  }

  /** Reads, repairs and validates the whole design, as `repair` does with the store's snapshot. */
  function readWhole() {
    for (const id of dirtyNodes) loadNode(id)
    const stored = store.head()
    const read = repair({ ...stored, nodes: Object.fromEntries(rawNodes) })
    frameKeys = stored.frames
    const d = read.design
    // What equals what the view held stays the same object, so the scenes built from a frame are kept.
    const next = {
      meta: kept(head?.meta, d.meta),
      pages: keptEach(head?.pages, d.pages),
      frames: keptEach(head?.frames, d.frames),
      sections: keptEach(head?.sections, d.sections),
      connectors: keptEach(head?.connectors, d.connectors),
    }
    if (head && !sameDesign(head, next, layers, d.nodes)) revisions++
    head = next
    const sound = read.leftOut.length === 0 && read.repairs.length === 0
    unreadNow = sound ? NOTHING_UNREAD : { leftOut: read.leftOut, repairs: read.repairs }
    unreadLayers.clear()
    for (const { part, id } of read.leftOut) if (part === 'layer') unreadLayers.add(id)
    layers.clear()
    for (const [id, layer] of Object.entries(d.nodes)) layers.set(id, layer)
    children = buildChildIndex(layers)
    frameOfLayer.clear()
    linkHolder.clear()
    const frameOf = (id: string): string => {
      const known = frameOfLayer.get(id)
      if (known !== undefined) return known
      const parentId = (layers.get(id) as Layer).parentId
      return Object.hasOwn(d.frames, parentId) ? parentId : frameOf(parentId)
    }
    for (const [id, layer] of layers) holdLink(id, layer, frameOf(id))
    layersRepaired =
      rawNodes.size - unreadLayers.size !== layers.size ||
      [...layers].some(([id, layer]) => {
        const raw = rawNodes.get(id) as Partial<Layer>
        return raw.parentId !== layer.parentId || raw.index !== layer.index || raw.link !== layer.link
      })
  }

  /**
   * Takes in an edit by checking only the layers it touched. Returns false, having changed
   * nothing, when repair has to decide instead: something is invalid, a layer came under a key
   * that is no id or is a frame's, a layer left out changed, a
   * layer changed type, a move would put a layer inside itself or into another frame, a removed
   * layer leaves children behind, a layer takes a link id its frame holds, or the last whole read
   * repaired a layer, which a later change can undo.
   */
  function readChanges(): boolean {
    if (!head) return false
    const frames = head.frames
    const staged = new Map<string, Layer>()
    const removed = new Set<string>()
    let structural = false
    for (const id of dirtyNodes) {
      if (unreadLayers.has(id)) return false
      const was = layers.get(id)
      loadNode(id)
      const raw = rawNodes.get(id)
      if (raw === undefined) {
        if (was) removed.add(id)
        continue
      }
      // A layer that came is read only under a key that is an id, and no frame's.
      if (!was && (idIssue(id) !== undefined || Object.hasOwn(frameKeys, id))) return false
      const parsed = parseLayer(raw)
      if (!parsed.success || (was && parsed.layer.type !== was.type)) return false
      staged.set(id, parsed.layer)
      if (!was || was.parentId !== parsed.layer.parentId || was.link !== parsed.layer.link) structural = true
    }
    if (removed.size > 0) structural = true
    if (structural && layersRepaired) return false

    // The layers as they will be: what a parent check or a walk up to the frame sees.
    const next = (id: string) => staged.get(id) ?? (removed.has(id) ? undefined : layers.get(id))
    /** The frame and link of each staged layer that came, moved or changed its link id. */
    const relinks = new Map<string, string>()
    const claimed = new Map<string, Map<string, string>>()
    for (const [id, layer] of staged) {
      const was = layers.get(id)
      const moved = !was || was.parentId !== layer.parentId
      if (!moved && was.link === layer.link) continue
      if (moved) {
        if (!Object.hasOwn(frames, layer.parentId)) {
          const parent = next(layer.parentId)
          if (!parent || !canHold(parent.type, layer.type)) return false
        }
      }
      let up = layer.parentId
      for (let steps = 0; !Object.hasOwn(frames, up); steps++) {
        const above = next(up)
        if (up === id || !above || steps > layers.size + staged.size) return false
        up = above.parentId
      }
      // Moving to another frame takes everything under the layer along: repair decides.
      if (was && up !== frameOfLayer.get(id)) return false
      const holder = linkHolder.get(up)?.get(layer.link)
      if (holder !== undefined && holder !== id) return false
      const claims = claimed.get(up) ?? new Map<string, string>()
      claimed.set(up, claims)
      if (claims.has(layer.link)) return false
      claims.set(layer.link, id)
      relinks.set(id, up)
    }
    for (const id of removed) {
      for (const child of children.get(id) ?? []) if (next(child)?.parentId === id) return false
    }

    // Every list that changes is a new array, so a list handed out before stays as it was.
    const lists = new Map<string, string[]>()
    const listOf = (parentId: string) => {
      let list = lists.get(parentId)
      if (!list) {
        list = [...(children.get(parentId) ?? [])]
        lists.set(parentId, list)
      }
      return list
    }
    const drop = (parentId: string, id: string) => {
      const list = listOf(parentId)
      const at = list.indexOf(id)
      if (at !== -1) list.splice(at, 1)
    }
    // A layer re-read to the value it had leaves the design as it was.
    const differs = ([id, layer]: [string, Layer]) => {
      const was = layers.get(id)
      return !was || !sameValue(was, layer)
    }
    if (removed.size > 0 || [...staged].some(differs)) revisions++
    for (const id of removed) {
      const layer = layers.get(id) as Layer
      drop(layer.parentId, id)
      releaseLink(id, layer)
      layers.delete(id)
    }
    /** The layers that came, moved or changed index, by id, out of their lists until each is placed again. */
    const placing: string[] = []
    for (const [id, layer] of staged) {
      const was = layers.get(id)
      if (!was || was.parentId !== layer.parentId || was.index !== layer.index) {
        if (was) drop(was.parentId, id)
        placing.push(id)
      }
      const frameId = relinks.get(id)
      if (frameId !== undefined) {
        if (was) releaseLink(id, was)
        holdLink(id, layer, frameId)
      }
      layers.set(id, layer)
    }
    // The siblings left in each list kept their order. A few layers each go where they sort among
    // them, found by halving; where more come than halving would beat, the whole list is sorted.
    const order = siblingOrder(layers)
    const coming = new Map<string, string[]>()
    for (const id of placing) {
      const parentId = (layers.get(id) as Layer).parentId
      const ids = coming.get(parentId)
      if (ids) ids.push(id)
      else coming.set(parentId, [id])
    }
    for (const [parentId, ids] of coming) {
      const list = listOf(parentId)
      if (ids.length * Math.log2(list.length + 2) >= list.length) {
        list.push(...ids)
        list.sort(order)
        continue
      }
      for (const id of ids) {
        let [low, high] = [0, list.length]
        while (low < high) {
          const middle = (low + high) >>> 1
          if (order(list[middle] as string, id) < 0) low = middle + 1
          else high = middle
        }
        list.splice(low, 0, id)
      }
    }
    for (const [parentId, list] of lists) {
      if (list.length > 0) children.set(parentId, list)
      else children.delete(parentId)
    }
    for (const id of removed) if (!layers.has(id)) children.delete(id)
    return true
  }

  /** Brings the validated design up to date with the document. Not inside a transaction: the changes so far aren't reported yet. */
  function refresh() {
    if (store.inTransaction()) return
    if (!whole && dirtyNodes.size === 0) return
    if (whole || !readChanges()) readWhole()
    whole = false
    dirtyNodes.clear()
  }

  // The document as it is when the view opens.
  for (const [id, layer] of Object.entries(store.snapshot().nodes)) rawNodes.set(id, layer)

  // Every change is seen before anything else hears of it, so a listener that reads the view gets
  // the new design.
  const stopListening = store.onChange(({ head: headChanged, layers: touched }) => {
    changes++
    if (headChanged) whole = true
    for (const id of touched) dirtyNodes.add(id)
  }, true)
  registerChildIndex(nodes, (parentId) => {
    refresh()
    return children.get(parentId) ?? []
  })
  registerLinkIndex(nodes, (frameId) => {
    refresh()
    return linkHolder.get(frameId)
  })

  function destroy() {
    stopListening()
  }

  return {
    read,
    unread,
    revision,
    changes: () => (store.inTransaction() ? null : changes),
    destroy,
  }
}

/**
 * A plain-looking record over a map that can't be changed through: setting, defining or deleting
 * a key fails, which throws in strict mode code. Keys and values always come from `entries()`.
 */
function readOnlyRecord<V>(entries: () => ReadonlyMap<string, V>): Record<string, V> {
  return new Proxy({} as Record<string, V>, {
    get: (target, key) => {
      if (typeof key === 'string') {
        const map = entries()
        if (map.has(key)) return map.get(key)
      }
      return Reflect.get(target, key) as unknown
    },
    has: (_, key) => typeof key === 'string' && entries().has(key),
    ownKeys: () => [...entries().keys()],
    getOwnPropertyDescriptor: (_, key) => {
      const map = entries()
      if (typeof key !== 'string' || !map.has(key)) return undefined
      return { value: map.get(key), writable: false, enumerable: true, configurable: true }
    },
    set: () => false,
    defineProperty: () => false,
    deleteProperty: () => false,
    setPrototypeOf: () => false,
  })
}

/** The value the view held when the read's equals it, else the read's, frozen. */
function kept<T>(held: T | undefined, read: T): T {
  return held !== undefined && sameValue(held, read) ? held : deepFreeze(read)
}

/** A record of values, each kept as `kept` keeps it; the one held when every value and key is. */
function keptEach<T>(held: Readonly<Record<string, T>> | undefined, read: Record<string, T>): Record<string, T> {
  const heldOf = (id: string) => (held && Object.hasOwn(held, id) ? held[id] : undefined)
  const next = Object.fromEntries(Object.entries(read).map(([id, value]) => [id, kept(heldOf(id), value)]))
  const same = held !== undefined && Object.keys(held).length === Object.keys(next).length
  return same && Object.entries(next).every(([id, value]) => heldOf(id) === value) ? held : Object.freeze(next)
}

/**
 * Whether a whole read gave the design the view holds: the same meta, pages, frames, sections and
 * connectors, each kept as the one held, and the same layers, each the one held or one of equal value.
 */
function sameDesign(head: Head, next: Head, layers: ReadonlyMap<string, Layer>, read: Design['nodes']): boolean {
  if (head.meta !== next.meta || head.pages !== next.pages || head.frames !== next.frames) return false
  if (head.sections !== next.sections || head.connectors !== next.connectors) return false
  const ids = Object.keys(read)
  if (ids.length !== layers.size) return false
  return ids.every((id) => {
    const was = layers.get(id)
    const layer = read[id] as Layer
    return was !== undefined && (was === layer || sameValue(was, layer))
  })
}
