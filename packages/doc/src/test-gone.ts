// What the multi-tab walk's end check (c) lets stay gone once every tab undid everything (G3). An
// untracked step's deletes are no one's to undo, nor what went with them. And a tab that comes back
// to the whole design never learns what its own deletes took on the server meanwhile: a part
// another tab brought back into what it deleted, unknown to it, its undo can't bring back (a
// known limit of a whole-design catch-up).
import type { Design, ServerMessage } from '@dazbee/schema'

import type { ClientStore } from './client-store.ts'
import type { Session } from './session.ts'
import type { Client } from './sync/client.ts'
import type { ReadState } from './sync/state.ts'

/** The deletes of change sets a tab never heard accepted, and the parts its confirmed design held then. */
interface Unheard {
  roots: Set<string>
  known: Set<string>
}

/** What the walk notes, as it goes, of the parts that may stay gone. */
export class Gone {
  /** The pages, frames and layers an untracked step deleted. */
  readonly #untracked = new Set<string>()
  readonly #unheard: Unheard[] = []
  /** What held each frame and layer when it went, on the server and in each tab's view: they can differ. */
  readonly #heldWhenGone = new Map<string, Set<string>>()
  /** What held each frame and layer on the server when the walk last looked. */
  #serverHeld = new Map<string, string>()
  /** What held each frame and layer the server no longer has when it went, and at which of the walk's looks. */
  readonly #serverWent = new Map<string, { holder: string; look: number }>()
  #looks = 0

  /** Notes what an untracked step deleted: the parts of `before` (ids) that `after` no longer has. */
  untracked(before: readonly string[], after: Design) {
    const parts = [after.pages, after.frames, after.nodes, after.sections, after.connectors]
    for (const id of before) if (!parts.some((part) => Object.hasOwn(part, id))) this.#untracked.add(id)
  }

  /** Notes, as each change of the tab's design comes, what held each frame, section, connector and layer that went. */
  watchTab(session: Session, store: ClientStore) {
    const holders = (design: Design) =>
      new Map([
        ...[design.frames, design.sections, design.connectors].flatMap((part) =>
          Object.entries(part).map(([id, held]) => [id, held.pageId] as const),
        ),
        ...Object.entries(design.nodes).map(([id, layer]) => [id, layer.parentId] as const),
      ])
    let held = holders(session.design())
    store.onChange(() => {
      const now = holders(session.design())
      this.#went(held, now)
      held = now
    })
  }

  /** Notes the deletes `client`'s change sets made that a welcome with the whole design settles as accepted. */
  watchClient(client: Client) {
    const receive = client.receive
    client.receive = (message) => {
      if (message.type === 'welcome' && 'design' in message.catchUp) this.#unheard.push(unheardDeletes(client, message))
      return receive(message)
    }
  }

  /** Notes what held each frame and layer gone from the server's design (`state`) since it last looked. */
  watchServer(state: ReadState) {
    const now = holdersOn(state)
    this.#looks++
    for (const [id, holder] of this.#serverHeld)
      if (!now.has(id)) this.#serverWent.set(id, { holder, look: this.#looks })
    this.#went(this.#serverHeld, now)
    this.#serverHeld = now
  }

  /**
   * Whether part `id` may stay gone: an untracked step deleted it, or what held it when it went (in
   * any view, or, for one still there, at the start, `start`); or a delete its tab never heard
   * accepted took it on the server, with what held it there, unknown to that tab.
   */
  mayStayGone(start: Design, id: string): boolean {
    const holders = (up: string) => {
      const went = this.#heldWhenGone.get(up)
      if (went) return [...went]
      const first =
        start.nodes[up]?.parentId ??
        start.frames[up]?.pageId ??
        start.sections[up]?.pageId ??
        start.connectors[up]?.pageId
      return first === undefined ? [] : [first]
    }
    const chain = new Set<string>()
    const reach = [id]
    for (let up = reach.pop(); up !== undefined; up = reach.pop()) {
      if (chain.has(up)) continue
      chain.add(up)
      reach.push(...holders(up))
    }
    const took = ({ roots, known }: Unheard) => !known.has(id) && this.#wentWith(id, roots)
    return [...chain].some((up) => this.#untracked.has(up)) || this.#unheard.some(took)
  }

  /** Whether part `id` went from the server with one of `roots` that held it there, at the same look. */
  #wentWith(id: string, roots: ReadonlySet<string>): boolean {
    const look = this.#serverWent.get(id)?.look
    const seen = new Set<string>()
    for (let up: string | undefined = id; up !== undefined && !seen.has(up);) {
      if (roots.has(up)) return true
      seen.add(up)
      const holder: string | undefined = this.#serverWent.get(up)?.holder
      up = holder !== undefined && this.#serverWent.get(holder)?.look === look ? holder : undefined
    }
    return false
  }

  #went(held: ReadonlyMap<string, string>, now: ReadonlyMap<string, string>) {
    for (const [id, holder] of held) {
      if (!now.has(id)) this.#heldWhenGone.set(id, (this.#heldWhenGone.get(id) ?? new Set()).add(holder))
    }
  }
}

/** What `client`'s change sets that `welcome`, a whole design, settles as accepted deleted, and what it knew of then. */
function unheardDeletes(client: Client, { processed }: Extract<ServerMessage, { type: 'welcome' }>): Unheard {
  const rejected = new Set(processed.rejected)
  const accepted = client.save().queue.filter((q) => q.id <= processed.lastChangeSet && !rejected.has(q.id))
  const roots = new Set(accepted.flatMap((q) => q.changes.flatMap((c) => (c.op === 'delete' ? [c.id] : []))))
  const state = client.confirmed()
  const known = new Set(
    (['page', 'frame', 'layer', 'section', 'connector'] as const).flatMap((part) => state.ids(part)),
  )
  return { roots, known }
}

/** What holds each frame, section, connector and layer of a design state. */
function holdersOn(state: ReadState): Map<string, string> {
  const held = new Map<string, string>()
  for (const part of ['frame', 'section', 'connector'] as const)
    for (const id of state.ids(part)) held.set(id, state.get(part, id)?.pageId as string)
  for (const id of state.ids('layer')) held.set(id, state.get('layer', id)?.parentId as string)
  return held
}
