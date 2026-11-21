// Where an agent shows as it works, as FigCraft's agent presence (`crates/engine/src/sharing/agent.rs`):
// what a step worked on, the presence that shows it to the people in the design (its layers outlined or
// its frame picked, its pointer just past them), and the note it says it with, made fit to send.
import { type Design, frameIdOf, PRESENCE_NOTE, PRESENCE_SELECTION, type Presence, type Rect } from '@dazbee/schema'

import { frameIn } from './canvas/frames.ts'

/** What an agent worked on: layers, else a frame, else nothing. */
export interface AgentWork {
  layers: readonly string[]
  frame: string | null
}

/** A design's layers and frames as they were, for `workedOn`: a session's design changes in place. */
export type Held = Pick<Design, 'nodes' | 'frames'>

/** What `noteOf` puts at the end of a note it cut. */
const CUT = '…'

/**
 * What a step from `before` to `after` worked on: the innermost layers it changed or added (a group
 * changes with what it holds, so the layers inside are the ones named); else the first frame it
 * changed, or that a layer it took out was in.
 */
export function workedOn(before: Held, after: Held): AgentWork {
  const changed = Object.keys(after.nodes).filter((id) => after.nodes[id] !== before.nodes[id])
  const holders = new Set(changed.map((id) => after.nodes[id]?.parentId))
  const layers = changed.filter((id) => !holders.has(id)).slice(0, PRESENCE_SELECTION)
  if (layers.length > 0) return { layers, frame: null }
  const frame =
    Object.keys(after.frames).find((id) => after.frames[id] !== before.frames[id]) ??
    Object.keys(before.nodes)
      .filter((id) => !Object.hasOwn(after.nodes, id))
      .map((id) => frameIdOf(before, id))
      .find((id) => id !== undefined && Object.hasOwn(after.frames, id))
  return { layers: [], frame: frame ?? null }
}

/** `design`'s layers and frames as they are now, to give `workedOn` once a step has run. */
export function held(design: Design): Held {
  return { nodes: { ...design.nodes }, frames: { ...design.frames } }
}

/**
 * The presence that shows `work` in `design`: on the page of its first layer the design holds, those
 * of its layers on that page selected; else its frame picked. The pointer sits at the bottom-end
 * corner of what it shows, in page coordinates, `boxOf` giving a layer's box in its frame. Null when
 * the design holds none of it.
 */
export function agentPresence(
  design: Design,
  work: AgentWork,
  boxOf: (id: string) => Rect | null,
): Omit<Presence, 'note'> | null {
  const placed = work.layers.flatMap((id) => {
    const frameId = frameIdOf(design, id)
    const frame = frameId === undefined ? undefined : frameIn(design, frameId)
    return frame ? [{ id, frame }] : []
  })
  const page = placed[0]?.frame.pageId
  if (page !== undefined) {
    const onPage = placed.filter(({ frame }) => frame.pageId === page)
    const corners = onPage.flatMap(({ id, frame }) => {
      const box = boxOf(id)
      return box ? [[frame.x + box.x + box.width, frame.y + box.y + box.height] as const] : []
    })
    return {
      page,
      pointer: corners.length > 0 ? [Math.max(...corners.map(([x]) => x)), Math.max(...corners.map(([, y]) => y))] : null,
      selection: onPage.map(({ id }) => id),
      frame: null,
    }
  }
  const frame = work.frame === null ? undefined : frameIn(design, work.frame)
  if (!frame) return null
  return { page: frame.pageId, pointer: [frame.x + frame.width, frame.y + frame.height], selection: [], frame: frame.id }
}

/**
 * `text` as a presence's note, as FigCraft's cursor chat takes it: control characters as spaces,
 * trimmed, and cut to `PRESENCE_NOTE` UTF-16 units with an ellipsis, never inside a character.
 */
export function noteOf(text: string): string {
  const note = text.replace(/\p{Cc}/gu, ' ').trim()
  if (note.length <= PRESENCE_NOTE) return note
  let kept = ''
  for (const character of note) {
    if (kept.length + character.length > PRESENCE_NOTE - CUT.length) break
    kept += character
  }
  return `${kept.trimEnd()}${CUT}`
}
