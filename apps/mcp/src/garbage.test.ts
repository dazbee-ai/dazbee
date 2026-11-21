// The garbage walk: no input takes the MCP server down. Each seed opens a server on a design holding every kind of
// layer and sends, from the seed alone, random arguments to every tool, a random input to a command through
// run_command and random steps through batch, a resource to read, a prompt with random arguments, a line that is not
// JSON and a JSON-RPC message with a random method and params; after each, ping answers and read_design still reads
// the open design, opened again after close_design. GARBAGE_SEEDS runs the seeds it names (`GARBAGE_SEEDS=17`,
// `3,17` or `1-1000`), so a seed that fails runs alone.
import type { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Prompt } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { commandCatalog, openSession, readDesign } from '@dazbee/doc'
import { COMMAND_INPUTS, sweepWorld } from '@dazbee/doc/test-commands'
import { kindsDesign } from '@dazbee/doc/test-design'
import { openTestStore } from '@dazbee/doc/test-store'
import { seeded, walkSeeds } from '@dazbee/doc/test-walk'
import type { Design, DesignInput } from '@dazbee/schema'

import { TOOLS } from './endpoint.ts'
import { PROMPTS } from './prompts.ts'
import { type TestClient, type TestServer, testServer, textOf } from './test-client.ts'

/** A JSON Schema, as far as the walk reads one. */
interface Schema {
  type?: string | string[]
  properties?: Record<string, Schema>
  required?: string[]
  items?: Schema
  anyOf?: Schema[]
  oneOf?: Schema[]
  enum?: unknown[]
  const?: unknown
  minimum?: number
  maximum?: number
  minItems?: number
}

/** A round's world: its server, the server's client with the design open, the design it holds and what picks at random. */
interface Round {
  server: TestServer
  agent: TestClient
  design: Design
  inputs: ReturnType<typeof sweepWorld>
  random: () => number
  /** The problems the round found, each in words. */
  problems: string[]
}

/** The rounds the walk takes, one per seed. */
const SEEDS = walkSeeds(
  Array.from({ length: 256 }, (_, i) => i + 1),
  'GARBAGE_SEEDS',
)
/** The walk takes a while: each round opens a server and makes a few dozen calls. */
const WALK_TIMEOUT = 600_000
/** The design the walk opens. */
const LAUNCH = { brand: 'brand-summer', design: 'design-launch' }
/** Limits high enough that the walk's calls are never refused as too many. */
const NO_RATE_LIMITS = { callsBurst: 1_000_000, rendersBurst: 1_000_000, designsPerHour: 1_000_000 }
/** Every command, design.restore included, with its input's schema. */
const COMMANDS = commandCatalog().map(({ name, input }) => ({ name, input: input as Schema }))
/** Every tool, with its arguments' schema. */
const TOOL_ARGS = TOOLS.map(({ name, listing }) => ({ name, input: listing.inputSchema as Schema }))
/** The methods a random JSON-RPC message calls. */
const METHODS = [
  'initialize',
  'tools/call',
  'tools/list',
  'resources/read',
  'resources/list',
  'prompts/get',
  'prompts/list',
  'ping',
  'notifications/initialized',
  'x',
]
/** The characters random strings are made of: placeholders, quotes, escapes, a right-to-left mark and an emoji. */
const CHARS = [...'abz#09 .:/{}-"\\$_é\u200f😀']
/** Numbers at the edges: as large as a number gets, the smallest, a negative zero and past what an integer holds. */
const EDGE_NUMBERS = [0, -0, 1, -1, 1e300, -1e300, 5e-324, 2 ** 53 + 2, -(2 ** 31), 0.5, 65_536]
/** Strings an argument may name: brands, designs, images, commands, tokens and colours. */
const NAMED = [
  'brand-summer',
  'brand-winter',
  'design-launch',
  'asset-logo',
  'asset-bottle',
  'brand:primary',
  'brand:logo',
  '#FF0000FF',
  'Noto Sans',
  ...COMMANDS.map(({ name }) => name),
]
/** What a string property holds, by its name. */
const KEY_HINTS: [RegExp, (design: Design) => string[]][] = [
  [/frame/i, (design) => Object.keys(design.frames)],
  [/page/i, (design) => Object.keys(design.pages)],
  [/^brand$/, () => ['brand-summer', 'brand-winter']],
  [/^design$/, () => ['design-launch']],
  [/^command$/, () => COMMANDS.map(({ name }) => name)],
  [/^(ids?|parentId|before)$/, (design) => Object.keys(design.nodes)],
]
/** Keys that look for trouble in how objects are read. */
const TRAP_KEYS = ['__proto__', 'constructor', 'prototype', '$ref', 'field', 'toString']

let server: TestServer | undefined

afterEach(async () => {
  await server?.endpoint.close()
  server = undefined
  vi.restoreAllMocks()
})

/** One round of the walk, from `seed` alone: the problems it found. */
async function walkRound(seed: number): Promise<string[]> {
  const round = await openRound(seed)
  const { random } = round
  try {
    for (const { name, input } of TOOL_ARGS)
      await sendThen(
        round,
        `${name} with random arguments`,
        toolCall(name, fromSchema(round, input, 0)),
        name === 'close_design',
      )
    const command = COMMANDS[seed % COMMANDS.length]?.name ?? 'node.update'
    await sendThen(
      round,
      `run_command ${command}`,
      toolCall('run_command', { command, input: commandInput(round, command) }),
    )
    const steps = Array.from({ length: 1 + Math.floor(random() * 4) }, (_, i) => {
      const name = pick(random, COMMANDS).name
      return { command: name, input: commandInput(round, name), ...(random() < 0.5 ? { as: `s${i}` } : {}) }
    })
    await sendThen(round, 'batch', toolCall('batch', { steps }))
    await sendThen(round, 'resources/read', rpc('resources/read', { uri: randomUri(round) }))
    const prompt = pick(random, PROMPTS)
    const name = random() < 0.9 ? prompt.name : randomText(random, 12)
    await sendThen(
      round,
      `prompts/get ${name}`,
      rpc('prompts/get', { name, arguments: promptArguments(round, prompt) }),
    )
    await sendThen(round, 'a line that is not JSON', randomText(random, 200))
    await sendThen(round, 'a random JSON-RPC message', rpc(pick(random, METHODS), randomJson(round, 0)))
    return round.problems
  } finally {
    await server?.endpoint.close()
    server = undefined
  }
}

/** A server on a design holding every kind of layer, its client with the design open, for `seed`. */
async function openRound(seed: number): Promise<Round> {
  const random = seeded(seed)
  const world = openTestStore(kindsDesign())
  const made = openSession(world)
  const inputs = sweepWorld(made, random)
  made.destroy()
  const design = readDesign(world)
  const started = testServer({ designs: { 'design-launch': design as DesignInput }, limits: NO_RATE_LIMITS })
  server = started
  const agent = await started.connect(started.api.addAccess().token())
  const opened = await agent.call('open_design', LAUNCH)
  if (opened.isError) throw new Error(`open_design: ${textOf(opened)}`)
  const round: Round = { server: started, agent, design, inputs, random, problems: [] }
  // A failure the server logs is one it didn't expect: a tool or command that threw where it should have refused.
  vi.spyOn(console, 'error').mockImplementation((...logged: unknown[]) => {
    round.problems.push(`logged ${logged.map((part) => (part instanceof Error ? part.stack : String(part))).join(' ')}`)
  })
  return round
}

/**
 * Sends `body` as one request on the round's session, then checks the server still answers: no request may answer
 * 500; a call of one of the server's tools with an object of arguments answers a result with content, its failure a
 * tool error, and any other tool call a result or a JSON-RPC error; then ping answers and read_design reads the design,
 * opened again first when `reopen` says the call closed it. Each problem goes into the round's, named by `what`.
 */
async function sendThen(round: Round, what: string, body: string, reopen = false): Promise<void> {
  const { agent, problems } = round
  const transport = agent.client.transport as StreamableHTTPClientTransport
  const response = await round.server.fetch(
    new Request('https://app.test/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${agent.token}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-session-id': transport.sessionId ?? '',
      },
      body,
    }),
  )
  const text = await response.text()
  if (response.status >= 500) problems.push(`${what}: answered ${response.status} ${text.slice(0, 300)}`)
  const call = toolCallOf(body)
  if (call && response.status === 200) {
    const answer = JSON.parse(text) as { result?: { content?: unknown }; error?: unknown }
    const answered = Array.isArray(answer.result?.content)
    if (!answered && (call.known || answer.error === undefined))
      problems.push(`${what}: answered no result with content: ${text.slice(0, 300)}`)
  }
  try {
    expect(await agent.client.ping()).toEqual({})
    if (reopen) await agent.call('open_design', LAUNCH)
    const read = await agent.call('read_design')
    if (read.isError) problems.push(`${what}: read_design then answered “${textOf(read)}”`)
    else expect(JSON.parse(textOf(read))).toMatchObject({ name: 'Launch' })
  } catch (error) {
    problems.push(`${what}: then ${String(error)}`)
  }
}

/** A tools/call request for `name` with `args`, as a line. */
function toolCall(name: string, args: unknown): string {
  return rpc('tools/call', { name, arguments: args })
}

/** A JSON-RPC request calling `method` with `params`, as a line. */
function rpc(method: string, params: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })
}

/**
 * Whether `body` is a tools/call request, and `known` when it calls one of the server's tools with an object of
 * arguments, which only a tool error may refuse; undefined for anything else.
 */
function toolCallOf(body: string): { known: boolean } | undefined {
  let message: unknown
  try {
    message = JSON.parse(body)
  } catch {
    return undefined
  }
  const { method, params } = (message ?? {}) as { method?: unknown; params?: { name?: unknown; arguments?: unknown } }
  if (method !== 'tools/call') return undefined
  const args = params?.arguments
  const object = typeof args === 'object' && args !== null && !Array.isArray(args)
  return { known: object && TOOLS.some(({ name }) => name === params?.name) }
}

/** A URI to read: one of the four resources' shapes with a real or random name, a broken escape or random text. */
function randomUri(round: Round): string {
  const { random, design } = round
  const names = [
    ...COMMANDS.map(({ name }) => name),
    ...Object.keys(design.frames),
    ...Object.keys(design.nodes),
    randomText(random, 12),
    encodeURIComponent(randomText(random, 12)),
    '%E0%A4%A',
    '..%2F..',
    '__proto__',
  ]
  return pick(random, [
    'dazbee://commands',
    'dazbee://design',
    `dazbee://command/${pick(random, names)}`,
    `dazbee://frame/${pick(random, names)}`,
    `dazbee://${randomText(random, 12)}`,
    randomText(random, 20),
  ])
}

/** A prompt's arguments: mostly its own, each a string, now and then one left out, one not a string or a trap key. */
function promptArguments(round: Round, prompt: Prompt): Record<string, unknown> {
  const { random } = round
  const given = (prompt.arguments ?? [])
    .filter(() => random() < 0.85)
    .map(({ name }) => [name, random() < 0.95 ? randomString(round) : randomJson(round, 1)] as const)
  const extra = random() < 0.15 ? [[pick(random, TRAP_KEYS), randomString(round)] as const] : []
  return Object.fromEntries([...given, ...extra])
}

/**
 * A random input for `command`: a quarter of the time one the sweep runs it with, as it is; a quarter of the time
 * one with a part below its top swapped for random JSON; otherwise one made from the command's schema.
 */
function commandInput(round: Round, command: string): unknown {
  const { random, inputs } = round
  const swept = COMMAND_INPUTS[command]?.({ ...inputs, random }) ?? []
  const roll = random()
  if (swept.length > 0 && roll < 0.5) {
    const input = JSON.parse(JSON.stringify(pick(random, swept))) as unknown
    return roll < 0.25 ? input : swappedBelow(round, input)
  }
  return fromSchema(round, COMMANDS.find(({ name }) => name === command)?.input, 0)
}

/** `value` with one part below its top, at a random depth, swapped for random JSON. */
function swappedBelow(round: Round, value: unknown): unknown {
  const { random } = round
  if (typeof value !== 'object' || value === null) return randomJson(round, 1)
  const keys = Object.keys(value)
  if (keys.length === 0) return value
  const key = pick(random, keys)
  const part = (value as Record<string, unknown>)[key]
  const swapped =
    typeof part === 'object' && part !== null && random() < 0.5 ? swappedBelow(round, part) : randomJson(round, 1)
  return Array.isArray(value)
    ? value.map((item, i) => (String(i) === key ? swapped : item))
    : { ...value, [key]: swapped }
}

/**
 * A value the JSON Schema `schema` mostly takes: each property it requires and half the others, values of the type
 * it names, in its range or at an edge, from its enum or the design's ids; now and then random JSON, an extra key
 * or one that looks for trouble.
 */
function fromSchema(round: Round, schema: Schema | undefined, depth: number, key = ''): unknown {
  const { random } = round
  if (!schema || depth > 6 || random() < 0.1) return randomJson(round, Math.min(depth, 3))
  const choices = schema.anyOf ?? schema.oneOf
  if (choices && choices.length > 0) return fromSchema(round, pick(random, choices), depth, key)
  if (schema.enum && schema.enum.length > 0) return pick(random, schema.enum)
  if (schema.const !== undefined) return schema.const
  const type = Array.isArray(schema.type) ? pick(random, schema.type) : schema.type
  if (type === 'object' || schema.properties) {
    const required = new Set(schema.required ?? [])
    const entries = Object.entries(schema.properties ?? {})
      .filter(([key]) => (required.has(key) ? random() < 0.95 : random() < 0.5))
      .map(([name, part]) => [name, fromSchema(round, part, depth + 1, name)] as const)
    const extra = random() < 0.05 ? [[pick(random, TRAP_KEYS), randomJson(round, 2)] as const] : []
    return Object.fromEntries([...entries, ...extra])
  }
  if (type === 'array') {
    const least = schema.minItems ?? 0
    const length = least + Math.floor(random() * 4)
    return Array.from({ length }, () => fromSchema(round, schema.items, depth + 1, key))
  }
  if (type === 'string') return randomString(round, key)
  if (type === 'integer' || type === 'number') {
    const roll = random()
    const least = schema.minimum ?? -2000
    const most = schema.maximum ?? 2000
    if (roll < 0.15) return pick(random, EDGE_NUMBERS)
    if (roll < 0.25) return pick(random, [least, most, least - 1, most + 1])
    const value = least + random() * (Math.min(most, least + 4000) - least)
    return type === 'integer' ? Math.round(value) : value
  }
  if (type === 'boolean') return random() < 0.5
  if (type === 'null') return null
  return randomJson(round, Math.min(depth, 3))
}

/** Random JSON up to 3 deep: the leaves often the design's ids, a step reference or a number at an edge. */
function randomJson(round: Round, depth: number): unknown {
  const { random } = round
  const roll = random()
  if (depth < 3 && roll < 0.15)
    return Array.from({ length: Math.floor(random() * 5) }, () => randomJson(round, depth + 1))
  if (depth < 3 && roll < 0.3)
    return Object.fromEntries(
      Array.from({ length: Math.floor(random() * 5) }, () => [randomKey(random), randomJson(round, depth + 1)]),
    )
  if (roll < 0.4) return pick(random, [null, true, false])
  if (roll < 0.5) return pick(random, EDGE_NUMBERS)
  if (roll < 0.6) return Math.round((random() - 0.5) * 4000)
  if (roll < 0.65) return { $ref: pick(random, ['s0', 's1', 's2']) }
  return randomString(round)
}

/**
 * A string: for a property `key` names as a frame, page, brand, design, command or image, mostly one of those; else
 * mostly one of the design's ids, a step's name, a brand's, design's or image's id or token, or random.
 */
function randomString(round: Round, key = ''): string {
  const { random, design } = round
  const roll = random()
  const named = KEY_HINTS.find(([pattern]) => pattern.test(key))
  if (named && roll < 0.6) return pick(random, named[1](design))
  if (roll < 0.5)
    return pick(random, [...Object.keys(design.nodes), ...Object.keys(design.frames), ...Object.keys(design.pages)])
  if (roll < 0.6) return pick(random, ['s0', 's1', 's2'])
  if (roll < 0.75) return pick(random, NAMED)
  return randomText(random, 12)
}

/** A key: one that looks for trouble, or a random one. */
function randomKey(random: () => number): string {
  return random() < 0.5 ? pick(random, TRAP_KEYS) : randomText(random, 8)
}

/** Up to `most` random characters. */
function randomText(random: () => number, most: number): string {
  return Array.from({ length: Math.floor(random() * (most + 1)) }, () => pick(random, CHARS)).join('')
}

/** One of `items`, at random. */
function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T
}

describe('the garbage walk', () => {
  it(
    'answers random arguments, random command inputs and malformed lines, and still answers ping and reads the design after each',
    async () => {
      const failed: string[] = []
      for (const seed of SEEDS) {
        const problems = await walkRound(seed).catch((error: unknown) => [`threw ${String(error)}`])
        if (problems.length > 0) failed.push(`seed ${seed}: ${problems.join('; ')}`)
      }
      expect(failed, 'run a seed alone with GARBAGE_SEEDS=<seed>').toEqual([])
    },
    WALK_TIMEOUT,
  )

  it(
    'answers very deep and very long values, and values at the edge of a number',
    async () => {
      const round = await openRound(1)
      const deep = (open: string, close: string, inner = '1') => `${open.repeat(10_000)}${inner}${close.repeat(10_000)}`
      const long = 'x'.repeat(1_000_000)
      const call = (name: string, args: string) =>
        `{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"${name}","arguments":${args}}}`
      const lines = [
        deep('[', ']', ''),
        deep('{"a":', '}'),
        call('run_command', `{"command":"node.update","input":${deep('[', ']', '')}}`),
        call('run_command', `{"command":"node.update","input":{"ids":${deep('[', ']', '"r1"')}}}`),
        call('batch', `{"steps":[{"command":"node.create","input":${deep('{"$ref":', '}', '"a"')}}]}`),
        call('read_frame', `{"frame":"f","fields":${deep('[', ']', '')}}`),
        `{"jsonrpc":"2.0","id":8,"method":"${long}"}`,
        call(long, '{}'),
        call('run_command', JSON.stringify({ command: 'node.rename', input: { id: 'r1', name: long } })),
        call('list_commands', JSON.stringify({ filter: long })),
        call('read_frame', '{"frame":"f","maxBytes":1e300}'),
        call('render_frame', '{"frame":"f","maxSize":1e300}'),
        call('run_command', '{"command":"node.update","input":{"ids":["r1"],"patch":{"x":1e300,"width":1e300}}}'),
        call('run_command', '{"command":"frame.addSize","input":{"frameId":"f","width":1e300,"height":1e300}}'),
        call('run_command', '{"command":"frame.update","input":{"frameId":"f","x":-1e300,"y":1e300}}'),
        `{"jsonrpc":"2.0","id":1e300,"method":"ping"}`,
        `{"jsonrpc":"2.0","id":9,"method":"resources/read","params":{"uri":"dazbee://frame/${long}"}}`,
        `{"jsonrpc":"2.0","id":10,"method":"prompts/get","params":{"name":"make_ad","arguments":{"brand":"${long}","message":"${long}"}}}`,
      ]
      for (const line of lines) await sendThen(round, line.slice(0, 80), line)
      expect(round.problems).toEqual([])
    },
    WALK_TIMEOUT,
  )
})
