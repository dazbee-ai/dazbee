// The session's design (ADR-0019): the one agent tab an MCP session holds open, joined to the sync server on its
// private address with sync tokens asked with the newest access token the session has seen, its fonts and images
// read through the API. Its link may end while the agent pauses past its access token's hour; the next call opens
// the design again in a new tab, whose undo starts empty. A link that ends for good closes the tab, and the next
// call says why. The process holds a few agent tabs at most, and an access fewer: an MCP session of the access
// that opens a design past those takes over the access's oldest tab once its own has opened, and that tab's next
// call says it was replaced; never while the oldest holds steps the server hasn't stored.
import { type AgentTab, type AgentTabOptions, openAgentTab, TabStopped } from '@dazbee/editor/agent-tab'
import { loadCanvasKit } from '@dazbee/renderer/node'
import { type AgentMe, type BrandKit, brandVariables, type DesignSummary } from '@dazbee/schema'

import { type AgentApi, agentApi, ApiRefusal, type ApiSettings, TokenRefused } from './api.ts'
import { MAX_DESIGN_CALLS_WAITING, OPEN_DESIGN_TIMEOUT_MS } from './limits.ts'
import { type StoreWait, type Written, written } from './store-wait.ts'
import { ToolRefusal } from './tools/define-tool.ts'

/** Where the sync server is, and what opens a socket to it: Node's own WebSocket unless a test gives another. */
export interface SyncSettings {
  /** The sync server's private address, without a trailing slash. */
  url: string
  socket?: AgentTabOptions['socket']
}

/** The process's agent tabs, counted, so that agents can't open more than the server holds. */
export interface AgentTabSlots {
  /**
   * Reserves a slot for one of the access's tabs while it opens, or gives why there is none, as the agent is told.
   * When the access holds all it may, the slot takes over the oldest once held, if `takesOver`; a tab opened again
   * after a pause doesn't, and is told its design was opened in another session.
   */
  take(accessId: string, holder: SlotHolder, takesOver: boolean): AgentTabSlot | string
}

/** The tab a slot is for, as the slots ask it. */
export interface SlotHolder {
  /** Runs once a newer tab of the access takes the slot over. */
  onTakenOver(): void
  /** How many of the tab's steps the server hasn't stored: a tab holding any is never taken over. */
  unsent(): number
}

/** One tab's slot. */
export interface AgentTabSlot {
  /**
   * Holds the reserved slot once its tab has opened, taking over the access's oldest when it holds all it may; or
   * gives why it can't, as `take` does.
   */
  hold(): string | undefined
  /** Lets the slot go, once its tab closes; nothing once let go. */
  release(): void
  /** Whether a newer tab of the access took the slot over. */
  takenOver(): boolean
}

/** What a session's design is opened with. */
export interface DesignSettings {
  api: ApiSettings
  sync: SyncSettings
  slots: AgentTabSlots
  /** The clock sync tokens expire by. */
  now: () => number
  /** How long a step waits for the sync server to store it, and the clock that waits. */
  storeWait: StoreWait
}

/** The MCP session the design is opened for. */
export interface DesignCaller {
  agent: AgentMe
  /** The newest access token the session has seen. */
  token(): string
  /** The agent's name, which the design shows its tab as. */
  agentName(): string
}

/** One tool call on the design: the API as its token sees it, and the access as the API gave it for the call. */
export interface DesignCall {
  api: AgentApi
  agent: AgentMe
}

/** The open design: its tab, its name and its brand's kit, and what the agent is to be told of it first. */
export interface OpenDesign {
  tab: AgentTab
  name: string
  kit: BrandKit
  /** An image asset's stored bytes, read through the API for the design's brand and kept by no one. */
  imageBytes(assetId: string): Promise<Uint8Array>
  /** Sentences for the agent: that the design was opened again, when it was. */
  notes: string[]
  /**
   * Runs `step` on the tab, answering once the sync server has stored the change sets it made, or why not, waiting
   * at most until `answerBy`; refused without running when that time has come.
   */
  write<T>(step: () => T, answerBy: number): Promise<Written<T>>
}

/**
 * The session's design. Each call waits for the one before it, and the tab closes only between calls, so a call's
 * work never runs on a closed tab. A few calls wait at most; once the session ended, it takes none.
 */
export interface SessionDesign {
  /** Opens the brand's design in a new agent tab, closing the one open before, and runs `work` on it. */
  open<T>(brandId: string, designId: string, call: DesignCall, work: (design: OpenDesign) => T | Promise<T>): Promise<T>
  /**
   * Runs `work` on the open design: opened again, with a note, when its link ended while the agent's token had
   * expired. A tool refusal says why it was closed for good, or that none is open.
   */
  use<T>(call: DesignCall, work: (design: OpenDesign) => T | Promise<T>): Promise<T>
  /**
   * Closes the open design's tab once the calls before are over, letting its slot go, and answers whether a design
   * was open; the session may open another.
   */
  close(): Promise<boolean>
  /** Ends with the session: closes the open design's tab, once the server has stored what it sent; no call is taken after. */
  end(): Promise<void>
}

/** The session's design, at each point. */
type State =
  | { kind: 'none' }
  | { kind: 'open'; brandId: string; designId: string; name: string; kit: BrandKit; tab: AgentTab; slot: AgentTabSlot }
  | { kind: 'paused'; brandId: string; designId: string }
  | { kind: 'ended'; why: string }

/** A slot of an access's: its tab, whether that tab may take over the access's oldest, and where the slot is. */
interface HeldSlot {
  holder: SlotHolder
  takesOver: boolean
  state: 'opening' | 'held' | 'takenOver' | 'released'
}

/** What the agent is told when the design is opened again. */
export const REOPENED =
  'The design was opened again, since its connection ended while this agent was away: the steps before can no longer be undone'

/** Why a design closed for good, by why its tab stopped. */
const STOPPED: Record<NonNullable<ReturnType<AgentTab['stopped']>>, string> = {
  Deleted: 'The design was deleted, so it is closed; open another with open_design',
  Outdated:
    'The design was saved by a newer version of Dazbee than this server runs, so it is closed; try again in a few minutes',
  Replaced: 'The design was opened again in another session of this agent, so it is closed here',
  NoAccess: 'This agent may no longer open the design, so it is closed',
}
/** Why there is no slot for a tab, when the process holds all it may. */
const FULL = 'Dazbee has as many designs open for agents as it can hold; try again in a minute'
/** Why a tab can't take over the access's oldest: that one holds steps the server hasn't stored. */
const UNSENT =
  'This agent’s design in another session holds steps Dazbee hasn’t stored yet; try again once they are stored'

/** The refusal of a call on the session's design when none is open, saying why: never opened, or closed for good. */
export class NoDesignOpen extends ToolRefusal {}

/**
 * At most `max` tabs in the process, and `perAccess` of one access: a tab past those of its access takes over the
 * access's oldest once it has opened. Until the oldest closes, both are counted, so taking over may pass `max` for as
 * long as the old tab takes to close.
 */
export function agentTabSlots(max: number, perAccess: number): AgentTabSlots {
  /** Each access's slots, in the order taken. */
  const slots = new Map<string, HeldSlot[]>()
  /** The slots of all accesses, each counted until let go. */
  let total = 0

  function take(accessId: string, holder: SlotHolder, takesOver: boolean): AgentTabSlot | string {
    const full = oldestPast(accessId)
    if (full && !takesOver) return STOPPED.Replaced
    if (full && full.holder.unsent() > 0) return UNSENT
    if (!full && total >= max) return FULL
    const slot: HeldSlot = { holder, takesOver, state: 'opening' }
    slots.set(accessId, [...(slots.get(accessId) ?? []), slot])
    total++
    return {
      hold: () => hold(accessId, slot),
      release: () => release(accessId, slot),
      takenOver: () => slot.state === 'takenOver',
    }
  }

  /** Holds `slot`, taking over the access's oldest when it holds all it may; or why it can't. */
  function hold(accessId: string, slot: HeldSlot): string | undefined {
    const oldest = oldestPast(accessId)
    if (oldest && !slot.takesOver) return STOPPED.Replaced
    if (oldest && oldest.holder.unsent() > 0) return UNSENT
    if (oldest) {
      oldest.state = 'takenOver'
      oldest.holder.onTakenOver()
    }
    slot.state = 'held'
    return undefined
  }

  /** The access's oldest held slot, when it holds all it may; a slot opening or taken over doesn't count. */
  function oldestPast(accessId: string): HeldSlot | undefined {
    const held = (slots.get(accessId) ?? []).filter(({ state }) => state === 'held')
    return held.length >= perAccess ? held[0] : undefined
  }

  /** Lets `slot` go. */
  function release(accessId: string, slot: HeldSlot) {
    if (slot.state === 'released') return
    slot.state = 'released'
    total--
    const left = (slots.get(accessId) ?? []).filter((other) => other !== slot)
    if (left.length === 0) slots.delete(accessId)
    else slots.set(accessId, left)
  }

  return { take }
}

/** The design an MCP session holds open, for `caller`. */
export function sessionDesign(settings: DesignSettings, caller: DesignCaller): SessionDesign {
  /** The open design, or why there is none. */
  let state: State = { kind: 'none' }
  /** The last call running or waiting, which the next waits for. */
  let running: Promise<unknown> = Promise.resolve()
  /** How many calls are running or waiting. */
  let waiting = 0
  /** Whether the session ended, closing its design for good. */
  let ended = false

  /**
   * The session's tab, as its slot asks it: told when a newer tab takes the slot over, so that the next call, or the
   * end of the calls before, closes it; and how many of its steps the server hasn't stored.
   */
  const holder: SlotHolder = {
    onTakenOver: () => afterCalls(replaced),
    unsent: () => (state.kind === 'open' ? state.tab.unsent() : 0),
  }

  /** Runs `work` once the calls before it are over; refused when too many wait, or once the session ended. */
  function inTurn<T>(work: () => Promise<T>): Promise<T> {
    if (ended) return Promise.reject(new ToolRefusal('This session has ended; start a new one'))
    if (waiting >= MAX_DESIGN_CALLS_WAITING)
      return Promise.reject(
        new ToolRefusal('Other calls on the open design are still being answered; wait for their answers first'),
      )
    waiting++
    const next = running.then(work, work).finally(() => waiting--)
    running = next.catch(() => undefined)
    return next
  }

  /** Runs `work` once the calls before it are over, never refused: what the tab's link asks. */
  function afterCalls(work: () => Promise<void>) {
    running = running.then(work, work).catch(() => undefined)
  }

  /** The API as the session's newest token sees it, for what the tab asks while no call waits on it. */
  function newestApi(): AgentApi {
    return agentApi(settings.api, caller.token(), caller.agent.workspaceId, () => {})
  }

  /** The brand's design as the API lists it, refused when the access doesn't see it. */
  async function designOf(api: AgentApi, brandId: string, designId: string): Promise<DesignSummary> {
    const summary = (await api.designs(brandId)).find(({ id }) => id === designId)
    if (!summary) throw new ToolRefusal(`There is no design “${designId}” in this brand; list_designs names them`)
    return summary
  }

  /** The open design on `tab`, as a call works on it. */
  function openDesign(tab: AgentTab, brandId: string, name: string, kit: BrandKit, notes: string[]): OpenDesign {
    return {
      tab,
      name,
      kit,
      notes,
      imageBytes: imagesOf(brandId),
      write: (step, answerBy) => write(tab, step, answerBy),
    }
  }

  /** Runs `step` on `tab`, waiting for the store at most until `answerBy`. */
  function write<T>(tab: AgentTab, step: () => T, answerBy: number) {
    const ms = Math.min(settings.storeWait.ms, answerBy - settings.now())
    if (ms <= 0)
      throw new ToolRefusal('This call waited too long behind others on the open design, so nothing ran; try it again')
    return written(tab, step, { ...settings.storeWait, ms })
  }

  /**
   * Opens the design in a new tab, in a slot of its own, and makes it the open one; taking over the access's oldest
   * tab when the access holds all it may, if `takesOver`.
   */
  async function start(
    summary: DesignSummary,
    api: AgentApi,
    notes: string[],
    takesOver: boolean,
  ): Promise<OpenDesign> {
    const { brandId, id: designId, name } = summary
    const slot = settings.slots.take(caller.agent.id, holder, takesOver)
    if (typeof slot === 'string') throw refusalOf(slot)
    try {
      const [first, kit] = await Promise.all([
        api.syncToken(brandId, designId, caller.agentName()),
        api.brandKit(brandId),
      ])
      const tab = await joinTab(brandId, designId, first, kit)
      const refused = slot.hold()
      if (refused) {
        await tab.close()
        throw refusalOf(refused)
      }
      state = { kind: 'open', brandId, designId, name, kit, tab, slot }
      const why = tab.stopped()
      if (why) await endTab(tab, STOPPED[why])
      else tab.onStopped((stopped) => afterCalls(() => endTab(tab, STOPPED[stopped])))
      return openDesign(tab, brandId, name, kit, notes)
    } catch (error) {
      slot.release()
      if (error instanceof TabStopped) throw new ToolRefusal(STOPPED[error.state])
      throw error
    }
  }

  /**
   * The agent tab on the design, its first sync token given; later ones are asked with the newest access token.
   * An access token refused once the sync token in hand has expired pauses the design; an answer that the design
   * is gone, or out of the access's reach, ends it.
   */
  async function joinTab(
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
        const fresh = await newestApi().syncToken(brandId, designId, caller.agentName())
        expiresAt = Date.parse(fresh.expiresAt)
        return fresh.token
      } catch (error) {
        const tab = opened
        if (tab && error instanceof TokenRefused && settings.now() >= expiresAt) afterCalls(() => pause(tab))
        else if (tab && error instanceof ApiRefusal && (error.status === 403 || error.status === 404))
          afterCalls(() => endTab(tab, STOPPED.NoAccess))
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

  /** The brand's image assets' bytes, read with the session's newest token. */
  function imagesOf(brandId: string) {
    return (assetId: string) => newestApi().assetBytes(brandId, assetId)
  }

  /** Where the tab's fonts and images come from: the brand's, through the API. */
  function sourcesOf(brandId: string): AgentTabOptions['sources'] {
    return {
      assetBytes: imagesOf(brandId),
      fontFaces: async (families) =>
        (await newestApi().fonts(brandId)).filter(({ family }) => families.includes(family)).flatMap((f) => f.faces),
      fontFile: (face) => newestApi().fontBytes(brandId, face.id),
    }
  }

  /**
   * The tab's link ended while the agent's token had expired: the next call opens the design again. A tab holding
   * steps the server hasn't stored stays, its link trying again, so they go once the agent is back.
   */
  async function pause(tab: AgentTab) {
    if (state.kind !== 'open' || state.tab !== tab || tab.unsent() > 0) return
    const { brandId, designId, slot } = state
    state = { kind: 'paused', brandId, designId }
    slot.release()
    await tab.close()
  }

  /** A newer tab of the access took the open tab's slot over: the next call says the design was opened elsewhere. */
  async function replaced() {
    if (state.kind === 'open' && state.slot.takenOver()) await endTab(state.tab, STOPPED.Replaced)
  }

  /** The tab's link ended for good: the next call says `why`. */
  async function endTab(tab: AgentTab, why: string) {
    if (state.kind !== 'open' || state.tab !== tab) return
    state.slot.release()
    state = { kind: 'ended', why }
    await tab.close()
  }

  /** Closes the open tab, if any, and forgets the design. */
  async function closeTab() {
    const was = state
    state = { kind: 'none' }
    if (was.kind !== 'open') return
    was.slot.release()
    await was.tab.close()
  }

  /** The open design, opened again when it was paused; closed when the call's access no longer sees its brand. */
  async function current({ api, agent }: DesignCall): Promise<OpenDesign> {
    await replaced()
    const was = state
    if (was.kind === 'open' && agent.brandIds !== null && !agent.brandIds.includes(was.brandId))
      await endTab(was.tab, STOPPED.NoAccess)
    const now = state
    if (now.kind === 'open') return openDesign(now.tab, now.brandId, now.name, now.kit, [])
    if (now.kind === 'ended') {
      state = { kind: 'none' }
      throw new NoDesignOpen(now.why)
    }
    if (now.kind === 'none') throw new NoDesignOpen('No design is open; call open_design first')
    state = { kind: 'none' }
    try {
      return await start(await designOf(api, now.brandId, now.designId), api, [REOPENED], false)
    } catch (error) {
      // Still away from its design, unless another session opened it since: the next call tries again.
      if (state.kind === 'none' && !(error instanceof NoDesignOpen)) state = now
      throw error
    }
  }

  function open<T>(
    brandId: string,
    designId: string,
    { api }: DesignCall,
    work: (design: OpenDesign) => T | Promise<T>,
  ) {
    return inTurn(async () => {
      const summary = await designOf(api, brandId, designId)
      await closeTab()
      return work(await start(summary, api, [], true))
    })
  }

  function use<T>(call: DesignCall, work: (design: OpenDesign) => T | Promise<T>) {
    return inTurn(async () => work(await current(call)))
  }

  function close() {
    return inTurn(async () => {
      const wasOpen = state.kind === 'open' || state.kind === 'paused'
      await closeTab()
      return wasOpen
    })
  }

  async function end() {
    if (ended) return
    ended = true
    const last = running.then(closeTab, closeTab)
    running = last.catch(() => undefined)
    await last
  }

  return { open, use, close, end }
}

/** A slot's refusal as a tool's: the design opened in another session leaves none open here. */
function refusalOf(why: string): ToolRefusal {
  return why === STOPPED.Replaced ? new NoDesignOpen(why) : new ToolRefusal(why)
}
