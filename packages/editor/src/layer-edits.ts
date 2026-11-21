// What the edit panel and the layers panel change on layers, each as one undo step: their
// properties (a box given a width or height taking what it holds by its constraints), how each side sizes, the corner radius, the font, the name, the lock, hiding and the
// place in the layer tree. Each change stays on the layers given; their linked copies in other
// frames keep their own values.
import { type Axis, descendants, placedByFlow, type Session, type Sizing, sizingOf } from '@dazbee/doc'
import { type Design, frameIdOf, isContainer, LOCK_FLAGS } from '@dazbee/schema'

import type { EditorBoxes } from './layers/boxes.ts'
import { setHidden } from './layers/delete-hide.ts'
import { hug as hugIn } from './layers/hug.ts'
import { radiusPatch } from './layers/radius.ts'
import { followingDrawn, sizingPatch, sizingPatches } from './layers/resize.ts'
import { round } from './layers/transform.ts'
import type { EditorResources } from './resources.ts'
import { runQuietly } from './run-quietly.ts'
import { type EditorSelection, idsOf } from './selection.ts'
import type { EditorTyping } from './text/typing.ts'

export interface LayerEditsDeps {
  session: Session
  selection: Pick<EditorSelection, 'current'>
  boxes: Pick<EditorBoxes, 'drawnInFlow' | 'drawnHolders' | 'storedBoxes' | 'drawnProps'>
  resources: Pick<EditorResources, 'loadFamilies'>
  typing: Pick<EditorTyping, 'fitText' | 'selectedText' | 'styleRange'>
  /** Aborted once the editor is destroyed: a font that arrives after that is not set. */
  signal: AbortSignal
}

/** What the `Editor`'s members of the same names do. */
export interface EditorLayerEdits {
  moveLayer(id: string, parentId: string, before?: string): boolean
  setProps(
    ids: string[],
    to: (id: string, props: Readonly<Record<string, unknown>>) => Record<string, unknown> | null,
  ): boolean
  setSizing(ids: string[], to: Partial<Record<Axis, Sizing>>): boolean
  setRadius(ids: string[], to: (radius: number) => number, corner?: number): boolean
  renameLayer(id: string, name: string): boolean
  setLocked(ids: string[], locked: boolean): boolean
  setHidden(ids: string[], hidden: boolean): boolean
  setFont(fontFamily: string, fontWeight?: number): Promise<void>
}

/** Text properties that change how much room its words take, so an auto-sized box fits them again. */
export const SIZES_TEXT: ReadonlySet<string> = new Set([
  'text',
  'runs',
  'style',
  'boxMode',
  'width',
  'list',
  'paragraphSpacing',
  'maxLines',
  'shrinkToFit',
  'direction',
  'wrapStyle',
])

export function editorLayerEdits({
  session,
  selection,
  boxes,
  resources,
  typing,
  signal,
}: LayerEditsDeps): EditorLayerEdits {
  const hug = (ids: string[]) => hugIn(session, ids)

  /**
   * What a box holds, placed by its constraints as the box goes from where it is drawn, `at`, to
   * where `patch` puts it: each layer's drawn place and its size, where they change.
   */
  function following(now: Design, id: string, at: Readonly<Record<string, unknown>>, patch: Record<string, unknown>) {
    const sides = (from: Readonly<Record<string, unknown>>) => ({
      x: Number(from.x),
      y: Number(from.y),
      width: Number(from.width),
      height: Number(from.height),
    })
    const was = sides(at)
    const drawnOf = (inner: string) => sides(boxes.drawnProps(inner, now))
    const places = new Map<string, Record<string, number>>()
    for (const [inner, drawn] of followingDrawn(now, id, was, sides({ ...at, ...patch }), drawnOf)) {
      const before = drawnOf(inner)
      const place: Record<string, number> = {}
      for (const key of ['x', 'y', 'width', 'height'] as const)
        if (drawn[key] !== before[key]) place[key] = round(drawn[key])
      places.set(inner, place)
    }
    return places
  }

  /** Moves a layer within its frame, kept where it is drawn, as a flow it leaves or a group a flow moved draws it. */
  function moveLayer(id: string, parentId: string, before?: string) {
    const design = session.design()
    if (frameIdOf(design, parentId) !== frameIdOf(design, id)) return false
    const from = design.nodes[id]?.parentId
    return runQuietly(() =>
      session.gesture(() => {
        session.run('node.move', {
          id,
          parentId,
          ...(before ? { before } : {}),
          drawn: boxes.drawnInFlow([id], parentId),
          holders: boxes.drawnHolders([id], parentId),
        })
        hug([id, ...(from && session.design().nodes[from] ? [from] : [])])
      }),
    )
  }
  function setProps(
    ids: string[],
    to: (id: string, props: Readonly<Record<string, unknown>>) => Record<string, unknown> | null,
  ) {
    // Whether every layer took the whole change.
    let allowed = true
    const ran = runQuietly(() =>
      session.gesture(() => {
        const now = session.design()
        const placedProps = (id: string) => boxes.drawnProps(id, now)
        const writes = new Map<string, Record<string, unknown>>()
        for (const id of ids) {
          const node = now.nodes[id]
          if (!node) continue
          const at = placedProps(id)
          // The sides a change sizes stop fitting or filling, as a resize's do. Values a change
          // leaves as they are aren't written, so they make no undo step.
          const asked = sized(node.type, at, to(id, at))
          const patch =
            asked &&
            Object.fromEntries(
              Object.entries(asked).filter(([key, value]) => JSON.stringify(value) !== JSON.stringify(at[key])),
            )
          if (!patch || Object.keys(patch).length === 0) continue
          writes.set(id, { ...writes.get(id), ...patch })
          // A box locked against resizing keeps its size, and so what it holds keeps its place.
          if (node.type === 'box' && !node.lock?.resize && ('width' in patch || 'height' in patch)) {
            for (const [inner, place] of following(now, id, at, patch))
              if (!ids.includes(inner)) writes.set(inner, { ...writes.get(inner), ...place })
            continue
          }
          if (!isContainer(node.type) || !('x' in patch || 'y' in patch)) continue
          const dx = 'x' in patch ? Number(patch.x) - Number(at.x) : 0
          const dy = 'y' in patch ? Number(patch.y) - Number(at.y) : 0
          for (const inner of descendants(now, id)) {
            if (ids.includes(inner)) continue
            const was = placedProps(inner)
            writes.set(inner, { ...writes.get(inner), x: round(Number(was.x) + dx), y: round(Number(was.y) + dy) })
          }
        }
        // Each place is stored where it draws as given.
        const places = new Map(
          [...writes].flatMap(([id, patch]) => {
            const place = Object.fromEntries(Object.entries(patch).filter(([key]) => key === 'x' || key === 'y'))
            return Object.keys(place).length > 0 ? [[id, place as { x?: number; y?: number }]] : []
          }),
        )
        for (const [id, place] of boxes.storedBoxes(places)) writes.set(id, { ...writes.get(id), ...place })
        // Layers a patch lets go of a flow, or fixes a side of that fitted or filled, stay as drawn.
        const going = [...writes].filter(([id, patch]) => needsDrawn(now, id, patch)).map(([id]) => id)
        const drawn = going.length > 0 ? boxes.drawnInFlow(going) : undefined
        // The containers around them, as drawn before any goes: a laid-out box left with nothing in its flow keeps its size.
        const holders = going.length > 0 ? boxes.drawnHolders(going) : undefined
        for (const [id, { runs, ...patch }] of writes) {
          // A text's runs are its characters' styles, which only its own edits write: each run given
          // styles its characters.
          if (Array.isArray(runs) && now.nodes[id]?.type === 'text') {
            for (const run of runs as { start: number; end: number; style: Record<string, unknown> }[])
              if (
                !runQuietly(() =>
                  session.run('text.edit', {
                    id,
                    op: { kind: 'style', at: run.start, length: run.end - run.start, style: run.style },
                  }),
                )
              )
                allowed = false
          }
          if (Object.keys(patch).length === 0) continue
          // A layer locked against part of the change takes the rest of it.
          const kept = going.includes(id) ? { drawn: drawn ?? {}, ...(holders ? { holders } : {}) } : {}
          if (runQuietly(() => session.run('node.update', { ids: [id], patch, ...kept }))) continue
          allowed = false
          for (const [key, value] of Object.entries(patch))
            runQuietly(() => session.run('node.update', { ids: [id], patch: { [key]: value } }))
        }
        // Text that grows the size of its words fits them again.
        for (const [id, patch] of writes) {
          if (Object.keys(patch).some((key) => SIZES_TEXT.has(key))) typing.fitText(id)
        }
        hug([...writes.keys()])
      }),
    )
    return ran && allowed
  }
  function setSizing(ids: string[], to: Partial<Record<Axis, Sizing>>) {
    const patches = sizingPatches(session.design(), ids, to)
    return setProps([...patches.keys()], (id) => patches.get(id) ?? null)
  }
  function setRadius(ids: string[], to: (radius: number) => number, corner?: number) {
    const now = session.design()
    return setProps(ids, (id, at) => radiusPatch(now.nodes[id]?.type ?? '', at, to, corner))
  }
  const renameLayer = (id: string, name: string) => runQuietly(() => session.run('node.rename', { id, name }))
  const setLocked = (ids: string[], locked: boolean) =>
    runQuietly(() =>
      session.run('node.lock', { ids, lock: Object.fromEntries(LOCK_FLAGS.map((flag) => [flag, locked])) }),
    )
  const setHiddenIn = (ids: string[], hidden: boolean) => runQuietly(() => setHidden(session, boxes, ids, hidden))
  async function setFont(fontFamily: string, fontWeight?: number) {
    const ids = idsOf(selection.current()).filter((id) => session.design().nodes[id]?.type === 'text')
    const range = typing.selectedText()
    if (ids.length === 0 && !range) return
    await resources.loadFamilies([fontFamily])[0]
    if (signal.aborted) return
    if (range) {
      const node = session.design().nodes[range.id]
      if (node?.type === 'text' && range.range.end <= node.props.text.length)
        typing.styleRange(range, { fontFamily, ...(fontWeight === undefined ? {} : { fontWeight }) })
      return
    }
    const current = session.design()
    session.gesture(() => {
      for (const id of ids) {
        const node = current.nodes[id]
        if (node?.type !== 'text') continue
        const style = { ...node.props.style, fontFamily, ...(fontWeight === undefined ? {} : { fontWeight }) }
        runQuietly(() => session.run('node.update', { ids: [id], patch: { style } }))
        typing.fitText(id)
      }
    })
  }

  return {
    moveLayer,
    setProps,
    setSizing,
    setRadius,
    renameLayer,
    setLocked,
    setHidden: setHiddenIn,
    setFont,
  }
}

/** A change to a layer whose props are `at`, with each side it sets the width or height of made Fixed (`sizingPatch`). */
function sized(type: string, at: Readonly<Record<string, unknown>>, asked: Record<string, unknown> | null) {
  const sides = (['width', 'height'] as const).filter((axis) => asked && axis in asked)
  if (!asked || sides.length === 0) return asked
  const fixed = Object.fromEntries(sides.map((axis) => [axis, 'fixed' as const]))
  return { ...asked, ...sizingPatch({ type, props: { ...at, ...asked } }, fixed) }
}

/** Whether a patch lets a layer go of its flow, or fixes a side of it that fitted or filled: it is stored where it is drawn first. */
function needsDrawn(now: Design, id: string, patch: Readonly<Record<string, unknown>>) {
  const node = now.nodes[id]
  if (!node) return false
  if (patch.absolute === true && placedByFlow(now, id)) return true
  const to = patch.sizing as Partial<Record<'width' | 'height', string>> | undefined
  if (!to) return false
  const was = sizingOf(node)
  return (['width', 'height'] as const).some((axis) => was[axis] !== 'fixed' && to[axis] === 'fixed')
}
