// The agent tabs the MCP server holds (ADR-0019), counted for the process and for each agent access. A tab opening
// past its access's count takes over the access's oldest once it has opened, unless that one holds steps the sync
// server hasn't stored; the process's count refuses one past it.
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

/** A slot of an access's: its tab, whether that tab may take over the access's oldest, and where the slot is. */
interface HeldSlot {
  holder: SlotHolder
  takesOver: boolean
  state: 'opening' | 'held' | 'takenOver' | 'released'
}

/** What the agent is told when another session of the access took the design's tab over. */
export const REPLACED = 'The design was opened again in another session of this agent, so it is closed here'
/** Why there is no slot for a tab, when the process holds all it may. */
const FULL = 'Dazbee has as many designs open for agents as it can hold; try again in a minute'
/** Why a tab can't take over the access's oldest: that one holds steps the server hasn't stored. */
const UNSENT =
  'This agent’s design in another session holds steps Dazbee hasn’t stored yet; try again once they are stored'

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
    if (full && !takesOver) return REPLACED
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
    if (oldest && !slot.takesOver) return REPLACED
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
