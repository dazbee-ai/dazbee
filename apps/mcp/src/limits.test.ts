import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { testDesign } from '@dazbee/doc/test-design'
import { type DesignInput, SYNC_LIMITS } from '@dazbee/schema'

import {
  ANSWER_MARGIN_MS,
  limitSettings,
  MAX_ANSWER_BYTES,
  MAX_BATCH_STEPS,
  MAX_BODY_BYTES,
  rateBuckets,
  STORE_WAIT_MS,
} from './limits.ts'
import type { RenderThread } from './render-queue.ts'
import type { RenderAnswer, RenderJob } from './render-worker.ts'
import { NOT_CONFIRMED } from './store-wait.ts'
import { TEST_BOTTLE_PNG } from './test-api.ts'
import { BASE_URL, type TestClient, type TestServer, testServer, textOf } from './test-client.ts'
import { defineTool, type ToolContext } from './tools/define-tool.ts'

/** The capacity limits when the environment sets none. */
const LIMITS = limitSettings({})

let server: TestServer | undefined

afterEach(async () => {
  await server?.endpoint.close()
  server = undefined
})

/** A POST to `/mcp` with `token` and `body`, whose `Content-Length` is given when `declared`. */
function post(token: string, body: string | ReadableStream<Uint8Array>, declared: boolean): Request {
  return new Request(`${BASE_URL}/mcp`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body,
    ...(declared ? {} : { duplex: 'half' }),
  })
}

/** The design the render tests open. */
const LAUNCH = { brand: 'brand-summer', design: 'design-launch' }

/** A client of `access` on `server`, with the launch design open. */
async function withDesign(on: TestServer, access: ReturnType<TestServer['api']['addAccess']>): Promise<TestClient> {
  const agent = await on.connect(access.token())
  expect((await agent.call('open_design', LAUNCH)).isError).toBeFalsy()
  return agent
}

/** A render worker that holds each job until released, then answers it with the bottle's PNG. */
function heldWorker() {
  const posted: RenderJob[] = []
  const listeners: ((answer: RenderAnswer) => void)[] = []
  let held = true
  const answer = (job: RenderJob) => {
    for (const listener of listeners)
      listener({ id: job.id, png: TEST_BOTTLE_PNG, width: 4, height: 4, scale: 1, drawMs: 1 })
  }
  const thread: RenderThread = {
    postMessage(job) {
      posted.push(job)
      if (!held) setImmediate(() => answer(job))
    },
    on(event: string, listener: (answer: never) => void) {
      if (event === 'message') listeners.push(listener as (answer: RenderAnswer) => void)
      return thread
    },
    ref() {},
    unref() {},
    terminate: async () => 0,
  }
  return {
    start: () => thread,
    posted,
    release() {
      held = false
      for (const job of posted) answer(job)
    },
  }
}

/** A stream of `bytes` bytes that is not JSON, sent in 64 KiB chunks without a declared length. */
function stream(bytes: number): ReadableStream<Uint8Array> {
  let sent = 0
  return new ReadableStream({
    pull(controller) {
      if (sent >= bytes) return controller.close()
      const chunk = new Uint8Array(Math.min(64 * 1024, bytes - sent)).fill(0x7b)
      sent += chunk.length
      controller.enqueue(chunk)
    },
  })
}

describe('MAX_BODY_BYTES', () => {
  it('refuses a body over 4 MiB with its length declared (413), without parsing it', async () => {
    server = testServer()
    const token = server.api.addAccess().token()
    const response = await server.fetch(post(token, '{'.repeat(MAX_BODY_BYTES + 1), true))
    // A body read and parsed would answer 400, a parse error.
    expect(response.status).toBe(413)
  })

  it('refuses a streamed body once it passes 4 MiB (413), without parsing it', async () => {
    server = testServer()
    const token = server.api.addAccess().token()
    const response = await server.fetch(post(token, stream(MAX_BODY_BYTES + 1), false))
    expect(response.status).toBe(413)
  })

  it('takes a body of 4 MiB', async () => {
    server = testServer()
    const token = server.api.addAccess().token()
    const initialize = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } },
    })
    const body = initialize.padEnd(MAX_BODY_BYTES, ' ')
    expect((await server.fetch(post(token, body, true))).status).toBe(200)
  })
})

describe('MAX_ANSWER_BYTES', () => {
  const context = {} as ToolContext
  const answering = (bytes: number) =>
    defineTool({
      name: 'big',
      title: 'Big',
      description: 'Answers a text of the size the test asks for, to check the answer limit.',
      readOnly: true,
      input: z.object({}),
      run: async () => 'x'.repeat(bytes),
    })

  it('tells an answer over 8 MiB as a tool error', async () => {
    const result = await answering(MAX_ANSWER_BYTES).call({}, context)
    expect(result.isError).toBe(true)
    expect(textOf(result)).toMatch(/more than the 8 MiB an answer may be/)
  })

  it('sends an answer that fits', async () => {
    const result = await answering(MAX_ANSWER_BYTES - 4096).call({}, context)
    expect(result.isError).toBeFalsy()
    expect(textOf(result)).toHaveLength(MAX_ANSWER_BYTES - 4096)
  })
})

describe('STORE_WAIT_MS', () => {
  it('answers that a step is not confirmed yet once the sync server hasn’t stored it for 30 seconds', async () => {
    const started = testServer()
    server = started
    const agent = await started.connect(started.api.addAccess().token())
    await agent.call('open_design', { brand: 'brand-summer', design: 'design-launch' })
    const sync = started.sync('design-launch')
    const store = sync.journal.holdNext()
    const call = agent.call('run_command', { command: 'node.rename', input: { id: 'box', name: 'Card' } })
    await vi.waitFor(() => expect(started.timers()).toBe(1))
    started.wait(STORE_WAIT_MS - 1)
    expect(started.timers()).toBe(1)
    started.wait(1)
    const result = await call
    expect(result.isError).toBeFalsy()
    expect(result.content[1]).toEqual({ type: 'text', text: NOT_CONFIRMED })
    expect(await agent.json('read_design')).toMatchObject({ waiting: 1 })
    store()
    await sync.settle()
    expect(await agent.json('read_design')).toMatchObject({ waiting: 0 })
  })

  it('waits only what is left of the call’s time, and runs nothing for a call that spent it behind another', async () => {
    const callTimeoutMs = 20_000
    const started = testServer({ callTimeoutMs })
    server = started
    const agent = await started.connect(started.api.addAccess().token())
    await agent.call('open_design', { brand: 'brand-summer', design: 'design-launch' })
    const sync = started.sync('design-launch')
    const store = sync.journal.holdNext()
    const first = agent.call('run_command', { command: 'node.rename', input: { id: 'box', name: 'Card' } })
    const second = agent.call('run_command', { command: 'node.rename', input: { id: 'headline', name: 'Title' } })
    await vi.waitFor(() => expect(started.timers()).toBe(1))
    started.wait(callTimeoutMs - ANSWER_MARGIN_MS)
    expect((await first).content[1]).toEqual({ type: 'text', text: NOT_CONFIRMED })
    const late = await second
    expect(late.isError).toBe(true)
    expect(textOf(late)).toBe(
      'This call waited too long behind others on the open design, so nothing ran; try it again.',
    )
    store()
    await sync.settle()
    expect(sync.state().nodes['headline']).toMatchObject({ name: 'Headline' })
  })
})

describe('MAX_BATCH_STEPS', () => {
  it('refuses a batch of more steps before any runs', async () => {
    server = testServer()
    const agent = await server.connect(server.api.addAccess().token())
    await agent.call('open_design', { brand: 'brand-summer', design: 'design-launch' })
    const step = { command: 'node.rename', input: { id: 'box', name: 'Box' } }
    const result = await agent.call('batch', { steps: Array.from({ length: MAX_BATCH_STEPS + 1 }, () => step) })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toBe('`steps`: a batch takes at most 1000 steps; split it.')
    await server.sync('design-launch').settle()
    expect(server.sync('design-launch').sockets[0]?.sent.filter(({ type }) => type === 'changes')).toEqual([])
  })

  it('refuses the step that takes the design past what it may hold, keeping nothing of the batch', async () => {
    // The test design with as many more empty pages as leave room for one.
    const design = testDesign() as { pages: Record<string, { name: string; order: string }> }
    const digits = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
    for (let page = 1; page < SYNC_LIMITS.designPages - 1; page++)
      design.pages[`more-${page}`] = { name: 'More', order: `b${digits[Math.floor(page / 62)]}${digits[page % 62]}` }
    server = testServer({ designs: { 'design-launch': design as DesignInput } })
    const agent = await server.connect(server.api.addAccess().token())
    await agent.call('open_design', { brand: 'brand-summer', design: 'design-launch' })
    const step = { command: 'page.add', input: { name: 'Added', frame: { name: 'Frame', width: 300, height: 250 } } }
    const answer = (await agent.json('batch', { steps: [step, step] })) as { kept: boolean; steps: { ok: boolean }[] }
    expect(answer.kept).toBe(false)
    expect(answer.steps).toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: false, reason: 'the design would hold more than its 1000 pages' }),
    ])
    await server.sync('design-launch').settle()
    expect(Object.keys(server.sync('design-launch').state().pages)).toHaveLength(SYNC_LIMITS.designPages - 1)
  })
})

describe('limitSettings', () => {
  it('takes each limit’s default when unset or empty', () => {
    expect(limitSettings({})).toEqual({
      callsBurst: 60,
      callsPerSecond: 2,
      designsPerHour: 30,
      rendersBurst: 10,
      renderEverySeconds: 6,
      rendersWaiting: 8,
    })
    expect(limitSettings({ MCP_RENDERS_BURST: '', MCP_RENDERS_WAITING: ' ' })).toEqual(limitSettings({}))
  })

  it('reads each limit from its variable', () => {
    const env = {
      MCP_CALLS_BURST: '120',
      MCP_CALLS_PER_SECOND: '5',
      MCP_DESIGNS_PER_HOUR: '10',
      MCP_RENDERS_BURST: '20',
      MCP_RENDER_EVERY_SECONDS: '3',
      MCP_RENDERS_WAITING: '0',
    }
    expect(limitSettings(env)).toEqual({
      callsBurst: 120,
      callsPerSecond: 5,
      designsPerHour: 10,
      rendersBurst: 20,
      renderEverySeconds: 3,
      rendersWaiting: 0,
    })
  })

  it('refuses a value that isn’t a whole number in its range, naming the variable', () => {
    for (const value of ['0', '-1', '1.5', '1e3', 'ten', '1001'])
      expect(() => limitSettings({ MCP_RENDERS_BURST: value })).toThrow(
        `MCP_RENDERS_BURST must be a whole number from 1 to 1000, not “${value}”`,
      )
    expect(() => limitSettings({ MCP_RENDER_EVERY_SECONDS: '0' })).toThrow(/MCP_RENDER_EVERY_SECONDS/)
    expect(() => limitSettings({ MCP_RENDERS_WAITING: '101' })).toThrow(/MCP_RENDERS_WAITING/)
    for (const value of ['0', '2.5', 'ten', '100001'])
      expect(() => limitSettings({ MCP_CALLS_BURST: value })).toThrow(/MCP_CALLS_BURST/)
    expect(() => limitSettings({ MCP_CALLS_PER_SECOND: '0' })).toThrow(/MCP_CALLS_PER_SECOND/)
    expect(() => limitSettings({ MCP_DESIGNS_PER_HOUR: 'x' })).toThrow(/MCP_DESIGNS_PER_HOUR/)
  })

  it('refuses a render past MCP_RENDERS_WAITING waiting as busy, with the seconds to wait', async () => {
    const worker = heldWorker()
    server = testServer({ startRenderWorker: worker.start })
    const { rendersWaiting } = limitSettings({})
    // One render drawn, the ones that may wait, and one more, each from an access of its own.
    const agents: TestClient[] = []
    while (agents.length < rendersWaiting + 2) agents.push(await withDesign(server, server.api.addAccess()))
    const results = agents.map((agent) => agent.call('render_frame', { frame: 'banner' }))
    const refused = await Promise.race(results)
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toMatch(/^Dazbee is drawing other renders; try again in \d+ seconds\.$/)
    worker.release()
    const answered = await Promise.all(results)
    expect(answered.filter((result) => result.isError)).toHaveLength(1)
    expect(worker.posted).toHaveLength(rendersWaiting + 1)
  })
})

describe('rateBuckets', () => {
  it('answers an access’s call past MCP_CALLS_BURST with the seconds to wait, and takes one again once it refills', async () => {
    server = testServer()
    const access = server.api.addAccess()
    const agent = await server.connect(access.token())
    for (let call = 0; call < LIMITS.callsBurst; call++)
      expect((await agent.call('list_commands', { filter: 'page.add' })).isError).toBeFalsy()
    const past = await agent.call('list_commands', { filter: 'page.add' })
    expect(past.isError).toBe(true)
    expect(textOf(past)).toBe('This agent is calling faster than Dazbee takes; try again in 1 second.')
    // Another access has a bucket of its own.
    const other = await server.connect(server.api.addAccess().token())
    expect((await other.call('list_commands', { filter: 'page.add' })).isError).toBeFalsy()
    server.wait(1000 / LIMITS.callsPerSecond)
    expect((await agent.call('list_commands', { filter: 'page.add' })).isError).toBeFalsy()
  })

  it('answers the eleventh render at once from one access with the seconds to wait, refills, and keeps each access’s apart', async () => {
    server = testServer()
    const { rendersBurst, renderEverySeconds } = limitSettings({})
    const agent = await withDesign(server, server.api.addAccess())
    const render = () => agent.call('render_frame', { frame: 'banner', maxSize: 16 })
    for (let rendered = 0; rendered < rendersBurst; rendered++) expect((await render()).isError).toBeFalsy()
    const refused = await render()
    expect(refused.isError).toBe(true)
    expect(textOf(refused)).toBe(
      `This agent has asked for many renders at once; try again in ${renderEverySeconds} seconds.`,
    )
    const other = await withDesign(server, server.api.addAccess())
    expect((await other.call('render_frame', { frame: 'banner', maxSize: 16 })).isError).toBeFalsy()
    server.wait(renderEverySeconds * 1000)
    expect((await render()).isError).toBeFalsy()
  })

  it('charges more renders below empty, and refills from there', () => {
    let time = 0
    const buckets = rateBuckets(10, 6000, () => time)
    expect(buckets.take('ann')).toBe(0)
    buckets.charge('ann', 14)
    // Five below empty: six renders' time before one is back.
    expect(buckets.take('ann')).toBe(36)
    time += 36_000
    expect(buckets.take('ann')).toBe(0)
    expect(buckets.take('bob')).toBe(0)
  })
})

describe('hourRate', () => {
  it('refuses the design past those of an hour with the seconds to wait', async () => {
    server = testServer()
    const access = server.api.addAccess()
    const make = (agent: TestClient) => agent.call('create_design', { brand: 'brand-summer', name: 'Ad' })
    const agent = await server.connect(access.token())
    for (let made = 0; made < LIMITS.designsPerHour; made++) {
      expect((await make(agent)).isError).toBeFalsy()
      server.wait(30_000)
    }
    const past = await make(agent)
    expect(past.isError).toBe(true)
    // The first design was made 15 minutes ago: it leaves the hour in 45 more.
    expect(textOf(past)).toBe('This agent has made as many designs as it may in an hour; try again in 2700 seconds.')
    expect(server.api.designsOf('brand-summer')).toHaveLength(LIMITS.designsPerHour + 1)
    server.wait(2700_000 - 1000)
    // The session ended while the agent was away: a new one counts against the same access.
    const back = await server.connect(access.token())
    expect((await make(back)).isError).toBe(true)
    server.wait(1000)
    expect((await make(back)).isError).toBeFalsy()
  })

  it('counts no design the API refused', async () => {
    server = testServer()
    const agent = await server.connect(server.api.addAccess().token())
    for (let refused = 0; refused <= LIMITS.designsPerHour; refused++)
      expect(textOf(await agent.call('create_design', { brand: 'brand-nowhere', name: 'Ad' }))).toBe('No such brand.')
    expect((await agent.call('create_design', { brand: 'brand-summer', name: 'Ad' })).isError).toBeFalsy()
  })
})
