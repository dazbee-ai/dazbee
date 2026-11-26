// Seeded random walks over a design. A seed gives a stream of steps; a walk takes them one by one,
// checking what has to hold after each. A walk that fails is taken again with steps left out until
// none can go, and reported with its seed and the steps left. The steps a session takes come from
// the input generators of test-commands.ts.
import type { Design, DesignInput } from '@dazbee/schema'

import { descendants } from './children.ts'
import { CommandError } from './commands/define.ts'
import { type CommandName, COMMANDS } from './commands/index.ts'
import { CommandFault, type Session } from './session.ts'
import { type DesignStore, readDesign } from './store.ts'
import { type Buggy, casesOf, COMMAND_INPUTS, type World } from './test-commands.ts'
import { openTestSession } from './test-design.ts'
import { nanoid, restartIds } from './test-ids.ts'
import { openTestStore } from './test-store.ts'

/**
 * One step of a walk: its kind, and the seed of what it picks when it is taken, from the design as
 * it is then. A step left out of a walk leaves every other step as it was.
 */
export interface Step {
  kind: string
  seed: number
}

/** The kinds of step a walk takes, each with how often it comes against the others. */
export type Kinds = Readonly<Record<string, number>>

/** A walk: the world it opens, the steps it takes on it and what it checks. */
export interface Walk<W> {
  kinds: Kinds
  /** A fresh world for a seed: every run of the walk with that seed starts from the same one. */
  open(seed: number): W | Promise<W>
  /**
   * Takes a step and checks what has to hold after it, throwing when something does not. It says
   * the step in words as soon as it knows what the step is, before it checks anything.
   */
  take(world: W, step: Step, say: (words: string) => void): void | Promise<void>
  /** Checks what has to hold once every step is taken. */
  end?(world: W): void | Promise<void>
  close?(world: W): void | Promise<void>
}

/** A design's store with a session on it, as one tab holds it. */
export interface Tab {
  store: DesignStore
  session: Session
  /** Where tabs walk side by side, the end of the ids this tab's inputs give what they make, so no two tabs make one id. */
  name?: string
  /** The layers this tab's inputs pick first, in a random order before the rest: those another tab wrote. */
  focus?: () => ReadonlySet<string>
}

/** What a session does in a walk, by how often each comes. */
export const SESSION_STEPS: Kinds = { command: 8, refused: 3, gesture: 2, batch: 2, undo: 3, redo: 2 }

/** A fault, for the walks that take one: a command with a bug runs alone or in a step with another. */
export const FAULT_STEPS: Kinds = { fault: 1 }

/**
 * What a session does around an open gesture, for the walks that take it: a command run untracked,
 * alone or while a gesture is open (C40); undo pressed inside a gesture; a gesture cancelled.
 */
export const GESTURE_STEPS: Kinds = { untracked: 1, pressInGesture: 1, cancel: 1 }

/** The most runs a shortening takes before it stops with the steps it has. */
const MOST_RUNS = 2000
/** The most lines of a failure's message a report shows. */
const MOST_LINES = 30
/** The commands with a bug a fault runs: one that throws and one that writes a value the schema does not take. */
const FAULTS: readonly Buggy[] = ['test.throw', 'test.spoil']
/** Where a fault runs: alone, or after another command in a gesture, a drag's gesture or a batch. */
const SETTINGS = ['alone', 'gesture', 'drag', 'batch'] as const
const COMMAND_NAMES = Object.keys(COMMAND_INPUTS)
/** The commands a batch takes (`batchable`). */
const BATCHABLE_NAMES = COMMAND_NAMES.filter((name) => COMMANDS[name as CommandName].batchable)
/**
 * How far from 0 a number is, at least, for its sums, products and quotients with ordinary ones
 * to overflow: as large as this, or as near 0 as its inverse.
 */
const EXTREME = 1e100

/**
 * Takes a walk of `count` steps from `seed`. When a check fails, throws an error with the seed, the
 * fewest steps found that still fail that same check, each in words, and both failures' messages.
 * A check is named by its error's name and what its message says before the first colon.
 */
export async function walk<W>(walker: Walk<W>, seed: number, count: number): Promise<void> {
  const steps = stepsOf(seed, count, walker.kinds)
  const failed = await failureOf(walker, seed, steps)
  if (!failed) return
  const same = async (some: readonly Step[]) => (await failureOf(walker, seed, some))?.check === failed.check
  const fewest = await shorten(steps.slice(0, failed.taken), same)
  const again = await failureOf(walker, seed, fewest)
  const where = `The walk with seed ${seed} failed at step ${failed.taken} of ${count}`
  const rerun = `(WALK_SEEDS=${seed} WALK_STEPS=${count} takes it again)`
  if (!again)
    throw new Error(`${where} ${rerun}, and passed when taken again: the walk does not take a seed the same way twice.
${failed.message}`)
  const listed = again.words.map((words, i) => `  ${i + 1}. ${words}`).join('\n')
  throw new Error(`${where} ${rerun}. These ${fewest.length} of its steps still fail the same check:
${listed}
with: ${again.message}
It first failed with: ${failed.message}`)
}

/** The steps of a walk from a seed: the same seed always gives the same steps. */
export function stepsOf(seed: number, count: number, kinds: Kinds): Step[] {
  const random = seeded(seed)
  const all = Object.entries(kinds)
  const total = all.reduce((sum, [, weight]) => sum + weight, 0)
  return Array.from({ length: count }, () => {
    let roll = random() * total
    const [kind] = all.find(([, weight]) => (roll -= weight) < 0) ?? (all.at(-1) as [string, number])
    return { kind, seed: Math.floor(random() * 2 ** 32) }
  })
}

/**
 * The fewest steps found that still fail: chunks of steps are left out, each chunk half as long
 * as the last, down to one step at a time, until no single step can go.
 */
export async function shorten(
  steps: readonly Step[],
  fails: (steps: readonly Step[]) => Promise<boolean>,
): Promise<Step[]> {
  let kept = [...steps]
  let runs = 0
  let size = Math.max(1, Math.floor(kept.length / 2))
  for (;;) {
    let left = false
    for (let at = 0; at < kept.length && runs < MOST_RUNS;) {
      const fewer = kept.toSpliced(at, size)
      runs++
      if (await fails(fewer)) {
        kept = fewer
        left = true
      } else at += size
    }
    if (size > 1) size = Math.max(1, Math.floor(size / 2))
    else if (!left || runs >= MOST_RUNS) return kept
  }
}

/** A stream of numbers from 0 up to 1 that a seed fixes (mulberry32). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
}

/**
 * The seeds a walk runs: those in WALK_SEEDS (or the variable named), as `17`, `3,17` or a range
 * `1-500`, else the ones given.
 */
export function walkSeeds(fixed: readonly number[], variable = 'WALK_SEEDS'): number[] {
  const given = process.env[variable]?.trim()
  if (!given) return [...fixed]
  return given.split(',').flatMap((part) => {
    const [from = '', to] = part.split('-')
    const first = Number(from)
    const last = to === undefined ? first : Number(to)
    return Array.from({ length: last - first + 1 }, (_, i) => first + i)
  })
}

/** The steps a walk takes: WALK_STEPS, else the count given. */
export function walkSteps(fixed: number): number {
  const given = Number(process.env.WALK_STEPS)
  return Number.isInteger(given) && given > 0 ? given : fixed
}

/**
 * A tab on a new store holding `design` (openTestStore). Its session checks the invariants after
 * each command (test-design.ts).
 */
export function openTab(design: DesignInput): Tab {
  const store = openTestStore(design)
  return { store, session: openTestSession(store) }
}

/**
 * Takes a step of the kinds in SESSION_STEPS and FAULT_STEPS on a tab, from the design as the tab
 * has it, and gives it in words; undefined for a step of another kind. A command the session
 * refuses is part of the walk. A fault is a failure of the walk, except a fault of a command with
 * a bug and the faults ADR-0004 accepts (`acceptedFault`), which have to be put back, leaving the
 * design and the history as they were; `putBack` is told of each, and of a refused batch.
 */
export function takeSessionStep(
  tab: Tab,
  step: Step,
  say: (words: string) => void = () => {},
  putBack: () => void = () => {},
): string | undefined {
  const { session } = tab
  const random = seeded(step.seed)
  let said = ''
  const tell = (words: string) => {
    said = words
    say(words)
  }
  let before = historyOf(tab)
  /** The commands the step runs, as they are picked. */
  const runs: { command: string; input: unknown }[] = []
  const next = (refused = false, batched = false) => {
    const run = commandFrom(tab, random, refused, batched)
    runs.push(run)
    return run
  }
  const run = ({ command, input }: (typeof runs)[number]) => session.run(command as never, input as never)
  try {
    switch (step.kind) {
      case 'command':
      case 'refused':
        tell(`${step.kind} ${wordsOf(next(step.kind === 'refused'))}`)
        refusable(() => run(runs[0] as (typeof runs)[number]))
        return said
      case 'gesture': {
        // As a drag runs them: each command as it comes, from the design the one before left.
        const gesture = session.beginGesture()
        for (let i = 2 + Math.floor(random() * 3); i > 0; i--) {
          const one = next()
          tell(`gesture of ${runs.map(wordsOf).join('; ')}`)
          refusable(() => run(one))
        }
        gesture.end()
        return said
      }
      case 'batch':
        // Every command picked from the design before the batch, which each of them checks and reads.
        for (let i = 2 + Math.floor(random() * 3); i > 0; i--) next(false, true)
        tell(`batch of ${runs.map(wordsOf).join('; ')}`)
        // A batch refused after its first commands wrote puts back what they wrote.
        if (refusable(() => session.batch(() => runs.forEach(run)))) putBack()
        return said
      case 'undo':
      case 'redo':
        tell(step.kind)
        session[step.kind]()
        return said
      case 'untracked': {
        // As the brand kit's refit runs: alone, or while a drag is open, when it waits for the drag's end.
        const gesture = random() < 0.5 ? session.beginGesture() : undefined
        if (gesture) {
          const first = next()
          refusable(() => run(first))
        }
        const one = next()
        tell(
          `untracked ${wordsOf(one)}${gesture ? ` inside a gesture of ${wordsOf(runs[0] as (typeof runs)[number])}` : ''}`,
        )
        session.untracked(() => refusable(() => run(one)))
        gesture?.end()
        return said
      }
      case 'pressInGesture': {
        const gesture = session.beginGesture()
        const first = next()
        refusable(() => run(first))
        const which = random() < 0.7 ? 'undo' : 'redo'
        const takes = which === 'undo' ? session.canUndo() : session.canRedo()
        session[which]()
        // A press with something to take back ends the gesture's first part as a step: a fault after
        // it puts back only what came after. One with nothing leaves the gesture whole (C32).
        if (takes) before = historyOf(tab)
        const second = next()
        tell(`gesture of ${wordsOf(first)}; ${which}; ${wordsOf(second)}`)
        refusable(() => run(second))
        gesture.end()
        return said
      }
      case 'cancel': {
        const gesture = session.beginGesture()
        for (let i = 1 + Math.floor(random() * 3); i > 0; i--) {
          const one = next()
          tell(`gesture of ${runs.map(wordsOf).join('; ')}, cancelled`)
          refusable(() => run(one))
        }
        gesture.cancel()
        return said
      }
      case 'fault':
        takeFault(tab, random, tell)
        putBack()
        return said
      default:
        return undefined
    }
  } catch (error) {
    if (!acceptedFault(error, before.design, runs)) throw error
    // Told first: in a drag left open, the put-back goes past `before`, to where the drag began.
    putBack()
    expectPutBack(tab, before)
    return said
  }
}

/** The first place two values differ, in words; undefined when they are deep-equal. */
export function differenceOf(actual: unknown, expected: unknown, path = ''): string | undefined {
  if (Object.is(actual, expected)) return undefined
  const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
  if (!isObject(actual) || !isObject(expected) || Array.isArray(actual) !== Array.isArray(expected))
    return `${path || 'the value'} is ${shown(actual)}, not ${shown(expected)}`
  for (const key of new Set([...Object.keys(actual), ...Object.keys(expected)])) {
    const difference = differenceOf(actual[key], expected[key], path ? `${path}.${key}` : key)
    if (difference) return difference
  }
  return undefined
}

/**
 * Takes a walk's steps on a fresh world, the ids commands make counted again from the start. Gives
 * what failed and the check that failed, with the steps taken in words and how many were taken,
 * the one that failed included; null when every check held.
 */
async function failureOf<W>(walker: Walk<W>, seed: number, steps: readonly Step[]) {
  restartIds()
  const world = await walker.open(seed)
  const words: string[] = []
  try {
    for (const step of steps) {
      let said = step.kind
      try {
        await walker.take(world, step, (text) => (said = text))
      } finally {
        words.push(said)
      }
    }
    await walker.end?.(world)
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const check = `${error instanceof Error ? error.name : 'thrown'}: ${(message.split('\n')[0] ?? '').split(': ')[0]}`
    return { message: message.split('\n').slice(0, MOST_LINES).join('\n'), check, words, taken: words.length }
  } finally {
    await walker.close?.(world)
  }
}

/** The design as the tab's document holds it, and whether there is a step to undo and to redo. */
function historyOf({ store, session }: Tab) {
  return { design: readDesign(store), couldUndo: session.canUndo(), couldRedo: session.canRedo() }
}

/**
 * A command and its input from the generators of test-commands.ts, on the tab's design with its
 * pages, frames and layers in a random order, so the generators pick other layers each time:
 * the input as given, or, when `refused`, one of the variants the sweep runs, which the command may
 * refuse. A command for a batch is one the batch takes.
 */
function commandFrom({ session, name, focus }: Tab, random: () => number, refused: boolean, batched = false) {
  const design = session.design()
  const shuffle = <T>(list: T[]) => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1))
      ;[list[i], list[j]] = [list[j] as T, list[i] as T]
    }
    return list
  }
  const shuffled = <V>(record: Readonly<Record<string, V>>, first: ReadonlySet<string> = new Set()) => {
    const entries = Object.entries(record)
    const firsts = shuffle(entries.filter(([id]) => first.has(id)))
    return Object.fromEntries([...firsts, ...shuffle(entries.filter(([id]) => !first.has(id)))])
  }
  // What an input makes gets an id no input made before.
  const fresh = nanoid()
  const world: World = {
    design: {
      meta: design.meta,
      pages: shuffled(design.pages),
      frames: shuffled(design.frames),
      nodes: shuffled(design.nodes, focus?.()),
      sections: shuffled(design.sections),
      connectors: shuffled(design.connectors),
    },
    // No id the design held before is given as a new one: ids are random, and one taken again would
    // hold back the undo of the tab that deleted it (C27). The sweep, on one tab, gives one.
    deleted: 'never-was',
    random,
    made: (what) => `${what}-${name === undefined ? '' : `${name}-`}${fresh}`,
  }
  const command = pick(random, batched ? BATCHABLE_NAMES : COMMAND_NAMES)
  const input = pick(random, COMMAND_INPUTS[command]?.(world) ?? [undefined])
  if (!refused) return { command, input }
  const variants = casesOf(input, world).slice(1)
  return { command, input: variants.length > 0 ? pick(random, variants).input : input }
}

/** One of a list, picked at random. */
function pick<T>(random: () => number, list: readonly T[]): T {
  return list[Math.floor(random() * list.length)] as T
}

/** A command and its input in words, long texts and lists cut short. */
function wordsOf({ command, input }: { command: string; input: unknown }) {
  return `${command} ${shown(input)}`
}

/** A value as JSON, long texts and lists cut short. */
function shown(value: unknown) {
  return (
    JSON.stringify(value, (_, inner: unknown) => {
      if (typeof inner === 'string' && inner.length > 40) return `${inner.slice(0, 16)}… (${inner.length} characters)`
      if (Array.isArray(inner) && inner.length > 6) return [...inner.slice(0, 6), `… ${inner.length - 6} more`]
      return inner
    }) ?? String(value)
  )
}

/**
 * Runs a command, a gesture or a batch, and gives whether it was refused; a refusal is part of the
 * walk, anything else thrown is not.
 */
function refusable(run: () => unknown): boolean {
  try {
    run()
    return false
  } catch (error) {
    if (!(error instanceof CommandError)) throw error
    return true
  }
}

/**
 * Runs a command with a bug, alone or after another command in a gesture, a drag's gesture or a
 * batch, and checks that the session put back all its step wrote. It runs on a layer the design
 * has when it runs: one the command before it deleted is read by no one, so a bad value written
 * there is no fault.
 */
function takeFault(tab: Tab, random: () => number, tell: (words: string) => void) {
  const { session } = tab
  const command = pick(random, FAULTS)
  const setting = pick(random, SETTINGS)
  const before = historyOf(tab)
  const other = setting === 'alone' ? undefined : commandFrom(tab, random, false, setting === 'batch')
  const where = other ? `in a ${setting} after ${wordsOf(other)}` : 'alone'
  tell(`fault ${command} ${where}`)
  const fault = () => {
    const ids = Object.keys(session.design().nodes)
    const id = pick(random, ids) ?? 'never-was'
    // A write to a layer the store does not hold writes nothing: with no layer left, the bug throws.
    const bug = ids.length > 0 ? command : 'test.throw'
    tell(`fault ${bug} ${shown({ id })} ${where}`)
    session.run(bug as never, { id } as never)
  }
  const steps = () => {
    if (other) refusable(() => session.run(other.command as never, other.input as never))
    fault()
  }
  let thrown: unknown
  try {
    if (setting === 'alone') fault()
    else if (setting === 'gesture') session.gesture(steps)
    else if (setting === 'batch') session.batch(steps)
    else {
      const drag = session.beginGesture()
      steps()
      drag.end()
    }
  } catch (error) {
    thrown = error
  }
  if (!(thrown instanceof CommandFault)) throw new Error(`the command with a bug threw ${String(thrown)}, no fault`)
  expectPutBack(tab, before)
}

/**
 * Whether a step's fault is one ADR-0004 accepts: a batch whose commands, each reading the design
 * from before it, leave one together that does not read; or numbers that overflow only in
 * combination, where the step's inputs, or the layers and frames they name with what those hold,
 * hold an extreme number (`EXTREME`).
 */
function acceptedFault(error: unknown, design: Design, runs: readonly unknown[]): boolean {
  if (!(error instanceof CommandFault)) return false
  if (error.command === 'batch') return true
  const named = new Set<string>()
  const extreme = (value: unknown): boolean => {
    if (typeof value === 'string' && (Object.hasOwn(design.nodes, value) || Object.hasOwn(design.frames, value)))
      named.add(value)
    if (typeof value === 'number') return Math.abs(value) >= EXTREME || (value !== 0 && Math.abs(value) <= 1 / EXTREME)
    return typeof value === 'object' && value !== null && Object.values(value).some(extreme)
  }
  if (extreme(runs)) return true
  const parts = [...named].flatMap((id) => [id, ...descendants(design, id)])
  return parts.some((id) => extreme(design.nodes[id] ?? design.frames[id]))
}

/**
 * Checks that a step that faulted was put back: the design is as before, and nothing of the step
 * is left to undo or redo. A fault that wrote something drops the steps to redo (ADR-0004); one
 * that wrote nothing leaves them.
 */
function expectPutBack({ store, session }: Tab, { design, couldUndo, couldRedo }: ReturnType<typeof historyOf>) {
  const left = differenceOf(readDesign(store), design)
  if (left) throw new Error(`the fault was not put back: ${left}`)
  if (session.canUndo() !== couldUndo) throw new Error('the fault changed what there is to undo')
  if (session.canRedo() && !couldRedo) throw new Error('the fault left a step to redo')
  if (session.inGesture()) throw new Error('the fault left a gesture open')
}
