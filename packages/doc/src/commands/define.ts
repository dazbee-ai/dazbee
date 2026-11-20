import { z } from 'zod'

import type { Design } from '@dazbee/schema'

import type { StoreWrite } from '../store.ts'
import { endingEditedBindings } from './bound-edits.ts'
import type { StepName } from './step-names.ts'

export interface CommandContext {
  /** Where the command writes, reading what it wrote so far. */
  w: StoreWrite
  /** The design as it was before this command, validated. */
  design: Design
  /** A fresh id, for what the command adds. */
  newId: () => string
}

/**
 * One way to change a design (ADR-0004). `input` refuses a key it does not name, in every object
 * in it; a record such as `props` or `patch` stays open, for `check` to settle. `check` sees the
 * validated design and returns a reason to refuse; `apply` then writes through `w` inside one
 * transaction. It must not throw: the session puts back what a command that throws wrote, as a fault.
 * `batchable` says it may run in a batch, whose commands all get the design from before it as
 * `design`; what earlier commands of the batch wrote is read through `w` (as `text.edit` reads its
 * text). It only changes properties of layers, frames or pages that exist. Any other command is
 * refused there.
 */
export interface Command<I extends z.ZodType, R> {
  name: string
  /**
   * What the command changes and what it refuses, in one or two plain sentences, for a reader who
   * has not seen the code, such as an agent. Each field of `input` says what it is with `.describe`.
   */
  description: string
  /** The undo step it makes when it runs alone, or first in a gesture or batch that names none. */
  step: StepName
  /** The undo step it makes for this input, in place of `step`, for a command that does one of two things. */
  stepOf?: (input: z.output<I>) => StepName
  input: I
  /** May run in a batch: it adds, removes, moves, reorders and re-parents nothing. */
  batchable?: true
  /**
   * Sets bindings itself: the rule that a hand edit ends a binding (bound-edits.ts) leaves it
   * alone, so each binding stays as it wrote it.
   */
  setsBindings?: true
  check?: (ctx: CommandContext, input: z.output<I>) => string | undefined
  apply: (ctx: CommandContext, input: z.output<I>) => R
}

/** One thing wrong with a command's input: where it is, as keys and list positions, and what is wrong. */
export interface InputIssue {
  path: (string | number)[]
  message: string
}

/** The parts of a schema type's definition that hold the types inside it. */
interface Inside {
  shape?: Record<string, z.ZodType>
  catchall?: z.ZodType
  element?: z.ZodType
  valueType?: z.ZodType
  options?: z.ZodType[]
  items?: z.ZodType[]
  rest?: z.ZodType | null
  innerType?: z.ZodType
  in?: z.ZodType
  out?: z.ZodType
}

/**
 * The kinds of schema type that hold no type inside them, and the kinds whose inside the walk
 * over a type knows where to find (see `Inside`). A type of any other kind could hold an object
 * the walk never sees.
 */
const KINDS_WITH_NOTHING_INSIDE = [
  'string',
  'number',
  'boolean',
  'literal',
  'enum',
  'template_literal',
  'null',
  'undefined',
  'unknown',
  'never',
  'transform',
]
const KINDS_WALKED = ['object', 'array', 'record', 'union', 'tuple', 'optional', 'nullable', 'default', 'pipe']

/**
 * A command refused, as data: `input` when its input is not one the schema takes, with the
 * schema's `issues` and where each is; `refused` when its check refused it on the design as it is.
 * `reason` says why in words, and the message is the command's name and the reason.
 */
export class CommandError extends Error {
  readonly command: string
  readonly kind: 'input' | 'refused'
  readonly reason: string
  readonly issues: readonly InputIssue[]
  constructor(command: string, refusal: { kind: 'refused'; reason: string } | { kind: 'input'; issues: InputIssue[] }) {
    const reason =
      refusal.kind === 'input'
        ? refusal.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
        : refusal.reason
    super(`${command}: ${reason}`)
    this.name = 'CommandError'
    this.command = command
    this.kind = refusal.kind
    this.reason = reason
    this.issues = refusal.kind === 'input' ? refusal.issues : []
  }
}

/**
 * A command as given, once its input is found to refuse every key it does not name, its `apply`
 * ending each binding whose value it changes (bound-edits.ts) unless it `setsBindings`. An input
 * holding a kind of type the check does not know is refused too, as it can't be checked.
 */
export function defineCommand<I extends z.ZodType, R>(command: Command<I, R>) {
  const loose: string[] = []
  try {
    strictly(command.input, [], loose)
  } catch (error) {
    throw new Error(`${command.name}: ${error instanceof Error ? error.message : String(error)}`)
  }
  if (loose.length > 0)
    throw new Error(`${command.name}: the object at ${loose.join(', ')} takes keys it does not name`)
  return command.setsBindings ? command : { ...command, apply: endingEditedBindings(command.apply) }
}

/**
 * A schema type with every object in it strict, however deep, so it refuses a key it does not
 * name; all else about it stays. For a design schema type inside a command's input. It throws on
 * a kind of type it does not know how to look inside.
 */
export function strict<T extends z.ZodType>(type: T): T {
  return strictly(type, [], []) as T
}

/**
 * Calls `visit` on each type inside a type's definition, with where it sits (a field's name, `[]`
 * in a list or a tuple's rest, `{}` in a record, `|n` in a union, `[n]` in a tuple, nothing in a
 * wrapper or a pipe) and whether it is an object's field, and gives the parts of the definition
 * made of what each call returns.
 */
export function mapInside(type: z.ZodType, visit: (inside: z.ZodType, where: string, field: boolean) => z.ZodType) {
  const def = type.def as z.ZodType['def'] & Inside
  const made: Inside = {}
  if (def.shape)
    made.shape = Object.fromEntries(Object.entries(def.shape).map(([key, field]) => [key, visit(field, key, true)]))
  if (def.element) made.element = visit(def.element, '[]', false)
  if (def.valueType) made.valueType = visit(def.valueType, '{}', false)
  if (def.options) made.options = def.options.map((option, i) => visit(option, `|${i}`, false))
  if (def.items) made.items = def.items.map((item, i) => visit(item, `[${i}]`, false))
  if (def.rest) made.rest = visit(def.rest, '[]', false)
  if (def.innerType) made.innerType = visit(def.innerType, '', false)
  if (def.in) made.in = visit(def.in, '', false)
  if (def.out) made.out = visit(def.out, '', false)
  return made
}

/**
 * A type made strict (see `strict`), adding to `loose` where each object in it that was not strict
 * sits: a field's name, `[]` in a list, `{}` in a record, `|n` in a union, `[n]` in a tuple.
 */
function strictly(type: z.ZodType, path: string[], loose: string[]): z.ZodType {
  const def = type.def as z.ZodType['def'] & Inside
  if (KINDS_WITH_NOTHING_INSIDE.includes(def.type)) return type
  if (!KINDS_WALKED.includes(def.type)) {
    const where = path.join('.') || 'the input'
    throw new Error(`the ${def.type} at ${where} is a kind of type the check of strictness does not know`)
  }
  if (def.shape && def.catchall?.def.type !== 'never') loose.push(path.join('.') || 'the input')
  const made = mapInside(type, (inside, where) => strictly(inside, where ? [...path, where] : path, loose))
  if (def.shape) made.catchall = z.never()
  return Object.keys(made).length > 0 ? type.clone({ ...def, ...made }) : type
}
