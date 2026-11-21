import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it } from 'vitest'

import { mcpLog, REFUSAL_CHARS } from './mcp-log.ts'

/** A log writing into `lines`, each parsed. */
function testLog() {
  const lines: unknown[] = []
  return { log: mcpLog((line) => lines.push(JSON.parse(line))), lines }
}

/** A tool error telling `sentence`. */
function refusal(sentence: string): CallToolResult {
  return { content: [{ type: 'text', text: sentence }], isError: true }
}

describe('mcpLog', () => {
  it('logs an answered call with its tool and whole milliseconds, and nothing of its answer', () => {
    const { log, lines } = testLog()
    log.call('read_frame', 12.6, { content: [{ type: 'text', text: '{"name":"Summer sale"}' }] })
    expect(lines).toEqual([{ event: 'tool call', tool: 'read_frame', ms: 13, refused: false }])
  })

  it('logs a refused call with its sentence, each quoted value left out', () => {
    const { log, lines } = testLog()
    log.call(
      'run_command',
      3,
      refusal('node.update: "layer-1" is a text, not a box; nothing was changed. Font “Brand Sans” is missing.'),
    )
    expect(lines).toEqual([
      {
        event: 'tool call',
        tool: 'run_command',
        ms: 3,
        refused: true,
        refusal: 'node.update: "…" is a text, not a box; nothing was changed. Font “…” is missing.',
      },
    ])
  })

  it('keeps the first REFUSAL_CHARS characters of a refusal, whole emoji included', () => {
    const { log, lines } = testLog()
    log.call('batch', 0, refusal(`${'x'.repeat(REFUSAL_CHARS - 1)}🐝 and more after it`))
    expect((lines[0] as { refusal: string }).refusal).toBe(`${'x'.repeat(REFUSAL_CHARS - 1)}🐝`)
  })

  it('names an MCP session the same when it opens and ends, never by its id', () => {
    const { log, lines } = testLog()
    log.opened('3f0c1e2a-session-id')
    log.ended('3f0c1e2a-session-id', 'idle')
    log.opened('another-session-id')
    const [opened, ended, other] = lines as { session: string }[]
    expect(opened).toEqual({ event: 'mcp session opened', session: expect.stringMatching(/^[0-9a-f]{12}$/) })
    expect(ended).toEqual({ event: 'mcp session ended', session: opened?.session, why: 'idle' })
    expect(other?.session).not.toBe(opened?.session)
    expect(JSON.stringify(lines)).not.toContain('session-id')
  })
})
