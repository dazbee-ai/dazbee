// The rules every tool keeps: a title, a description an agent can work from, annotations, a strict input
// whose unknown arguments are refused by name, and every failure told as a tool error in a sentence.
import type { CallToolResult, Tool as ToolListing } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import type { AgentMe } from '@dazbee/schema'

import { type AgentApi, ApiRefusal, TokenRefused } from '../api.ts'
import { ANSWER_ENVELOPE_BYTES, inMiB, MAX_ANSWER_BYTES } from '../limits.ts'
import type { SessionDesign } from '../open-design.ts'
import type { DrawnRender, FrameRender } from '../render-queue.ts'

/** The renders the calling access may ask for: its bucket, and the process's queue they are drawn from. */
export interface AccessRenders {
  /** The whole seconds to wait when the queue would refuse the access's render as busy; else 0. */
  busy(): number
  /** Takes one render from the access's bucket, giving 0; or, when it is empty, the whole seconds until one is back. */
  take(): number
  /** Takes `count` more renders from the access's bucket, below empty if need be. */
  charge(count: number): void
  /** The render `make` gives, made once its turn in the queue comes and drawn on the worker. */
  draw(make: () => Promise<FrameRender>): Promise<DrawnRender>
}

/**
 * What a tool call runs with: the API as the calling agent sees it, the agent's access, its session's design, and
 * the renders it may ask for.
 */
export interface ToolContext {
  api: AgentApi
  agent: AgentMe
  design: SessionDesign
  renders: AccessRenders
}

/** A tool as the server offers it. */
export interface Tool {
  name: string
  listing: ToolListing
  call(args: unknown, context: ToolContext): Promise<CallToolResult>
}

/** A tool as it is written: its input as a zod object and what it does with it. */
export interface ToolDefinition<S extends z.ZodObject> {
  name: string
  title: string
  /** What the tool does and answers, for the agent to choose it by: more than 40 characters. */
  description: string
  /** Whether the tool only reads: it changes nothing in the workspace or a design. */
  readOnly: boolean
  input: S
  /**
   * What the tool answers: text as it is, anything else as JSON, and `WithNotes`'s notes after it. It throws
   * `ToolRefusal` with a sentence.
   */
  run(input: z.output<S>, context: ToolContext): Promise<unknown>
}

/** A tool's refusal, in a sentence the agent reads. */
export class ToolRefusal extends Error {}

/** A tool's answer that is a picture: the PNG as an image block, then `value` as a text block. */
export class WithPicture {
  readonly png: Uint8Array
  readonly value: unknown
  constructor(png: Uint8Array, value: unknown) {
    this.png = png
    this.value = value
  }
}

/** A tool's answer with sentences told after it, each a text block of its own. */
export class WithNotes {
  readonly value: unknown
  readonly notes: readonly string[]
  constructor(value: unknown, notes: readonly string[]) {
    this.value = value
    this.notes = notes
  }
}

/** A tool keeping the rules above, from its definition. */
export function defineTool<S extends z.ZodObject>(definition: ToolDefinition<S>): Tool {
  const { name, title, description, readOnly, input } = definition
  if (description.length <= 40) throw new Error(`${name}: a tool’s description is more than 40 characters`)
  const inputSchema = withoutDialect(z.toJSONSchema(input.strict(), { io: 'input' }))
  const listing = {
    name,
    title,
    description,
    inputSchema: inputSchema as ToolListing['inputSchema'],
    annotations: { title, readOnlyHint: readOnly, destructiveHint: false, openWorldHint: false },
  } satisfies ToolListing

  return { name, listing, call }

  async function call(args: unknown, context: ToolContext): Promise<CallToolResult> {
    const given = args ?? {}
    if (typeof given !== 'object' || Array.isArray(given)) return refused('The arguments must be an object')
    const unknown = Object.keys(given).filter((key) => !Object.hasOwn(input.shape, key))
    if (unknown.length > 0) return refused(unknownArguments(name, unknown, Object.keys(input.shape)))
    const parsed = input.safeParse(given)
    if (!parsed.success) return refused(inputIssues(parsed.error, given))
    try {
      return answer(await definition.run(parsed.data, context))
    } catch (error) {
      if (error instanceof ToolRefusal || error instanceof ApiRefusal || error instanceof TokenRefused)
        return refused(error.message)
      console.error(`the tool ${name} failed`, error)
      return refused(`${name} failed on Dazbee’s side; try again, and if it fails again, carry on without it`)
    }
  }
}

/** A JSON Schema without its `$schema` dialect line, which an agent has no use for. */
export function withoutDialect(schema: object): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...schema }
  delete copy.$schema
  return copy
}

/** The bytes a text takes in an answer, written as a JSON string. */
export function answerBytes(text: string): number {
  return Buffer.byteLength(JSON.stringify(text))
}

/** A tool error: the sentence, ending with a full stop. */
function refused(sentence: string): CallToolResult {
  return { content: [{ type: 'text', text: /[.?!]$/.test(sentence) ? sentence : `${sentence}.` }], isError: true }
}

/** The sentence refusing arguments the tool doesn't take, naming the ones it does. */
function unknownArguments(tool: string, unknown: string[], takes: string[]): string {
  const names = unknown.map((key) => `\`${key}\``).join(', ')
  const accepted = takes.length === 0 ? 'none' : takes.join(', ')
  return `Unknown argument${unknown.length === 1 ? '' : 's'} ${names} (${tool} takes ${accepted})`
}

/** The input's issues as one sentence: each argument and what is wrong with it, or that it is missing. */
function inputIssues(error: z.ZodError, given: object): string {
  return error.issues
    .map((issue) => {
      const at = issue.path.length > 0 ? `\`${issue.path.join('.')}\`` : 'The input'
      const [key] = issue.path
      const missing = issue.path.length === 1 && key !== undefined && Reflect.get(given, key) === undefined
      return missing ? `${at} is required` : `${at}: ${issue.message}`
    })
    .join('; ')
}

/**
 * The tool's answer as a text block, after its picture's image block when it has one, and a text block for each note;
 * or a tool error when it would not fit an answer.
 */
function answer(given: unknown): CallToolResult {
  const [answered, notes] = given instanceof WithNotes ? [given.value, given.notes] : [given, []]
  const [value, picture] =
    answered instanceof WithPicture ? [answered.value, Buffer.from(answered.png).toString('base64')] : [answered]
  const texts = [typeof value === 'string' ? value : JSON.stringify(value), ...notes]
  const bytes = texts.reduce((sum, text) => sum + answerBytes(text), picture === undefined ? 0 : answerBytes(picture))
  if (bytes > MAX_ANSWER_BYTES - ANSWER_ENVELOPE_BYTES)
    return refused(
      `The answer is ${inMiB(bytes)}, more than the ${inMiB(MAX_ANSWER_BYTES)} an answer may be; ask for less`,
    )
  const image = picture === undefined ? [] : [{ type: 'image' as const, data: picture, mimeType: 'image/png' }]
  return { content: [...image, ...texts.map((text) => ({ type: 'text' as const, text }))] }
}
