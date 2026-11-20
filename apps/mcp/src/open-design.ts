// The session's design (ADR-0019): the one agent tab an MCP session holds open, joined to the sync server on its
// private address with sync tokens asked with the newest access token the session has seen, its fonts and images
// read through the API. Its link may end while the agent pauses past its access token's hour; the next call opens
// the design again in a new tab, whose undo starts empty. A link that ends for good closes the tab, and the next
// call says why. The process holds a few agent tabs at most, and an access fewer.
import { type AgentTab, type AgentTabOptions, openAgentTab, TabStopped } from '@dazbee/editor/agent-tab'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type AgentMe, type BrandKit, brandVariables } from '@dazbee/schema'

import { type AgentApi, agentApi, ApiRefusal, type ApiSettings, TokenRefused } from './api.ts'
import { MAX_AGENT_TABS, MAX_AGENT_TABS_PER_ACCESS, OPEN_DESIGN_TIMEOUT_MS } from './limits.ts'
import { ToolRefusal } from './tools/define-tool.ts'

/** Where the sync server is, and what opens a socket to it: Node's own WebSocket unless a test gives another. */
export interface SyncSettings {
  /** The sync server's private address, without a trailing slash. */
  url: string
  socket?: AgentTabOptions['socket']
}

/** The process's agent tabs, counted, so that agents can't open more than the server holds. */
export interface AgentTabSlots {
  /** Takes a slot for one of the access's tabs, giving what lets it go; or why there is none. */
  take(accessId: string): (() => void) | 'full' | 'accessFull'
}

/** What a session's design is opened with. */
export interface DesignSettings {
  api: ApiSettings
  sync: SyncSettings
  slots: AgentTabSlots
  /** The clock sync tokens expire by. */
  now: () => number
}

/** The MCP session the design is opened for. */
export interface DesignCaller {
  agent: AgentMe
  /** The newest access token the session has seen. */
  token(): string
  /** The agent's name, which the design shows its tab as. */
  agentName(): string
}

/** The open design: its tab, its name and its brand's kit, and what the agent is to be told of it first. */
export interface OpenDesign {
  tab: AgentTab
  name: string
  kit: BrandKit
  /** Sentences for the agent: that the design was opened again, when it was. */
  notes: string[]
}

/**
 * The session's design. Each call waits for the one before it, and the tab closes only between calls, so a call's
 * work never runs on a closed tab.
 */
export interface SessionDesign {
  /** Opens the brand's design in a new agent tab, closing the one open before, and runs `work` on it; `api` is the call's. */
  open<T>(brandId: string, designId: string, api: AgentApi, work: (design: OpenDesign) => T | Promise<T>): Promise<T>
  /**
   * Runs `work` on the open design: opened again, with a note, when its link ended while the agent's token had
   * expired. A tool refusal says why it was closed for good, or that none is open.
   */
  use<T>(api: AgentApi, work: (design: OpenDesign) => T | Promise<T>): Promise<T>
  /** Closes the open design's tab. */
  close(): Promise<void>
}

/** What the agent is told when the design is opened again. */
export const REOPENED =
  'The design was opened again, since its connection ended while this agent was away: the steps before can no longer be undone'

/** The session's design, at each point. */
type State =
  | { kind: 'none' }
  | { kind: 'open'; brandId: string; designId: string; name: string; kit: BrandKit; tab: AgentTab; release: () => void }
  | { kind: 'paused'; brandId: string; designId: string }
  | { kind: 'ended'; why: string }

/** Why a design closed for good, by why its tab stopped. */
const STOPPED: Record<NonNullable<ReturnType<AgentTab['stopped']>>, string> = {
  Deleted: 'The design was deleted, so it is closed; open another with open_design',
  Outdated:
    'The design was saved by a newer version of Dazbee than this server runs, so it is closed; try again in a few minutes',
  Replaced: 'The design was opened again in another session of this agent, so it is closed here',
  NoAccess: 'This agent may no longer open the design, so it is closed',
}
/** Why there is no slot for a tab. */
const BUSY = {
  full: 'Dazbee has as many designs open for agents as it can hold; try again in a minute',
  accessFull: `This agent already has ${MAX_AGENT_TABS_PER_ACCESS} designs open in other sessions; end one of those sessions, or try again once one has ended`,
}

/** At most `max` tabs in the process, and `perAccess` of one access. */
export function agentTabSlots(max = MAX_AGENT_TABS, perAccess = MAX_AGENT_TABS_PER_ACCESS): AgentTabSlots {
  // The tabs open, by access.
  const open = new Map<string, number>()
  let total = 0

  function take(accessId: string) {
    const ofAccess = open.get(accessId) ?? 0
    if (ofAccess >= perAccess) return 'accessFull' as const
    if (total >= max) return 'full' as const
    open.set(accessId, ofAccess + 1)
    total++
    let released = false
    return () => {
      if (released) return
      released = true
      total--
      const left = (open.get(accessId) ?? 1) - 1
      if (left === 0) open.delete(accessId)
      else open.set(accessId, left)
    }
  }

  return { take }
}

/** The design an MCP session holds open, for `caller`. */
export function sessionDesign(settings: DesignSettings, caller: DesignCaller): SessionDesign {
  let state: State = { kind: 'none' }
  // The call running, which the next waits for.
  let running: Promise<unknown> = Promise.resolve()

  /** Runs `work` once the calls before it are over. */
  function inTurn<T>(work: () => Promise<T>): Promise<T> {
    const next = running.then(work, work)
    running = next.catch(() => undefined)
    return next
  }

  /** The API as the session's newest token sees it, for what the tab asks while no call waits on it. */
  function background(): AgentApi {
    return agentApi(settings.api, caller.token(), caller.agent.workspaceId, () => {})
  }

  /** Opens the design in a new tab, in a slot of its own, and makes it the open one. */
  async function start(brandId: string, designId: string, api: AgentApi, notes: string[]): Promise<OpenDesign> {
    const release = settings.slots.take(caller.agent.id)
    if (typeof release === 'string') throw new ToolRefusal(BUSY[release])
    try {
      const summary = (await api.designs(brandId)).find(({ id }) => id === designId)
      if (!summary) throw new ToolRefusal(`There is no design “${designId}” in this brand; list_designs names them`)
      const [first, kit] = await Promise.all([
        api.syncToken(brandId, designId, caller.agentName()),
        api.brandKit(brandId),
      ])
      const tab = await openTab(brandId, designId, first, kit)
      state = { kind: 'open', brandId, designId, name: summary.name, kit, tab, release }
      const why = tab.stopped()
      if (why) await end(tab, STOPPED[why])
      else tab.onStopped((stopped) => void inTurn(() => end(tab, STOPPED[stopped])))
      return { tab, name: summary.name, kit, notes }
    } catch (error) {
      release()
      if (error instanceof TabStopped) throw new ToolRefusal(STOPPED[error.state])
      throw error
    }
  }

  /**
   * The agent tab on the design, its first sync token given; later ones are asked with the newest access token.
   * An access token refused once the sync token in hand has expired pauses the design; an answer that the design
   * is gone, or out of the access's reach, ends it.
   */
  async function openTab(
    brandId: string,
    designId: string,
    first: { token: string; expiresAt: string },
    kit: BrandKit,
  ): Promise<AgentTab> {
    let expiresAt = Date.parse(first.expiresAt)
    let given = false
    let opened: AgentTab | undefined
    const token = async () => {
      if (!given) {
        given = true
        return first.token
      }
      try {
        const fresh = await background().syncToken(brandId, designId, caller.agentName())
        expiresAt = Date.parse(fresh.expiresAt)
        return fresh.token
      } catch (error) {
        const tab = opened
        if (tab && error instanceof TokenRefused && settings.now() >= expiresAt) void inTurn(() => pause(tab))
        else if (tab && error instanceof ApiRefusal && (error.status === 403 || error.status === 404))
          void inTurn(() => end(tab, STOPPED.NoAccess))
        throw error
      }
    }
    const waited = AbortSignal.timeout(OPEN_DESIGN_TIMEOUT_MS)
    try {
      opened = await openAgentTab({
        ck: await loadCanvasKit(),
        designId,
        url: settings.sync.url,
        token,
        socket:
          settings.sync.socket ?? ((url) => new WebSocket(url) as unknown as ReturnType<AgentTabOptions['socket']>),
        sources: sourcesOf(brandId),
        variables: brandVariables(kit),
        signal: waited,
      })
    } catch (error) {
      if (waited.aborted)
        throw new ToolRefusal(
          `The design didn’t open within ${OPEN_DESIGN_TIMEOUT_MS / 1000} seconds; try again in a moment`,
        )
      throw error
    }
    return opened
  }

  /** Where the tab's fonts and images come from: the brand's, through the API. */
  function sourcesOf(brandId: string): AgentTabOptions['sources'] {
    return {
      assetBytes: (assetId) => background().assetBytes(brandId, assetId),
      fontFiles: async (families) => {
        const api = background()
        const faces = (await api.fonts(brandId))
          .filter(({ family }) => families.includes(family))
          .flatMap((f) => f.faces)
        return Promise.all(
          faces.map(async ({ id, family, weight, weights, style }) => ({
            family,
            weight,
            ...(weights ? { weights } : {}),
            style,
            bytes: await api.fontBytes(brandId, id),
          })),
        )
      },
    }
  }

  /** The tab's link ended while the agent's token had expired: the next call opens the design again. */
  async function pause(tab: AgentTab) {
    if (state.kind !== 'open' || state.tab !== tab) return
    const { brandId, designId, release } = state
    state = { kind: 'paused', brandId, designId }
    release()
    await tab.close()
  }

  /** The tab's link ended for good: the next call says `why`. */
  async function end(tab: AgentTab, why: string) {
    if (state.kind !== 'open' || state.tab !== tab) return
    state.release()
    state = { kind: 'ended', why }
    await tab.close()
  }

  /** The open design, opened again when it was paused. */
  async function current(api: AgentApi): Promise<OpenDesign> {
    const now = state
    if (now.kind === 'open') return { tab: now.tab, name: now.name, kit: now.kit, notes: [] }
    if (now.kind === 'ended') {
      state = { kind: 'none' }
      throw new ToolRefusal(now.why)
    }
    if (now.kind === 'none') throw new ToolRefusal('No design is open; call open_design first')
    state = { kind: 'none' }
    try {
      return await start(now.brandId, now.designId, api, [REOPENED])
    } catch (error) {
      // Still away from its design: the next call tries again.
      if (state.kind === 'none') state = now
      throw error
    }
  }

  /** Closes the open tab, if any, and forgets the design. */
  async function closeTab() {
    const was = state
    state = { kind: 'none' }
    if (was.kind !== 'open') return
    was.release()
    await was.tab.close()
  }

  return {
    open: (brandId, designId, api, work) =>
      inTurn(async () => {
        await closeTab()
        return work(await start(brandId, designId, api, []))
      }),
    use: (api, work) => inTurn(async () => work(await current(api))),
    close: () => inTurn(closeTab),
  }
}
