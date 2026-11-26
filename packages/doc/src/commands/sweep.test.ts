// Every command, run on each test design with every variant of its inputs (test-commands.ts):
// whatever it is given, it runs or is refused, and the design it leaves reads, holds its invariants
// and undoes.
import { isDeepStrictEqual } from 'node:util'

import { describe, expect, it } from 'vitest'

import type { Design, DesignInput } from '@dazbee/schema'

import { openSession, type Session } from '../session.ts'
import { type DesignStore, readDesign } from '../store.ts'
import { type Case, casesOf, COMMAND_INPUTS, sweepWorld, type World } from '../test-commands.ts'
import { kindsDesign, linkedDesign, sectionedDesign, testDesign } from '../test-design.ts'
import { brokenDocument, brokenInvariants, tiedIndexes } from '../test-invariants.ts'
import { forkTestStore, openTestStore } from '../test-store.ts'
import { seeded } from '../test-walk.ts'
import { CommandError } from './define.ts'
import { COMMANDS } from './index.ts'

interface Tab {
  store: DesignStore
  session: Session
  /** The design as the tab opened on it. */
  design: Design
}

const DESIGNS: Record<string, () => DesignInput> = {
  'one frame of every layer type and state': kindsDesign,
  'linked frames': testDesign,
  'two pages': linkedDesign,
  'sections and connectors': sectionedDesign,
}

/** The most problems one command's test lists; the rest are counted. */
const LISTED = 20

/** A design to sweep on: a store holding it with sweepWorld's deletions, and what generators pick from. */
function worldOf(make: () => DesignInput): { store: DesignStore; world: World } {
  const store = openTestStore(make())
  const session = openSession(store)
  const world = sweepWorld(session, seeded(1))
  session.destroy()
  return { store, world }
}

/** A tab on a copy of the sweep's store, as the world left it. */
function open(world: DesignStore): Tab {
  const store = forkTestStore(world)
  return { store, session: openSession(store), design: readDesign(store) }
}

/** What is wrong with the tab's document, whatever was just run on it. */
const documentProblems = ({ store }: Tab) => [...brokenInvariants(readDesign(store)), ...brokenDocument(store)]

/**
 * Runs one case on a tab whose document is as it opened. Returns what went wrong, and whether the
 * command ran: the tab's document is then no longer as it opened.
 */
function sweep(tab: Tab, name: string, { input, refused }: Case): { problems: string[]; ran: boolean } {
  const { store, session, design: before } = tab
  const problems: string[] = []
  const run = () => session.run(name as never, input as never)
  const thrownBy = (steps: () => void): unknown => {
    try {
      steps()
      return undefined
    } catch (error) {
      return error ?? new Error('threw nothing')
    }
  }
  const thrown = thrownBy(run)
  problems.push(...documentProblems(tab))
  if (thrown === undefined) {
    if (refused) problems.push('ran, though it has to be refused')
    const after = readDesign(store)
    problems.push(...tiedIndexes(before.nodes, after))
    if (!session.canUndo()) {
      if (!isDeepStrictEqual(after, before)) problems.push('changed the design and left no step to undo')
      return { problems, ran: true }
    }
    session.undo()
    if (!isDeepStrictEqual(readDesign(store), before)) problems.push('undo did not give the design from before it')
    session.redo()
    if (!isDeepStrictEqual(readDesign(store), after)) problems.push('redo did not give the design from after it')
    return { problems, ran: true }
  }
  if (!(thrown instanceof CommandError)) problems.push(`threw ${String(thrown)}`)
  if (!isDeepStrictEqual(readDesign(store), before)) problems.push('was refused, yet changed the design')
  if (session.canUndo()) problems.push('was refused, yet left a step to undo')
  // Refused after another command in one programmatic step, the step puts that command's change back.
  const marked = { id: Object.keys(before.pages)[0] as string, name: 'Marked by the sweep' }
  for (const [setting, within] of [
    ['gesture', session.gesture],
    ['batch', session.batch],
  ] as const) {
    const inside = thrownBy(() =>
      within(() => {
        session.run('page.update', marked)
        run()
      }),
    )
    if (!(inside instanceof CommandError)) problems.push(`in a ${setting}: threw ${String(inside)}`)
    if (!isDeepStrictEqual(readDesign(store), before))
      problems.push(`in a ${setting}: was refused, yet the ${setting} kept the change of the command before it`)
    if (session.canUndo()) problems.push(`in a ${setting}: was refused, yet left a step to undo`)
    problems.push(...documentProblems(tab).map((problem) => `in a ${setting}: ${problem}`))
  }
  return { problems, ran: false }
}

describe('every command', () => {
  const names = Object.keys(COMMANDS)

  it('has an input generator', () => {
    expect(names.filter((name) => !COMMAND_INPUTS[name])).toEqual([])
  })

  it('may run in a batch only where it changes properties of layers, frames or pages that exist', () => {
    const batchable = (name: string) => (COMMANDS as Record<string, { batchable?: true }>)[name]?.batchable === true
    expect(names.filter(batchable)).toEqual([
      'node.update',
      'node.lock',
      'node.rename',
      'node.mask',
      'node.bind',
      'node.style',
      'node.hug',
      'node.reshape',
      'text.edit',
      'text.replace',
      'text.fit',
      'page.update',
      'frame.update',
      'frame.resize',
    ])
  })

  it.each(names)(
    '%s runs or is refused on every input, and leaves a design that reads, holds its invariants and undoes',
    (name) => {
      const inputs = COMMAND_INPUTS[name]
      if (!inputs) throw new Error(`${name} has no input generator in test-commands.ts`)
      const problems: string[] = []
      let ran = 0
      for (const [title, make] of Object.entries(DESIGNS)) {
        const { store, world } = worldOf(make)
        let tab = open(store)
        for (const [i, input] of inputs(world).entries()) {
          for (const one of casesOf(input, world)) {
            const result = sweep(tab, name, one)
            for (const problem of new Set(result.problems))
              problems.push(`${name} on ${title}, input ${i + 1} with ${one.label}: ${problem}`)
            if (one.label === 'as given' && result.ran) ran++
            // A command that ran left a document with a history: the next case starts from a new one.
            if (!result.ran && result.problems.length === 0) continue
            tab.session.destroy()
            tab = open(store)
          }
        }
        tab.session.destroy()
      }
      if (ran === 0) problems.push(`${name}: no input ran as given on any design`)
      const more = problems.length > LISTED ? [`… and ${problems.length - LISTED} more`] : []
      expect([...problems.slice(0, LISTED), ...more]).toEqual([])
    },
    120_000,
  )
})
