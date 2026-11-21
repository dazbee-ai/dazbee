'use client'

import { useEffect, useState } from 'react'

import { sameValue } from '@dazbee/doc'
import type { Editor } from '@dazbee/editor'
import type { Design } from '@dazbee/schema'

/**
 * Which changes of the design a follower is told of: every one, or every one but those that only
 * set layers' x, y, width or height while a gesture runs, which it is told of once, as the gesture
 * ends. A drag's moves change only those, so a follower that shows none of them, such as the top
 * bar or the layers panel, renders nothing while a layer is dragged.
 */
export type Follows = 'every change' | 'held places'

/** What `liveDesignStore` makes: a count of changes to read, and to be told of as it grows. */
export interface LiveDesignStore {
  subscribe(listener: () => void): () => void
  read(): number
}

/** The design's parts a change replaces, each by the object it is: unchanged parts stay the same objects. */
interface Parts {
  meta: Design['meta']
  pages: Design['pages']
  frames: Design['frames']
  nodes: Map<string, Design['nodes'][string]>
}

/** The layer props a held follower is not told of during a gesture. */
const PLACE = new Set(['x', 'y', 'width', 'height'])

/** The stores the followers of each editor share, one for each kind of following. */
const shared = new WeakMap<Editor, Partial<Record<Follows, LiveDesignStore>>>()

/**
 * The editor's design and a count of the changes `follows` tells of. The design is live, the same
 * object as it changes, so the count is what tells a component to read it again. The count is set
 * as React state, so a follower renders after the redraw that told it, not inside it.
 */
export function useLiveDesign(editor: Editor, follows: Follows = 'every change') {
  const { subscribe, read } = sharedStore(editor, follows)
  const [version, setVersion] = useState(read)
  useEffect(() => subscribe(() => setVersion(read())), [subscribe, read])
  return { design: editor.design(), version }
}

/**
 * A count of the design's changes, as `follows` says, read now and told of as it grows. Changes are
 * counted at the redraw after them, so a burst of edits is one count per frame, and a redraw that
 * only moved the view, such as a pan, is none. New brand kit values count as a change, since they
 * change what bound layers show. It follows the editor while it has a listener.
 */
export function liveDesignStore(
  editor: Pick<Editor, 'design' | 'store' | 'onDraw' | 'onHistory' | 'gesturing' | 'variables'>,
  follows: Follows,
): LiveDesignStore {
  const listeners = new Set<() => void>()
  /** How many changes it has told of. */
  let version = 0
  /** Whether the design changed since the last redraw. */
  let changed = false
  /** Whether a gesture's changes of places are held back, to tell of once it ends. */
  let held = false
  /** The design's parts as last told of, which a change of places only is told apart from; held only. */
  let told: Parts | null = null
  /** The brand kit's values as last told of. */
  let values = editor.variables()
  let stop = () => {}

  const read = () => version
  function subscribe(listener: () => void) {
    if (listeners.size === 0) start()
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
      if (listeners.size === 0) stop()
    }
  }

  function start() {
    changed = false
    held = false
    told = follows === 'held places' ? partsOf(editor.design()) : null
    values = editor.variables()
    const stopChanges = editor.store.onChange(() => {
      changed = true
    })
    const stopDraws = editor.onDraw(drawn)
    // A gesture that changed the design ends with an undo step, which may come with no redraw after it.
    const stopSteps = editor.onHistory(gestureEnded)
    stop = () => {
      stopSteps()
      stopDraws()
      stopChanges()
    }
  }
  function drawn() {
    if (editor.variables() !== values) {
      values = editor.variables()
      tell()
    } else if (changed) {
      changed = false
      held = told !== null && editor.gesturing() && onlyPlaces(told, editor.design())
      if (!held) tell()
    } else gestureEnded()
  }
  function gestureEnded() {
    if (!held || editor.gesturing()) return
    held = false
    tell()
  }
  /** Tells of the design as it is now, which takes in a change not yet counted. */
  function tell() {
    changed = false
    version++
    if (follows === 'held places') told = partsOf(editor.design())
    for (const listener of listeners) listener()
  }

  return { subscribe, read }
}

/** The store every follower of `editor` that follows as `follows` says shares, made by the first. */
function sharedStore(editor: Editor, follows: Follows) {
  const stores = shared.get(editor) ?? {}
  shared.set(editor, stores)
  stores[follows] ??= liveDesignStore(editor, follows)
  return stores[follows]
}

function partsOf(design: Design): Parts {
  return { meta: design.meta, pages: design.pages, frames: design.frames, nodes: new Map(Object.entries(design.nodes)) }
}

/**
 * Whether the design differs from `was` only in layers' x, y, width or height. A change to the meta,
 * a page or a frame makes the design read whole again, with new objects throughout, so it never is.
 */
function onlyPlaces(was: Parts, now: Design) {
  if (was.meta !== now.meta || was.pages !== now.pages || was.frames !== now.frames) return false
  const ids = Object.keys(now.nodes)
  if (ids.length !== was.nodes.size) return false
  return ids.every((id) => {
    const before = was.nodes.get(id)
    const after = now.nodes[id]
    if (before === after) return true
    if (!before || !after) return false
    const { props: propsBefore, ...restBefore } = before
    const { props: propsAfter, ...restAfter } = after
    return sameValue(restBefore, restAfter) && samePropsApartFromPlace(propsBefore, propsAfter)
  })
}

/** Whether two layers' props hold the same values as plain data, apart from x, y, width and height. */
function samePropsApartFromPlace(a: Record<string, unknown>, b: Record<string, unknown>) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  return [...keys].every((key) => PLACE.has(key) || sameValue(a[key], b[key]))
}
