import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it } from 'vitest'

import { mcpLog, REFUSAL_CHARS } from './mcp-log.ts'

/** A log writing into `lines`, each parsed, on a clock that moves `stepMs` each time it is read. */
function testLog(stepMs = 0) {
  const lines: Record<string, unknown>[] = []
  let time = 0
  const log = mcpLog(
    (line) => lines.push(JSON.parse(line)),
    () => (time += stepMs),
  )
  return { log, lines }
}

/** A tool error telling `sentence`. */
function refusal(sentence: string): CallToolResult {
  return { content: [{ type: 'text', text: sentence }], isError: true }
}

/** The refusal a call answering `sentence` is logged with. */
async function loggedRefusal(sentence: string): Promise<unknown> {
  const { log, lines } = testLog()
  await log.call('batch', async () => refusal(sentence))
  return lines[0]?.refusal
}

describe('mcpLog', () => {
  it('logs an answered call with its tool and whole milliseconds, and nothing of its answer', async () => {
    const { log, lines } = testLog(12.6)
    const answer: CallToolResult = { content: [{ type: 'text', text: '{"name":"Summer sale"}' }] }
    expect(await log.call('read_frame', async () => answer)).toBe(answer)
    expect(lines).toEqual([{ event: 'tool call', tool: 'read_frame', ms: 13, refused: false }])
  })

  it('logs a refused call with its sentence, each quoted value left out', async () => {
    const { log, lines } = testLog()
    await log.call('run_command', async () =>
      refusal('run_command: the layer “Big sale” can’t move; `frame` is required. Font "Brand Sans" is missing.'),
    )
    expect(lines).toEqual([
      {
        event: 'tool call',
        tool: 'run_command',
        ms: 0,
        refused: true,
        refusal: 'run_command: the layer “…” can’t move; `…` is required. Font "…" is missing.',
      },
    ])
  })

  it('leaves out all a refusal quotes from its first mark to its last, so a mark inside a value hides nothing', async () => {
    expect(await loggedRefusal('There is no command “x” secret”; list_commands lists them.')).toBe(
      'There is no command “…”; list_commands lists them.',
    )
    expect(await loggedRefusal('"a" is not under "b"')).toBe('"…"')
  })

  it('keeps the first REFUSAL_CHARS characters of a refusal, whole emoji included', async () => {
    expect(await loggedRefusal(`${'x'.repeat(REFUSAL_CHARS - 1)}🐝 and more after it`)).toBe(
      `${'x'.repeat(REFUSAL_CHARS - 1)}🐝`,
    )
  })

  it('names an MCP session the same when it opens and ends, never by its id', () => {
    const { log, lines } = testLog()
    log.opened('3f0c1e2a-session-id')
    log.ended('3f0c1e2a-session-id', 'idle')
    log.opened('another-session-id')
    const [opened, ended, other] = lines
    expect(opened).toEqual({ event: 'mcp session opened', session: expect.stringMatching(/^[0-9a-f]{12}$/) })
    expect(ended).toEqual({ event: 'mcp session ended', session: opened?.session, why: 'idle' })
    expect(other?.session).not.toBe(opened?.session)
    expect(JSON.stringify(lines)).not.toContain('session-id')
  })
})
