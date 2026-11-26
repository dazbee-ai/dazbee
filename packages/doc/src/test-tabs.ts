// Seeded random walks of several tabs on one design: each tab is a plain store (client-store.ts) on
// a client of the sync core's simulator (sync/test-sim.ts), whose messages arrive late, in order on
// each link, and are lost with a dropped connection, over a server that restarts and a journal
// whose writes are slow and fail. A tab takes the session steps of test-walk.ts from its own
// design, and leaves drags open while messages arrive. As the editor fits texts and groups right
// after each command, in the same step, the tab's session writes the derived values over what each
// command wrote (derived-values.ts); its client brings them up to date after crossing edits. The
// walk checks every tab after each delivery, and whenever nothing is in flight that the tabs and
// the server hold one design (G1), that no undo changed what another tab wrote after it (G2), and
// that every derived box is current (G4, I11); at its end, that every tab undoing everything loses
// nothing (G3).
import type { Change, Design, DesignInput, DesignRecords } from '@dazbee/schema'

import { type ClientStore, clientStore } from './client-store.ts'
import { CommandError } from './commands/define.ts'
import { derivedValues, type FitText } from './derived-values.ts'
import { fittedText } from './fitted-text.ts'
import type { GestureStep, Session } from './session.ts'
import { readDesign } from './store.ts'
import { type RecordKey, recordKey } from './sync/changes.ts'
import type { Client } from './sync/client.ts'
import { DesignState, type ReadState } from './sync/state.ts'
import { openSim, type Sim, type SimOptions } from './sync/test-sim.ts'
import { kindsDesign, linkedDesign, openTestSession, testDesign } from './test-design.ts'
import { Gone } from './test-gone.ts'
import { brokenInvariants, expectFullRead } from './test-invariants.ts'
import { testMeasure } from './test-measure.ts'
import {
  FAULT_STEPS,
  GESTURE_STEPS,
  type Kinds,
  seeded,
  SESSION_STEPS,
  type Step,
  type Tab,
  takeSessionStep,
  type Walk,
} from './test-walk.ts'

/** A tab of the walk: a session on the store of one of the simulator's clients. */
export interface SimTab extends Tab {
  store: ClientStore
  name: string
  /** The drag it has open, if any: its own steps go on with it until it ends or is cancelled. */
  drag?: GestureStep | undefined
}

/** The tabs of a walk, on the simulator, and the design they started from. */
export interface Tabs {
  sim: Sim
  tabs: SimTab[]
  start: Design
  /** Whether tabs drop their connections and come back in this walk. */
  drops: boolean
  /** Whether the server restarts in this walk. */
  restarts: boolean
  /** The layers each tab's steps wrote: the other tabs' inputs pick them first. */
  wrote: Set<string>[]
  /** How many undo steps each tab's client ended: at least as many as it could ever undo or redo. */
  made: number[]
  /** What the end checks let stay gone. */
  gone: Gone
}

/**
 * How the simulator under `tabsOn`'s tabs runs: one message at a time, each a tick late, unless
 * given. Without `followUps`, the tabs' clients never bring derived values up to date after
 * crossing edits.
 */
export type TabsOptions = Partial<Omit<SimOptions, 'tabs' | 'design' | 'recompute'>> & { followUps?: boolean }

/** What the end checks found once every tab undid every step and everything was delivered. */
export interface EndChecks {
  /** (a) The parts the read leaves out. */
  leftOut: string[]
  /** (b) What the read repairs. */
  repaired: string[]
  /** (c) The pages, frames, layers, sections and connectors from before the walk that the design no longer has. */
  missing: string[]
}

/** A text fitted to its words with the test measure, as the editor fits one with fonts. */
export const testFit: FitText = (layer) => fittedText(layer, testMeasure)

/** Dazbee's derived values with the test measure, as each tab and the walk's checks work them out. */
export const DERIVED = derivedValues(testFit)

/**
 * The steps of the walk: a tab's own (test-walk.ts's, and drags), deliveries of messages, a tab
 * dropping its connection or coming back, the server restarting, and delivering everything.
 */
export const TAB_STEPS: Kinds = {
  ...SESSION_STEPS,
  ...FAULT_STEPS,
  ...GESTURE_STEPS,
  drag: 3,
  deliver: 10,
  link: 1,
  restart: 1,
  sync: 1,
}

/** The designs a walk starts from, by its seed. */
const DESIGNS: readonly (() => DesignInput)[] = [kindsDesign, linkedDesign, testDesign]
const NAMES = ['A', 'B', 'C', 'D', 'E', 'F']
/** Slow journal writes, some failing, for the walks whose server restarts. */
const STORAGE = { lostWrite: 0.03, crashAfterStore: 0.03, maxLatency: 8 }
/** The most messages delivered before a walk gives up on things ever settling. */
const MOST_DELIVERIES = 100_000
/** The most rounds of every tab undoing what it can before a walk gives up on undo ever running out. */
const MOST_ROUNDS = 100

/**
 * The walk of `count` tabs: each of its steps is one tab's own step, a delivery, a connection
 * dropped or back, a restart, or a delivery of everything; at its end, the end checks find nothing.
 */
export function tabsWalk(count: number): Walk<Tabs> {
  return {
    kinds: TAB_STEPS,
    open: (seed) => openTabs(seed, count),
    take: takeTabStep,
    end: async (world) => {
      const { leftOut, repaired, missing } = await endChecks(world)
      if (leftOut.length > 0) throw new Error(`(a) the read leaves parts out: ${leftOut.join('; ')}`)
      if (repaired.length > 0) throw new Error(`(b) the read repairs the design: ${repaired.join('; ')}`)
      if (missing.length > 0) throw new Error(`(c) parts from before the walk are gone: ${missing.join(', ')}`)
    },
    close: closeTabs,
  }
}

/**
 * `count` tabs on the design for `seed`. The seed sets how late messages arrive, whether tabs drop
 * their connections (every third seed), whether the server keeps a log so short that a tab coming
 * back catches up with the whole design (every fourth), and whether the journal is slow and fails
 * and the server restarts (every fifth). Without `followUps`, the tabs' clients never bring derived
 * values up to date after crossing edits.
 */
export async function openTabs(seed: number, count: number, { followUps = true } = {}): Promise<Tabs> {
  const design = (DESIGNS[seed % DESIGNS.length] as () => DesignInput)()
  const restarts = seed % 5 === 1
  const options: TabsOptions = {
    seed,
    maxDelay: 1 + (seed % 12),
    ...(seed % 4 === 0 ? { limits: { logChangeSets: 1 + (seed % 5) } } : {}),
    ...(restarts ? { storage: { ...STORAGE, foldEntries: 2 + (seed % 7) } } : {}),
  }
  const world = await tabsOn(design, count, { ...options, followUps })
  return { ...world, drops: seed % 3 === 0, restarts }
}

/**
 * `count` tabs named A, B and on, on `design` with its derived values worked out: each a session on
 * the store of one of the simulator's clients, whose clients bring the derived values up to date.
 */
export async function tabsOn(
  design: DesignInput,
  count: number,
  { followUps = true, ...options }: TabsOptions = {},
): Promise<Tabs> {
  const sim = await openSim({
    seed: 1,
    maxDelay: 1,
    checkEach: true,
    ...(followUps ? { recompute: DERIVED } : {}),
    ...options,
    tabs: count,
    design: withDerived(design),
  })
  const wrote = sim.tabs.map(() => new Set<string>())
  const gone = new Gone()
  const made = sim.tabs.map(() => 0)
  const tabs = sim.tabs.map((client, i): SimTab => {
    const end = client.end
    client.end = (name) => {
      if (name !== null) made[i] = (made[i] ?? 0) + 1
      return end(name)
    }
    gone.watchClient(client)
    const store = clientStore(client, (messages) => sim.send(i, messages))
    const session = keepingDerived(openTestSession(store), store, client, {
      wrote: wrote[i] as Set<string>,
      gone,
    })
    gone.watchTab(session, store)
    const focus = () => new Set(wrote.flatMap((ids, j) => (j === i ? [] : [...ids])))
    return { store, session, name: NAMES[i] as string, focus }
  })
  const start = readDesign((tabs[0] as SimTab).store)
  gone.watchServer(sim.design())
  return { sim, tabs, start, drops: false, restarts: false, wrote, made, gone }
}

/** Closes every tab's session. */
export function closeTabs({ tabs }: Tabs) {
  for (const { session } of tabs) session.destroy()
}

/** Takes one step of the walk, said in words. */
export async function takeTabStep(world: Tabs, step: Step, say: (words: string) => void) {
  const random = seeded(step.seed)
  const i = step.seed % world.tabs.length
  const tab = world.tabs[i] as SimTab
  if (step.kind === 'deliver') {
    const many = 1 + Math.floor(random() * 3)
    say(`deliver ${many}`)
    for (let n = 0; n < many && (await world.sim.step()); n++) checkTabs(world)
  } else if (step.kind === 'link') {
    if (!world.drops) say('nothing: no tab drops its connection in this walk')
    else if (world.sim.isOnline(i)) {
      say(`${tab.name} drops its connection`)
      world.sim.disconnect(i)
    } else {
      say(`${tab.name} comes back`)
      world.sim.reconnect(i)
    }
  } else if (step.kind === 'restart') {
    if (!world.restarts) return say('nothing: the server never restarts in this walk')
    const graceful = random() < 0.5
    say(`the server restarts${graceful ? ' gracefully' : ''}`)
    await world.sim.restart(graceful)
    checkTabs(world)
  } else if (step.kind === 'sync') {
    say('deliver everything')
    await quiesce(world)
  } else ownStep(tab, step, (words) => say(`${tab.name}: ${words}`))
}

/**
 * Ends every drag, brings every tab back and delivers everything, checking every tab after each
 * delivery; then checks that the tabs and the server hold one design, that no undo or redo changed
 * what another tab wrote after it, and that the design's derived values are current.
 */
export async function quiesce(world: Tabs) {
  for (const tab of world.tabs) endDrag(tab)
  world.tabs.forEach((_, i) => world.sim.reconnect(i))
  for (let n = 0; await world.sim.step(); n++) {
    if (n > MOST_DELIVERIES) throw new Error('messages never stop coming')
    checkTabs(world)
  }
  const differs = world.sim.converged()
  if (differs !== undefined) throw new Error(`with nothing in flight, the tabs hold different designs: ${differs}`)
  const [violation] = world.sim.violations
  if (violation !== undefined) throw new Error(`an undo or redo changed what another tab wrote after it: ${violation}`)
  const server = world.sim.design()
  const stale = DERIVED(server, everyLayer(server))
  if (stale !== 'wait' && stale.length > 0) {
    throw new Error(`with nothing in flight, derived values are stale: ${JSON.stringify(stale[0])}`)
  }
}

/** Delivers every message in flight, checking the tabs after each, without bringing back a tab that is away. */
export async function deliver(world: Tabs) {
  for (let n = 0; await world.sim.step(); n++) {
    if (n > MOST_DELIVERIES) throw new Error('messages never stop coming')
    checkTabs(world)
  }
}

/**
 * The end checks: with everything delivered, every tab undoes every step it can, in turn, and
 * everything is delivered again (`quiesce` checks it), until no tab can undo; then `readChecks`.
 * After them every tab redoes everything it can, the same way. Neither ever takes a tab more
 * presses than twice the undo steps it made, and one more each round.
 */
export async function endChecks(world: Tabs): Promise<EndChecks> {
  await undoEverything(world)
  const found = await readChecks(world)
  await redoEverything(world)
  return found
}

/** With everything delivered, every tab undoes everything it can, in rounds (see `endChecks`). */
export async function undoEverything(world: Tabs) {
  await quiesce(world)
  await pressAll(world, 'undo')
}

/** Every tab redoes everything it can, in rounds (see `endChecks`). */
export async function redoEverything(world: Tabs) {
  await pressAll(world, 'redo')
}

/**
 * What the read of the tabs' design leaves out (a) and repairs (b), and the pages, frames, layers,
 * sections and connectors the tabs started with that it no longer has (c), everything delivered.
 */
export async function readChecks(world: Tabs): Promise<EndChecks> {
  await quiesce(world)
  const unread: EndChecks = { leftOut: [], repaired: [], missing: [] }
  const design = readDesign((world.tabs[0] as SimTab).store, ({ repairs, leftOut }) => {
    unread.repaired.push(...repairs)
    unread.leftOut.push(...leftOut.map(({ part, id, issue }) => `${part} "${id}": ${issue}`))
  })
  for (const part of ['pages', 'frames', 'nodes', 'sections', 'connectors'] as const)
    for (const id of Object.keys(world.start[part]))
      if (!Object.hasOwn(design[part], id) && !world.gone.mayStayGone(world.start, id)) unread.missing.push(id)
  return unread
}

/** `design` with its derived values worked out, as the sync server keeps it. */
function withDerived(design: DesignInput): DesignInput {
  const state = DesignState.fromRecords(design as unknown as DesignRecords)
  const next = state.overlay()
  const changes = DERIVED(state, everyLayer(state))
  if (changes !== 'wait') for (const change of changes) next.apply(change, 'lenient')
  return next.toRecords() as unknown as DesignInput
}

/**
 * `session`, keeping the derived values as the editor does: right after each command or batch,
 * the boxes of the texts it wrote and of the groups around the layers it wrote, before and after,
 * are fitted in the same step. A command or batch outside a gesture runs in a gesture of its own
 * for it; inside a batch the batch keeps them. `wrote` gathers the layers its steps wrote, and
 * `gone` notes what its untracked steps deleted.
 */
function keepingDerived(
  session: Session,
  store: ClientStore,
  client: Client,
  { wrote, gone }: { wrote: Set<string>; gone: Gone },
): Session {
  const keep = <T>(take: () => T): T => {
    if (store.inTransaction()) return take()
    // The session's design is live: what held each layer before is kept from it now.
    const before = { ...session.design().nodes }
    const touched = new Set<string>()
    const stop = store.onChange(({ layers }) => {
      for (const id of layers) touched.add(id)
    })
    const gesture = session.inGesture() ? undefined : session.beginGesture()
    let refused = false
    try {
      return take()
    } catch (error) {
      refused = error instanceof CommandError
      throw error
    } finally {
      stop()
      try {
        // Alone, a refused batch is put back, as the session puts back one in no gesture. In a
        // gesture it was in already, the gesture keeps what it wrote. A fault closed the gesture.
        if (gesture && refused) gesture.cancel()
        else if (session.inGesture()) writeDerived(store, client, before, touched)
      } finally {
        gesture?.end()
        for (const id of touched) wrote.add(id)
      }
    }
  }
  return {
    ...session,
    run: (name, input) => keep(() => session.run(name, input)),
    batch: ((...args: Parameters<Session['batch']>) => keep(() => session.batch(...args))) as Session['batch'],
    untracked: (steps) =>
      session.untracked(() => {
        const design = session.design()
        const before = (['pages', 'frames', 'nodes', 'sections', 'connectors'] as const).flatMap((part) =>
          Object.keys(design[part]),
        )
        try {
          return steps()
        } finally {
          gone.untracked(before, session.design())
        }
      }),
  }
}

/** Checks every tab: what its store holds back is thrown, its design holds the invariants and equals a full read of its store. */
function checkTabs(world: Tabs) {
  let server: ReadState | undefined
  try {
    server = world.sim.design()
  } catch (error) {
    // Restarting, the server has no design open.
    if (!(error instanceof Error && error.message === 'the design is not open')) throw error
  }
  if (server) world.gone.watchServer(server)
  for (const tab of world.tabs) {
    tab.store.settle()
    const broken = brokenInvariants(tab.session.design())
    if (broken.length > 0) throw new Error(`tab ${tab.name}'s design broke the invariants: ${broken.join('; ')}`)
    expectFullRead(tab.session, tab.store)
  }
}

/** Takes a tab's own step: a step of a drag, or test-walk.ts's session step. */
function ownStep(tab: SimTab, step: Step, tell: (words: string) => void) {
  if (tab.drag || step.kind === 'drag') dragStep(tab, step, tell)
  else takeSessionStep(tab, step, tell)
  expectFullRead(tab.session, tab.store)
}

/** Ends a tab's drag, if it has one open. */
function endDrag(tab: SimTab) {
  tab.drag?.end()
  tab.drag = undefined
}

/** The record keys of every layer a state holds. */
function everyLayer(state: ReadState) {
  return new Set(state.ids('layer').map((id) => recordKey('layer', id)))
}

/** Every tab presses undo, or redo, until it can't, in rounds with everything delivered between them. */
async function pressAll(world: Tabs, press: 'undo' | 'redo') {
  const can = press === 'undo' ? 'canUndo' : 'canRedo'
  const presses = world.tabs.map(() => 0)
  for (let round = 0; world.tabs.some(({ session }) => session[can]()); round++) {
    if (round > MOST_ROUNDS) throw new Error(`the tabs never run out of steps to ${press}`)
    world.tabs.forEach(({ name, session }, i) => {
      const most = 2 * (world.made[i] ?? 0) + round + 1
      while (session[can]()) {
        if (++(presses[i] as number) > most) throw new Error(`${press} in tab ${name} never runs out: ${most} presses`)
        session[press]()
      }
    })
    await quiesce(world)
  }
}

/**
 * Writes into the tab's open step the derived values over the `touched` layers and what held them
 * before (`before`) or holds them now, through its store, as the editor fits texts and groups.
 */
function writeDerived(store: ClientStore, client: Client, before: Design['nodes'], touched: ReadonlySet<string>) {
  const keys = new Set<RecordKey>()
  for (const id of touched) {
    keys.add(recordKey('layer', id))
    const was = before[id]?.parentId
    if (was !== undefined) keys.add(recordKey('layer', was))
  }
  const changes = DERIVED(client.working(), keys)
  if (changes === 'wait' || changes.length === 0) return
  store.transact(() => {
    for (const change of changes as Extract<Change, { op: 'set' }>[]) {
      store.setProp(change.value.id, change.value.prop as string, change.to)
    }
  })
}

/**
 * A step of a drag: one begins with a command; an open one takes another command, ends, or is
 * cancelled, putting back all it wrote. A fault the walk accepts puts back the whole drag, the
 * commands before it included, and the drag is over.
 */
function dragStep(tab: SimTab, step: Step, tell: (words: string) => void) {
  const roll = seeded(step.seed)()
  const command = (words: string) => {
    let putBack = false
    try {
      takeSessionStep(
        tab,
        { kind: 'command', seed: step.seed },
        (said) => tell(`${words} ${said}`),
        () => (putBack = true),
      )
    } catch (error) {
      // Its check compares with the design before this command, which the drag's put-back goes past,
      // and other tabs' writes arrive while a drag is open: here only the closed drag is checked.
      // test-walk.ts's faults in a drag, on one tab, check the put-back whole.
      if (!putBack || tab.session.inGesture()) throw error
    }
    if (putBack) tab.drag = undefined
  }
  if (!tab.drag) {
    tab.drag = tab.session.beginGesture()
    command('drag of')
  } else if (roll < 0.5) command('drag goes on with')
  else if (roll < 0.85) {
    tell('drag ends')
    endDrag(tab)
  } else {
    tell('drag cancelled')
    tab.drag.cancel()
    tab.drag = undefined
    if (tab.session.inGesture()) throw new Error('a cancelled drag left its gesture open')
  }
}
