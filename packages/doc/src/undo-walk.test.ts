// The undo walk: seeded random steps on one tab, with faults among them (test-walk.ts). Several
// tabs walk on the sync core's simulator in tabs-walk.test.ts.
import { describe, expect, it, vi } from 'vitest'

import type { Design, DesignInput } from '@dazbee/schema'

import { readDesign } from './store.ts'
import { registerBuggyCommands } from './test-commands.ts'
import { kindsDesign, linkedDesign, sectionedDesign, testDesign } from './test-design.ts'
import { expectFullRead } from './test-invariants.ts'
import {
  differenceOf,
  FAULT_STEPS,
  openTab,
  SESSION_STEPS,
  type Tab,
  takeSessionStep,
  type Walk,
  walk,
  walkSeeds,
  walkSteps,
} from './test-walk.ts'

vi.mock('nanoid', () => import('./test-ids.ts'))

/** A tab and the design it started at. */
interface OneTab extends Tab {
  start: Design
  /** The design before and after each step that changed it, the latest last: what each undo lands on. */
  done: { before: Design; after: Design }[]
  /** The same for the steps undone, the latest undone last: what each redo lands on. */
  undone: { before: Design; after: Design }[]
}

/** The designs a walk starts from, by its seed. */
const DESIGNS: readonly (() => DesignInput)[] = [kindsDesign, linkedDesign, testDesign, sectionedDesign]
/** A walk takes hundreds of commands and full reads; a cold CI runner needs more than vitest's 5 s. */
const WALK_TIMEOUT = 60_000
/** Throws `what`, with the difference, when two designs differ. */
function expectSame(actual: Design, expected: Design, what: string) {
  const difference = differenceOf(actual, expected)
  if (difference) throw new Error(`${what}: ${difference}`)
}

/** The design a walk starts from, by its seed. */
const designOf = (seed: number) => (DESIGNS[seed % DESIGNS.length] as () => DesignInput)()

/** Undoes every step there is, each through `take`, and gives how many it undid. */
function undoAll({ session }: Tab, take: (undo: () => void) => void = (undo) => undo()) {
  let undone = 0
  for (; session.canUndo(); undone++) {
    if (undone > 10_000) throw new Error('undo never runs out of steps')
    take(() => session.undo())
  }
  return undone
}

/**
 * Takes a step on one tab and checks it against the steps before it: an undo lands on the design
 * before the latest step that changed it, a redo on the design after the latest step undone, and
 * either reverts nothing only where no such step is left. A step that changes the design is the
 * next to undo, and only such a step leaves nothing to redo (C32: a step put back, or one that
 * changed nothing, keeps redo).
 */
function stepOn(tab: OneTab, kind: string, take: () => void) {
  const before = readDesign(tab.store)
  take()
  const after = readDesign(tab.store)
  expectFullRead(tab.session, tab.store)
  if (kind === 'undo' || kind === 'redo') {
    const [from, to, lands] =
      kind === 'undo' ? ([tab.done, tab.undone, 'before'] as const) : ([tab.undone, tab.done, 'after'] as const)
    const step = from.pop()
    expectSame(
      after,
      step ? step[lands] : before,
      `the ${kind} did not land on the design ${lands} the latest step it takes`,
    )
    if (step) to.push(step)
    return
  }
  const changed = differenceOf(after, before) !== undefined
  if (!changed) return
  tab.undone.length = 0
  tab.done.push({ before, after })
}

const oneTab: Walk<OneTab> = {
  kinds: { ...SESSION_STEPS, ...FAULT_STEPS },
  open: (seed) => {
    const tab = openTab(designOf(seed))
    return { ...tab, start: readDesign(tab.store), done: [], undone: [] }
  },
  take: (tab, step, say) => stepOn(tab, step.kind, () => takeSessionStep(tab, step, say)),
  end: (tab) => {
    const end = readDesign(tab.store)
    // The steps the walk itself left undone stay so: only what is undone here is redone.
    const kept = tab.undone.length
    undoAll(tab, (undo) => stepOn(tab, 'undo', undo))
    expectSame(readDesign(tab.store), tab.start, 'undoing every step did not give the design the walk started at')
    while (tab.undone.length > kept) stepOn(tab, 'redo', () => tab.session.redo())
    expectSame(readDesign(tab.store), end, 'redoing every step did not give the design the walk ended at')
  },
  close: ({ session }) => session.destroy(),
}

describe('the undo walk on one tab', () => {
  registerBuggyCommands()

  it(
    'fails on an undo that skips the names of layers',
    async () => {
      const skipping: Walk<OneTab> = {
        ...oneTab,
        open: (seed) => {
          const tab = oneTab.open(seed) as OneTab
          const { session, store } = tab
          const names = () =>
            Object.entries(store.snapshot().nodes).map(([id, layer]) => [id, (layer as { name: string }).name] as const)
          // The undo leaves every layer's name as it found it.
          const undo = () => {
            const kept = names()
            session.undo()
            store.transact(() => kept.forEach(([id, name]) => store.set('layer', id, 'name', name)))
          }
          return { ...tab, session: { ...session, undo } }
        },
      }
      await expect(walk(skipping, 1, walkSteps(100))).rejects.toThrow('did not land on the design before')
    },
    WALK_TIMEOUT,
  )

  it.each(walkSeeds([1, 2, 3, 4, 5, 6]))(
    'holds the invariants after every step; undoing every step gives the start, and redoing every step the end (seed %i)',
    (seed) => walk(oneTab, seed, walkSteps(100)),
    WALK_TIMEOUT,
  )
})
