// The MCP server's log: one JSON line for each tool call and for each MCP session opened and ended, so what fails
// for agents can be read from the container's log. A line never holds a call's input or answer, a token, a session's
// id or anything from a design: a call is told by its tool, its milliseconds, whether it was refused and the start of
// the refusal's sentence with each quoted value left out; an MCP session by a hash of its id.
import { createHash } from 'node:crypto'

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/**
 * Why an MCP session ended: idle past its time, deleted by its client, the access's oldest past its limit, or the
 * server stopping.
 */
export type SessionEnd = 'idle' | 'client' | 'replaced' | 'stopped'

/** The lines the endpoint logs. */
export interface McpLog {
  /** A tool call: the tool, the milliseconds it took and its result. */
  call(tool: string, ms: number, result: CallToolResult): void
  opened(sessionId: string): void
  ended(sessionId: string, why: SessionEnd): void
}

/** The characters of a refusal's sentence a line keeps. */
export const REFUSAL_CHARS = 200

/** The log, writing each line to `write`. */
export function mcpLog(write: (line: string) => void): McpLog {
  return {
    call: (tool, ms, result) =>
      write(
        JSON.stringify({
          event: 'tool call',
          tool,
          ms: Math.round(ms),
          refused: result.isError === true,
          ...(result.isError === true ? { refusal: refusalStart(result) } : {}),
        }),
      ),
    opened: (sessionId) => write(JSON.stringify({ event: 'mcp session opened', session: sessionName(sessionId) })),
    ended: (sessionId, why) =>
      write(JSON.stringify({ event: 'mcp session ended', session: sessionName(sessionId), why })),
  }
}

/**
 * The first `REFUSAL_CHARS` characters of a refusal's sentence, each value it quotes in “…” or "…" left out: a quoted
 * value is something the agent gave or a design holds.
 */
function refusalStart(result: CallToolResult): string {
  const block = result.content.find(({ type }) => type === 'text')
  const sentence = block?.type === 'text' ? block.text : ''
  const unquoted = sentence.replace(/“[^”]*”/g, '“…”').replace(/"[^"]*"/g, '"…"')
  return [...unquoted].slice(0, REFUSAL_CHARS).join('')
}

/** What names an MCP session in the log: the start of its id's SHA-256, so its lines pair up without the id. */
function sessionName(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 12)
}
