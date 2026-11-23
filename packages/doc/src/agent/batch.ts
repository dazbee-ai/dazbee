// An agent's batch: commands run one after another as one undo step, all or nothing. A step may
// name its result with `as`, and a later step's input takes it through a step reference,
// `{ "$ref": name }`, with `field` for a part of it.
import { CommandError, type InputIssue } from '../commands/define.ts'
import { type CommandName, COMMANDS } from '../commands/index.ts'
import { nearestNames } from '../commands/nearest-names.ts'
import { inWords } from '../in-words.ts'
import type { Session } from '../session.ts'

/**
 * One step of an agent's batch: the command it runs, its input, and the name later steps refer to
 * its result by, if any. Anywhere in `input`, an object holding `$ref` is a step reference, which
 * stands for that step's result, or with `field`, for a key of it or a slash path into it (`0`,
 * `boxes/0`). A result that is an id is taken whole without `field`.
 */
export interface AgentStep {
  command: string
  input?: unknown
  as?: string
}

/** Which step of a batch an outcome is of: its place in the batch, its command and its name, if any. */
export interface AgentStepPlace {
  step: number
  command: string
  as?: string
}

/** What came of one step: what it returned, or the refusal or bad input it stopped on. */
export type AgentStepOutcome = AgentStepPlace &
  (
    | { ok: true; result: unknown }
    | { ok: false; kind: CommandError['kind']; reason: string; issues: readonly InputIssue[] }
  )

/**
 * What came of a batch: whether its writes were kept, and what came of each step that ran, up to
 * the one it stopped on.
 */
export interface AgentBatchResult {
  kept: boolean
  steps: AgentStepOutcome[]
}

/** Where a value sits in a step's input, as keys and list places. */
type InputPath = InputIssue['path']

/** What following the step references in one step's input reads: where it is, and the steps before it. */
interface Scope {
  step: number
  command: string
  names: ReadonlyMap<string, number>
  results: readonly unknown[]
}

/** The keys a step takes. */
const STEP_KEYS = ['command', 'input', 'as']
/** How deep a step's input may hold objects and lists before it is refused, as a walk too deep. */
const MAX_DEPTH = 64

/**
 * Runs `steps` in order as one gesture of `session`, so they are one undo step, named by the first
 * step's command; each reads the design as the steps before it left it, so a step may add, move or
 * re-parent layers and a later one change them. When a step is refused, its input is bad or a
 * step reference in it can't be followed, everything the batch wrote is put back, and the result
 * ends with that step's refusal. A step that is not an object of the keys a step takes, two steps
 * of one name, a name that is not a string of one character or more, or a command there is not,
 * refuse the batch before any step runs. A fault is thrown, its step already put back by the
 * session. It throws while a gesture of the session is open, since the batch would join its step
 * and could not put back what it wrote.
 */
export function runAgentBatch(session: Session, steps: readonly AgentStep[]): AgentBatchResult {
  if (session.inGesture()) throw new Error('an agent batch does not run while a gesture is open')
  const names = new Map<string, number>()
  for (const [step, given] of steps.entries()) {
    const refused = shapeProblem(step, given as unknown, names)
    if (refused) return { kept: false, steps: [refused] }
    if (given.as !== undefined) names.set(given.as, step)
  }
  const outcomes: AgentStepOutcome[] = []
  const results: unknown[] = []
  try {
    session.gesture(() => {
      for (const [step, { command, as, input }] of steps.entries()) {
        const at = placeOf(step, command, as)
        try {
          const resolved = resolve(input, [], { step, command, names, results })
          const result: unknown = session.run(command as CommandName, resolved as never)
          results.push(result)
          outcomes.push({ ...at, ok: true, result })
        } catch (error) {
          if (error instanceof CommandError) outcomes.push(refusal(at, error))
          throw error
        }
      }
    })
  } catch (error) {
    if (error instanceof CommandError) return { kept: false, steps: outcomes }
    throw error
  }
  return { kept: true, steps: outcomes }
}

/** The bad input of step `step` that refuses the batch before any step runs, if it has any. */
function shapeProblem(step: number, given: unknown, names: ReadonlyMap<string, number>) {
  if (!isPlainObject(given)) return badStep(placeOf(step, ''), [], 'a step is an object of command, input and as')
  const command = typeof given['command'] === 'string' ? given['command'] : ''
  const as = given['as']
  const at = placeOf(step, command, typeof as === 'string' ? as : undefined)
  const other = Object.keys(given).find((key) => !STEP_KEYS.includes(key))
  if (other !== undefined) return badStep(at, [other], `a step takes command, input and as, not \`${other}\``)
  if (as !== undefined && (typeof as !== 'string' || as === ''))
    return badStep(at, ['as'], '`as` must be a name, a string of one character or more')
  const taken = as === undefined ? undefined : names.get(as)
  if (taken !== undefined) return badStep(at, ['as'], `"${as as string}" is already step ${taken}'s name`)
  if (!Object.hasOwn(COMMANDS, command))
    return badStep(
      at,
      ['command'],
      `no command is called "${String(given['command'])}" (the nearest are ${inWords(nearestNames(command, Object.keys(COMMANDS)))})`,
    )
  return undefined
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value) as unknown
  return proto === Object.prototype || proto === null
}

/** The outcome of the step at `at` for bad input at `path`. */
function badStep(at: AgentStepPlace, path: InputPath, message: string): AgentStepOutcome {
  return refusal(at, new CommandError(at.command, { kind: 'input', issues: [{ path, message }] }))
}

/** A step's place, with its name only when it has one. */
function placeOf(step: number, command: string, as?: string): AgentStepPlace {
  return as === undefined ? { step, command } : { step, command, as }
}

/** The outcome of the step at `at` for the refusal `error`. */
function refusal(at: AgentStepPlace, error: CommandError): AgentStepOutcome {
  return { ...at, ok: false, kind: error.kind, reason: error.reason, issues: error.issues }
}

/**
 * `value`, which sits at `path` in a step's input, with each step reference in it replaced by what
 * it stands for. A reference that can't be followed throws the step's bad input, at its path.
 */
function resolve(value: unknown, path: InputPath, scope: Scope): unknown {
  if (path.length > MAX_DEPTH) throw badInput(scope, path, `the input nests deeper than ${MAX_DEPTH} levels`)
  if (Array.isArray(value)) return value.map((item, i) => resolve(item, [...path, i], scope))
  if (!isPlainObject(value)) return value
  if (Object.hasOwn(value, '$ref')) return follow(value, path, scope)
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, resolve(inner, [...path, key], scope)]))
}

/** The bad input of the scope's step, at `path`. */
function badInput(scope: Scope, path: InputPath, message: string) {
  return new CommandError(scope.command, { kind: 'input', issues: [{ path, message }] })
}

/** What the step reference `ref`, at `path`, stands for: an earlier step's result, or the part `field` names. */
function follow(ref: Record<string, unknown>, path: InputPath, scope: Scope): unknown {
  const fail = (message: string) => badInput(scope, path, message)
  const other = Object.keys(ref).find((key) => key !== '$ref' && key !== 'field')
  if (other !== undefined) throw fail(`a "$ref" takes only \`field\` beside it, not \`${other}\``)
  const name = ref['$ref']
  if (typeof name !== 'string') throw fail('"$ref" must be a step name (a string)')
  const step = scope.names.get(name)
  if (step === undefined) throw fail(`"$ref" "${name}" names no step (${known(scope.names)})`)
  if (step >= scope.step) throw fail(`"$ref" "${name}" is step ${step}, not an earlier step`)
  const result = scope.results[step]
  const field = ref['field']
  if (field === undefined) {
    if (typeof result === 'string') return result
    throw fail(`step ${step}'s result is ${kindOf(result)}: say which part of it with \`field\``)
  }
  if (typeof field !== 'string') throw fail('`field` must be a string')
  if (typeof result === 'string')
    throw fail(
      `step ${step}'s result is a string (${JSON.stringify(result)}), which has no fields: drop \`field\` and write { "$ref": ${JSON.stringify(name)} } alone`,
    )
  const found = lookup(result, field)
  if ('missing' in found) throw fail(`step ${step}'s result has no \`${field}\`${found.missing}`)
  return found.value
}

/** The step names there are, for a reference to one there is not. */
function known(names: ReadonlyMap<string, number>) {
  if (names.size === 0) return 'no step has an `as` name'
  return [...names].map(([name, step]) => `"${name}" is step ${step}`).join(', ')
}

function kindOf(value: unknown) {
  if (value === undefined || value === null) return 'nothing'
  if (Array.isArray(value)) return 'a list'
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`
}

/** `path` in `value`: a key as written, else a slash path (`0`, `boxes/0`, `/boxes/0`); `missing` says where it ends. */
function lookup(value: unknown, path: string): { value: unknown } | { missing: string } {
  if (isPlainObject(value) && Object.hasOwn(value, path)) return { value: value[path] }
  let here = value
  const walked: string[] = []
  for (const part of path.replace(/^\//, '').split('/')) {
    const where = walked.length === 0 ? 'the result' : `\`${walked.join('/')}\``
    if (Array.isArray(here)) {
      if (!/^(0|[1-9]\d*)$/.test(part))
        return { missing: `: ${where} is a list, so \`${part}\` must be a place in it (0, 1, …)` }
      const i = Number(part)
      if (i >= here.length) return { missing: `: ${where} has ${here.length} item${here.length === 1 ? '' : 's'}` }
      here = here[i]
    } else if (isPlainObject(here)) {
      if (!Object.hasOwn(here, part)) return { missing: walked.length === 0 ? '' : `: ${where} has no \`${part}\`` }
      here = here[part]
    } else return { missing: `: ${where} is ${kindOf(here)}` }
    walked.push(part)
  }
  return { value: here }
}
