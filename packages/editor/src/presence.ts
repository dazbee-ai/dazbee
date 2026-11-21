// The tab's presence, as the other people in the design see it: the shown page, the pointer in page
// coordinates while it is on the stage and the tab is shown, the selected layers and the picked
// frame. It is worked out again after each pointer input and each time what is shown changes, and
// handed to the tab's link, which sends the latest at most 30 times a second. And the other people's,
// as the overlay draws them: on the shown page only, each person once, as their tab there heard from
// last, at most `PEOPLE_SHOWN` of those heard from last, each in their colour, an agent marked as one
// with its note. What they show is kept
// until their presence, the page, the camera, the design or the frames in view change.
import { frameIdOf, PEOPLE_COLOURS, type Point, type Presence, PRESENCE_SELECTION } from '@dazbee/schema'

import { toScreen, toWorld } from './canvas/camera.ts'
import type { Frame } from './canvas/frames.ts'
import type { EditorView } from './canvas/view.ts'
import type { OtherPresence, TabPresence } from './core-interface.ts'
import type { PointerInput } from './gestures/inputs.ts'
import type { EditorPointer } from './gestures/pointer.ts'
import type { EditorSelection } from './selection.ts'

/** Another person as the overlay draws them. */
export interface ShownPerson {
  /** The tab of theirs heard from last. */
  tabId: number
  name: string
  /** Their colour, as `#RRGGBB`. */
  colour: string
  /** Their pointer, as a stage point; null while it is off their stage or their tab is hidden. */
  cursor: Point | null
  /** Their selected layers in the frames in view. */
  layers: { frame: Frame; id: string }[]
  /** Their picked frame, when it is in view. */
  frame: Frame | null
  /** They are an agent, as their tab's token says; left out for a person. */
  agent?: true
  /** What an agent says it is doing, when it says it; never a person's. */
  note?: string
}

export interface PresenceDeps {
  view: Pick<EditorView, 'camera' | 'page' | 'design' | 'inView'>
  selection: Pick<EditorSelection, 'current' | 'pickedFrame'>
  pointer: Pick<EditorPointer, 'pointerAt'>
  /** Where the presence goes; without it, the tab has none to send. */
  link: TabPresence | undefined
}

export interface EditorPresence {
  /** The tab's presence now. */
  mine(): Presence
  /** Works the presence out again and hands it to the link: after a pointer input, and when what is shown changed. */
  update(): void
  /** A pointer input came: a move or a press says the tab is shown again. */
  pointed(type: PointerInput['type']): void
  /** The tab was hidden: its pointer is none until the next pointer input. */
  hidden(): void
  /** The other people on the shown page, the one heard from last at the end. */
  shown(): readonly ShownPerson[]
  /** Told whenever the other people's presence changes; without a link, never. */
  onChange(listener: () => void): () => void
}

/** The most people drawn at once: those heard from last. */
export const PEOPLE_SHOWN = 20

/** Page coordinates are sent to a hundredth of a pixel. */
const PLACES = 100
/** The pointer inputs only a shown tab gets. */
const SHOWN_BY: ReadonlySet<PointerInput['type']> = new Set(['pointermove', 'pointerdown'])

export function editorPresence({ view, selection, pointer, link }: PresenceDeps): EditorPresence {
  /** Whether the tab was hidden since its last pointer input. */
  let hidden = false
  /** What `shown` last gave, with what it was worked out from. */
  let kept: { from: unknown[]; people: readonly ShownPerson[] } | undefined

  function mine(): Presence {
    const at = hidden ? null : pointer.pointerAt()
    const onPage = at && toWorld(view.camera(), at)
    const finite = onPage && Number.isFinite(onPage.x) && Number.isFinite(onPage.y)
    return {
      page: view.page(),
      pointer: onPage && finite ? [round(onPage.x), round(onPage.y)] : null,
      selection: (selection.current() ?? []).slice(0, PRESENCE_SELECTION).map((layer) => layer.id),
      frame: selection.pickedFrame(),
    }
  }

  function update() {
    link?.send(mine())
  }

  function shown(): readonly ShownPerson[] {
    const others = link?.others()
    if (!others || others.size === 0) return []
    const from = [others, view.page(), view.camera(), view.design(), view.inView()]
    if (kept && kept.from.every((value, i) => value === from[i])) return kept.people
    kept = { from, people: worked(others) }
    return kept.people
  }

  /** The people `others` shows on the shown page. */
  function worked(others: ReadonlyMap<number, OtherPresence>): ShownPerson[] {
    const page = view.page()
    const camera = view.camera()
    const design = view.design()
    const inView = new Map(view.inView().map((frame) => [frame.id, frame]))
    // Each person once: their tab on the shown page heard from last, moved to the end.
    const latest = new Map<number, [number, OtherPresence]>()
    for (const [tabId, other] of others) {
      if (other.presence.page !== page) continue
      latest.delete(other.person)
      latest.set(other.person, [tabId, other])
    }
    const onPage = [...latest.values()].slice(-PEOPLE_SHOWN)
    return onPage.map(([tabId, { name, colour, agent, presence }]): ShownPerson => {
      const pointer = presence.pointer && toScreen(camera, { x: presence.pointer[0], y: presence.pointer[1] })
      const layers = presence.selection.flatMap((id) => {
        const frame = design.nodes[id] ? inView.get(frameIdOf(design, id) ?? '') : undefined
        return frame ? [{ frame, id }] : []
      })
      return {
        tabId,
        name,
        colour: PEOPLE_COLOURS[colour % PEOPLE_COLOURS.length] ?? PEOPLE_COLOURS[0],
        cursor: pointer,
        layers,
        frame: (presence.frame === null ? undefined : inView.get(presence.frame)) ?? null,
        // Only an agent's note is shown, as the server passes on only theirs.
        ...(agent ? { agent, ...(presence.note ? { note: presence.note } : {}) } : {}),
      }
    })
  }

  return {
    mine,
    update,
    pointed(type) {
      // A capture lost or a release as the tab hides says nothing of the tab being shown.
      if (SHOWN_BY.has(type)) hidden = false
      update()
    },
    hidden() {
      hidden = true
      update()
    },
    shown,
    onChange: (listener) => link?.onChange(listener) ?? (() => {}),
  }
}

function round(n: number) {
  return Math.round(n * PLACES) / PLACES
}
