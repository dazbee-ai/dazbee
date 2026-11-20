import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it } from 'vitest'

import { commandCatalog } from '@dazbee/doc'
import { BRAND_ROLE_TOKENS } from '@dazbee/schema'

import { TOOLS } from './endpoint.ts'
import { type TestClient, type TestServer, testServer } from './test-client.ts'

let server: TestServer

afterEach(async () => {
  await server.endpoint.close()
})

/** Each prompt's arguments it can be given, all of them filled. */
const FILLED: Record<string, Record<string, string>> = {
  make_ad: { brand: 'Summer', message: 'Half price this weekend', sizes: '1080x1080, 1200x628' },
  add_sizes: { frame: 'sq', sizes: '1080x1920' },
  review_frames: { page: 'p1' },
}

/** A client of a new access, connected to a new server. */
async function agentOf(): Promise<TestClient> {
  server = testServer()
  return server.connect(server.api.addAccess().token())
}

/** The one user message's text the prompt gives with `args`. */
async function promptText(agent: TestClient, name: string, args: Record<string, string>): Promise<string> {
  const { messages } = await agent.client.getPrompt({ name, arguments: args })
  expect(messages).toHaveLength(1)
  const [message] = messages
  expect(message?.role).toBe('user')
  return message?.content.type === 'text' ? message.content.text : ''
}

/** The error getting the prompt answers, which it must. */
async function promptError(agent: TestClient, name: string, args: Record<string, string>): Promise<McpError> {
  const error = await agent.client.getPrompt({ name, arguments: args }).then(
    () => undefined,
    (thrown: unknown) => thrown,
  )
  expect(error).toBeInstanceOf(McpError)
  return error as McpError
}

describe('the prompts', () => {
  it('lists make_ad, add_sizes and review_frames with their arguments, and which are required', async () => {
    const agent = await agentOf()
    const { prompts } = await agent.client.listPrompts()
    expect(
      prompts.map(({ name, arguments: args = [] }) => [
        name,
        args.map(({ name: arg, required }) => [arg, required ?? false]),
      ]),
    ).toEqual([
      [
        'make_ad',
        [
          ['brand', true],
          ['message', true],
          ['sizes', false],
        ],
      ],
      [
        'add_sizes',
        [
          ['frame', true],
          ['sizes', true],
        ],
      ],
      ['review_frames', [['page', false]]],
    ])
    for (const prompt of prompts) {
      expect(prompt.description?.length).toBeGreaterThan(40)
      for (const arg of prompt.arguments ?? []) expect(arg.description?.length).toBeGreaterThan(10)
    }
  })

  it('puts the arguments in, or their defaults, and ends each plan with the shared check', async () => {
    const agent = await agentOf()
    const ad = await promptText(agent, 'make_ad', { brand: 'Summer', message: 'Half price this weekend' })
    expect(ad).toContain('Summer')
    expect(ad).toContain('Half price this weekend')
    expect(ad).toContain('1080x1080, 1080x1920, 1200x628')
    const review = await promptText(agent, 'review_frames', {})
    expect(review).toContain('the first page read_design lists')
    const ends = await Promise.all(Object.entries(FILLED).map(([name, args]) => promptText(agent, name, args)))
    const check = ends.map((text) => text.slice(text.lastIndexOf('\n\n')))
    expect(new Set(check).size).toBe(1)
    for (const step of ['read_frame', 'render_frame', 'check_frame', 'ids']) expect(check[0]).toContain(step)
    for (const text of ends) expect(text).not.toMatch(/\{[a-z]+\}/)
  })

  it('names only commands the catalog has, tools the server offers and brand roles every kit has', async () => {
    const agent = await agentOf()
    const commands = new Set(commandCatalog().map(({ name }) => name))
    const kinds = [...new Set([...commands].map((name) => name.split('.')[0]))]
    const commandLike = new RegExp(`\\b(?:${kinds.join('|')})\\.[a-zA-Z]+\\b`, 'g')
    const tools = new Set(TOOLS.map(({ name }) => name))
    for (const [name, args] of Object.entries(FILLED)) {
      const text = await promptText(agent, name, args)
      const named = text.match(commandLike) ?? []
      expect(named.length, name).toBeGreaterThan(0)
      for (const command of named) expect(commands, `${name}: ${command}`).toContain(command)
      for (const tool of text.match(/\b[a-z]+(?:_[a-z]+)+\b/g) ?? []) expect(tools, `${name}: ${tool}`).toContain(tool)
      for (const [, token] of text.matchAll(/\bbrand:([a-z]+)\b/g))
        expect(BRAND_ROLE_TOKENS, `${name}: brand:${token}`).toContain(token)
    }
  })

  it('refuses a required argument left out or blank, an argument it doesn’t take and a prompt there is none of', async () => {
    const agent = await agentOf()
    const missing = await promptError(agent, 'make_ad', { brand: 'Summer' })
    expect(missing.code).toBe(ErrorCode.InvalidParams)
    expect(missing.message).toContain('make_ad needs `message`')
    const blank = await promptError(agent, 'add_sizes', { frame: '  ', sizes: '1080x1920' })
    expect(blank.message).toContain('add_sizes needs `frame`')
    const unknown = await promptError(agent, 'review_frames', { pages: 'p1' })
    expect(unknown.code).toBe(ErrorCode.InvalidParams)
    expect(unknown.message).toContain('Unknown argument `pages` (review_frames takes page)')
    const none = await promptError(agent, 'make_logo', {})
    expect(none.code).toBe(ErrorCode.InvalidParams)
    expect(none.message).toContain('Prompt make_logo not found')
  })

  it('puts an argument in once, never expanding what it holds again', async () => {
    const agent = await agentOf()
    const bomb = '{message}{sizes}{brand}'.repeat(1000)
    const text = await promptText(agent, 'make_ad', { brand: bomb, message: '{brand}' })
    expect(text).toContain(bomb)
    expect(text).toContain('{brand}')
    const plain = await promptText(agent, 'make_ad', { brand: 'B', message: 'M' })
    expect(text.length - plain.length).toBeLessThan(3 * bomb.length)
  })
})
