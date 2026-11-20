// The agent tab (ADR-0019): the editor's core opened in Node on one design, joined to the sync
// server as a member's tab, with a stage of no size, nothing drawn, no presence and no tab copies.
// Its session fits what each step changed as the editor's own edits do: the texts to their words
// and the groups to what they hold, in the same step. It reads no browser global.
import type { CanvasKit } from '@dazbee/canvaskit'
import { readDesign, sameValue, type Session, type StepName } from '@dazbee/doc'
import { FALLBACK_FAMILIES } from '@dazbee/fonts'
import { loadFontFiles } from '@dazbee/fonts/node'
import { type ResourceBytes, type ResourceCache, resourceCache } from '@dazbee/renderer'
import { type Design, fontFamilies, type Layer, type Member, type Variables } from '@dazbee/schema'

import { buildCore } from './core.ts'
import type { NoticeDetail } from './core-interface.ts'
import { SIZES_TEXT } from './layer-edits.ts'
import { hug } from './layers/hug.ts'
import { type OpenTab, openTab } from './open-tab.ts'
import { loadFonts, type ResourceSources } from './resources.ts'
import type { Stopped } from './save-state.ts'
import type { LinkSocket } from './sync-link.ts'

export { TabStopped } from './open-tab.ts'

export interface AgentTabOptions {
  ck: CanvasKit
  designId: string
  /** The sync server's URL, without the tab's version and design. */
  url: string
  /** A fresh sync token for each connection and each renewal. */
  token: () => Promise<string>
  /** Opens a socket to the sync server: Node's own WebSocket, or a test's. */
  socket: (url: string) => LinkSocket
  /** Where the design's images and the fonts the app does not ship come from. */
  sources: ResourceSources
  /** The brand kit's values, which bound properties take. */
  variables?: Variables
  /** Stops waiting for the server's welcome. */
  signal?: AbortSignal
}

/** The agent tab, open on its design. */
export interface AgentTab {
  /**
   * The session the agent's commands run through: a read-only tab refuses each write by throwing
   * the session's `VIEW_ONLY` refusal. Each step ends with its texts and groups fitted.
   */
  session: Session
  /** The design as the tab holds it now. */
  design(): Design
  /** Whether the tab may only view the design: a view access's, or one whose link stopped. */
  readOnly(): boolean
  /** The fonts, images and brand kit values the tab has, for warnings and renders. */
  bytes(): ResourceBytes
  /** The cache the tab decodes its fonts and images in, for warnings and renders. */
  cache: ResourceCache
  /**
   * Settles once the files of every family the design draws its text in are here, or failed to come: what its
   * warnings read. No image is loaded for them.
   */
  fontsLoaded(): Promise<void>
  /**
   * Settles once the files of every family the design draws its text in and the images the frame draws are here, or
   * failed to come: what its render reads. Images stay as their bytes; the tab decodes none.
   */
  frameLoaded(frameId: string): Promise<void>
  /** What the tab told since the last call, oldest first, at most `KEPT_NOTICES` of the newest. */
  takeNotices(): NoticeDetail[]
  /** How many of the tab's change sets the server has not confirmed: steps not yet stored. */
  unsent(): number
  /** Why the sync server takes nothing more from the tab, if it doesn't. */
  stopped(): Stopped | null
  /** Told once the tab stops, with why. */
  onStopped(listener: (why: Stopped) => void): () => void
  /**
   * Waits up to `CLOSE_WAIT_MS` for the server to confirm the tab's change sets, then ends the core, frees what
   * the tab made and closes the link; again does nothing.
   */
  close(): Promise<void>
}

/** The most notices a tab keeps for the agent to read: the newest. */
export const KEPT_NOTICES = 50
/** How long `close` waits for the server to store the steps it has not confirmed yet. */
export const CLOSE_WAIT_MS = 10_000

/** Names the tab copies, of which an agent tab keeps none (Node has no IndexedDB). */
const NO_MEMBER: Member = { userId: '', workspaceId: '' }
/** The notices that mean nothing to an agent: a tab with no device copy is what every agent tab is. */
const UNTOLD: ReadonlySet<NoticeDetail[0]> = new Set(['noDeviceCopy'])

/** Opens the agent tab once the sync server has welcomed it, with the design's fonts loaded. */
export async function openAgentTab(options: AgentTabOptions): Promise<AgentTab> {
  const { designId, url, token, socket, sources, variables, signal } = options
  const tab = await openTab({ designId, member: NO_MEMBER, url, token, socket, ...(signal ? { signal } : {}) })
  try {
    const fonts = await loadFonts(fontFamilies(readDesign(tab.store), variables), sources)
    return agentTabOn(tab, fonts, options)
  } catch (error) {
    await tab.close()
    throw error
  }
}

/** The core built on the open tab, with the design's own font files, as the agent tab. */
function agentTabOn(
  tab: OpenTab,
  fonts: Awaited<ReturnType<typeof loadFonts>>,
  { ck, designId, sources, variables }: AgentTabOptions,
): AgentTab {
  /** What the tab told and the agent has not read yet. */
  const notices: NoticeDetail[] = []
  /** What the core keeps between designs on a device: here, until the tab closes. */
  const remembered = new Map<string, string>()
  /** Whether `close` has been called. */
  let closed = false

  const cache = resourceCache(ck)
  const ending = new AbortController()
  let built: ReturnType<typeof buildCore>
  try {
    built = buildCore({
      ck,
      cache,
      first: {
        fonts: [...loadFontFiles(), ...fonts].map(({ family, bytes }) => ({ family, bytes })),
        fallbackFamilies: [...FALLBACK_FAMILIES],
        images: {},
        ...(variables ? { variables } : {}),
      },
      firstFaces: fonts.map(({ family, weight, weights, style }) => ({
        family,
        weight,
        ...(weights ? { weights } : {}),
        style,
      })),
      store: tab.store,
      connected: () => tab.link.status() === 'connected',
      remembered: { get: (key) => remembered.get(key) ?? null, set: (key, value) => void remembered.set(key, value) },
      onMac: () => false,
      signal: ending.signal,
      after: (ms, run) => {
        const timer = setTimeout(run, ms)
        return () => clearTimeout(timer)
      },
      access: tab.access,
      linkNotices: tab.linkNotices,
      options: {
        designId,
        frameName: (width, height) => `${width} × ${height}`,
        layerName: (kind) => ({ group: 'Group', maskGroup: 'Mask group', box: 'Box' })[kind],
        radiusLabel: (radius) => `Radius ${radius}`,
        ...sources,
      },
    })
  } catch (error) {
    ending.abort()
    cache.delete()
    throw error
  }
  const { core, modules, sync, session } = built
  const fitting = fittingSession(session, modules.typing.fitText)

  const design = () => session.design()
  const readOnly = () => tab.access.readOnly()
  const bytes = () => modules.resources.bytes()

  const unsent = () => tab.link.client()?.queued() ?? 0
  function stopped(): Stopped | null {
    const status = tab.link.status()
    return status === 'connected' || status === 'disconnected' ? null : status
  }
  async function fontsLoaded() {
    await Promise.all(modules.resources.loadFamilies(fontFamilies(session.design(), bytes().variables)))
  }
  async function frameLoaded(frameId: string) {
    modules.resources.load(session.design(), [frameId])
    await modules.resources.loaded()
  }
  const takeNotices = () => notices.splice(0)
  function onStopped(listener: (why: Stopped) => void) {
    return tab.link.onStatus(() => {
      const why = stopped()
      if (why) listener(why)
    })
  }
  /** Settles once the server has confirmed every change set of the tab, the tab has stopped, or `CLOSE_WAIT_MS` passed. */
  function sent(): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(finish, CLOSE_WAIT_MS)
      const off = tab.link.onStatus(check)
      check()
      function check() {
        if (unsent() === 0 || stopped()) finish()
      }
      function finish() {
        clearTimeout(timer)
        off()
        resolve()
      }
    })
  }

  tab.bind(sync, ending.signal)
  core.setViewport({ width: 0, height: 0, dpr: 1 })
  core.onNotice((...told) => {
    if (UNTOLD.has(told[0])) return
    notices.push(told)
    notices.splice(0, Math.max(0, notices.length - KEPT_NOTICES))
  })

  return {
    session: fitting,
    design,
    readOnly,
    bytes,
    cache,
    fontsLoaded,
    frameLoaded,
    takeNotices,
    unsent,
    stopped,
    onStopped,
    close,
  }

  async function close() {
    if (closed) return
    closed = true
    await sent()
    ending.abort()
    cache.delete()
    await tab.close()
  }
}

/**
 * `session`, with each step it runs (a command, a gesture or a batch not inside an open gesture)
 * ending, in the same step, with the texts it added or changed the size of fitted to their words,
 * which fits the groups around them, and the groups around the other layers it changed or took out
 * fitted to what they hold: what the editor runs after its own edits.
 */
function fittingSession(session: Session, fitText: (id: string) => void): Session {
  /** Runs `steps` as one gesture named `name` that ends with what it changed fitted. */
  function fitted<T>(name: StepName | null, steps: () => T): T {
    const before = { ...session.design().nodes }
    return session.gesture(name, () => {
      const result = steps()
      fitChanged(session, before, fitText)
      return result
    })
  }

  return {
    ...session,
    run: (name, input) =>
      session.inGesture() ? session.run(name, input) : fitted(null, () => session.run(name, input)),
    gesture<T>(...args: [steps: () => T] | [name: StepName | null, steps: () => T]): T {
      const [name, steps] = args.length === 2 ? args : [null, args[0]]
      return session.inGesture() ? session.gesture(name, steps) : fitted(name, steps)
    },
    batch<T>(...args: [steps: () => T] | [name: StepName | null, steps: () => T]): T {
      const [name, steps] = args.length === 2 ? args : [null, args[0]]
      return session.inGesture() ? session.batch(name, steps) : fitted(name, () => session.batch(name, steps))
    },
    beginGesture(name) {
      if (session.inGesture()) return session.beginGesture(name)
      const before = { ...session.design().nodes }
      const step = session.beginGesture(name)
      return {
        end() {
          if (session.inGesture()) fitChanged(session, before, fitText)
          step.end()
        },
        cancel: step.cancel,
      }
    },
  }
}

/**
 * Fits what changed since `before`: each text added, or whose words or what sizes them changed, to
 * its words (and the groups around it), then the groups around every other layer added or changed,
 * and those that held a layer taken out.
 */
function fitChanged(session: Session, before: Readonly<Record<string, Layer>>, fitText: (id: string) => void) {
  const now = session.design().nodes
  const texts: string[] = []
  const others: string[] = []
  for (const [id, layer] of Object.entries(now)) {
    const was = before[id]
    if (layer === was) continue
    if (layer.type === 'text' && sizesChanged(was, layer)) texts.push(id)
    else others.push(id)
  }
  // The groups a layer left, taken out or moved elsewhere, fit what they still hold.
  for (const [id, was] of Object.entries(before)) {
    if (now[id]?.parentId !== was.parentId && now[was.parentId]) others.push(was.parentId)
  }
  for (const id of texts) fitText(id)
  hug(session, others)
}

/** Whether a text's size may differ from `was`'s: it is new, or what sizes its words changed. */
function sizesChanged(was: Layer | undefined, layer: Extract<Layer, { type: 'text' }>) {
  if (was?.type !== 'text' || !sameValue(was.bindings, layer.bindings)) return true
  const [from, to] = [was.props as Record<string, unknown>, layer.props as Record<string, unknown>]
  return [...SIZES_TEXT].some((key) => !sameValue(from[key], to[key]))
}
