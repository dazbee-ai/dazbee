import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { limitSettings, MAX_ANSWER_BYTES, MAX_BODY_BYTES, rateBuckets } from './limits.ts'
import type { RenderThread } from './render-queue.ts'
import type { RenderAnswer, RenderJob } from './render-worker.ts'
import { TEST_BOTTLE_PNG } from './test-api.ts'
import { BASE_URL, type TestClient, type TestServer, testServer, textOf } from './test-client.ts'
import { defineTool, type ToolContext } from './tools/define-tool.ts'

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

describe('limitSettings', () => {
  it('takes each limit’s default when unset or empty', () => {
    expect(limitSettings({})).toEqual({ rendersBurst: 10, renderEverySeconds: 6, rendersWaiting: 8 })
    expect(limitSettings({ MCP_RENDERS_BURST: '', MCP_RENDERS_WAITING: ' ' })).toEqual(limitSettings({}))
  })

  it('reads each limit from its variable', () => {
    const env = { MCP_RENDERS_BURST: '20', MCP_RENDER_EVERY_SECONDS: '3', MCP_RENDERS_WAITING: '0' }
    expect(limitSettings(env)).toEqual({ rendersBurst: 20, renderEverySeconds: 3, rendersWaiting: 0 })
  })

  it('refuses a value that isn’t a whole number in its range, naming the variable', () => {
    for (const value of ['0', '-1', '1.5', '1e3', 'ten', '1001'])
      expect(() => limitSettings({ MCP_RENDERS_BURST: value })).toThrow(
        `MCP_RENDERS_BURST must be a whole number from 1 to 1000, not “${value}”`,
      )
    expect(() => limitSettings({ MCP_RENDER_EVERY_SECONDS: '0' })).toThrow(/MCP_RENDER_EVERY_SECONDS/)
    expect(() => limitSettings({ MCP_RENDERS_WAITING: '101' })).toThrow(/MCP_RENDERS_WAITING/)
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
