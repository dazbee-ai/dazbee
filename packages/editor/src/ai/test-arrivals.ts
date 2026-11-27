// The arrivals' tests' tabs: members, a brief, and tabs on a sync server in memory, each with its arrivals on a fake
// of the API's AI flow, its clock and its visibility, which the tests move; and what lets their writes land.
import type { Design, DesignInput, Member, RestoreMark } from '@dazbee/schema'

import { HALF } from '../canvas/test-images.ts'
import { openTab } from '../open-tab.ts'
import { WORDS } from '../test-actions.ts'
import { type TestEditor, testEditor } from '../test-editor.ts'
import { type MemorySync, memorySync } from '../test-link.ts'
import { type BriefRequest, type EditorArrivals, editorArrivals } from './arrivals.ts'
import { pictureLayerOf } from './place-brief.ts'
import type { FakeAi } from './test-ai.ts'

export const ANN: Member = { userId: 'ann', workspaceId: 'w1' }
export const BOB: Member = { userId: 'bob', workspaceId: 'w1' }
export const VIC: Member = { userId: 'vic', workspaceId: 'w1' }
export const MARK: RestoreMark = { versionId: 'v1', kind: 'named', name: 'Kept', takenAt: '2026-11-27T09:00:00.000Z' }

export const BRIEF: BriefRequest = {
  pageId: 'p1',
  words: '  Diwali serum sale\nwarm lights, gold tones',
  pictures: [],
  size: { width: 1080, height: 1080 },
  mode: 'fast',
  draftName: (n) => `Draft ${n + 1}`,
}

/** A tab of a test: its editor, its arrivals, and its clock and visibility, which the test moves. */
export interface Tab {
  editor: TestEditor
  arrivals: EditorArrivals
  /** The read waiting to run, and after how long; null when none waits. */
  timer(): { ms: number; run: () => void } | null
  /** Shows or hides the tab. */
  show(shown: boolean): void
  /** Ends the tab's arrivals, as the editor's end does. */
  end(): void
}

/** The bytes of every picture the tabs load. */
const PICTURE = HALF.encodeToBytes() ?? new Uint8Array()

let mem: MemorySync
const ending: (() => Promise<void> | void)[] = []

/** The sync server in memory that the tabs open on, holding `design`; a test starts one before its first tab. */
export function serve(design: DesignInput): MemorySync {
  mem = memorySync(design)
  return mem
}

/** Ends every tab opened since, the last first: each test's `afterEach`. */
export async function endTabs() {
  for (const end of ending.splice(0).reverse()) await end()
}

/**
 * A tab on the server in memory, as `token`'s member, with its arrivals on `ai`; seen at 100 % and getting
 * pictures ready through its editor unless `link` says otherwise.
 */
export async function tabOn(
  ai: FakeAi,
  token = 'ann',
  member = ANN,
  link: {
    connected?: () => boolean
    synced?: () => boolean
    zoom?: number
    readyPictures?: (ids: readonly string[]) => Promise<void>
  } = {},
): Promise<Tab> {
  const opened = await openTab({
    designId: 'd',
    member,
    url: 'ws://s',
    token: () => Promise.resolve(token),
    socket: mem.socket,
  })
  ending.push(() => opened.close())
  const editor = await testEditor(WORDS, { tab: opened, sources: { assetBytes: () => Promise.resolve(PICTURE) } })
  ending.push(() => editor.end())
  let timer: { ms: number; run: () => void } | null = null
  let shown = true
  const listeners = new Set<() => void>()
  const stop = new AbortController()
  let made = 0
  const arrivals = editorArrivals({
    session: editor.session,
    ai,
    designId: 'd',
    newId: () => `${token}-${++made}`,
    after: (ms, run) => {
      const waiting = { ms, run }
      timer = waiting
      return () => {
        if (timer === waiting) timer = null
      }
    },
    shown: {
      now: () => shown,
      onChange: (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
    },
    connected: link.connected ?? (() => opened.link.status() === 'connected'),
    synced: link.synced ?? opened.synced,
    zoomFor: () => link.zoom ?? 1,
    readyPictures: link.readyPictures ?? editor.modules.resources.prepareImages,
    signal: stop.signal,
  })
  ending.push(() => stop.abort())
  await settle(arrivals)
  return {
    editor,
    arrivals,
    timer: () => timer,
    show: (next) => {
      shown = next
      for (const listener of [...listeners]) listener()
    },
    end: () => stop.abort(),
  }
}

/** Lets every message on its way land, what it set going run, and the tab's arrivals be stored and marked. */
export async function settle(...arrivals: EditorArrivals[]) {
  for (let n = 0; n < 5; n++) {
    await mem.settle()
    await new Promise((resolve) => setTimeout(resolve, 0))
    await Promise.all(arrivals.map((a) => a.settled()))
  }
}

/** Reads the design's AI frames now, on each tab, and lets what it writes land. */
export async function pollAll(...tabs: Tab[]) {
  for (const tab of tabs) await tab.arrivals.poll()
  await settle(...tabs.map((t) => t.arrivals))
}

/** The fills of a frame's picture layer. */
export const fillsOf = (design: Design, frameId: string) =>
  (design.nodes[pictureLayerOf(frameId)]?.props as { fills?: unknown[] } | undefined)?.fills

export const pictureOf = (assetId: string) => [{ type: 'image', assetId, fit: 'fill', opacity: 1 }]
