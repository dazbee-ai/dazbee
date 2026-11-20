import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'

import { MAX_ANSWER_BYTES, MAX_BODY_BYTES } from './limits.ts'
import { BASE_URL, type TestServer, testServer, textOf } from './test-client.ts'
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
    const token = server.api.grant().token()
    const response = await server.fetch(post(token, '{'.repeat(MAX_BODY_BYTES + 1), true))
    // A body read and parsed would answer 400, a parse error.
    expect(response.status).toBe(413)
  })

  it('refuses a streamed body once it passes 4 MiB (413), without parsing it', async () => {
    server = testServer()
    const token = server.api.grant().token()
    const response = await server.fetch(post(token, stream(MAX_BODY_BYTES + 1), false))
    expect(response.status).toBe(413)
  })

  it('takes a body of 4 MiB', async () => {
    server = testServer()
    const token = server.api.grant().token()
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
