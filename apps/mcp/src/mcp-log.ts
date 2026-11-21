// The MCP server's log: one JSON line for each tool call and for each MCP session opened and ended, so what fails
// for agents can be read from the container's log. A line never holds a call's input or answer, a token, an MCP
// session's id or anything from a design: a call is told by its tool, its milliseconds, whether it was refused and the
// start of the refusal's sentence with what it quotes left out; an MCP session by a hash of its id.
import { createHash } from 'node:crypto'

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/**
 * Why an MCP session ended: idle past its time, deleted by its client, the access's oldest past its limit, or the
 * server stopping.
 */
export type McpSessionEnd = 'idle' | 'client' | 'replaced' | 'stopped'

/** The lines the endpoint logs. */
export interface McpLog {
  /** Runs a tool call, logging its tool, the milliseconds it took and whether it was refused; gives its result. */
  call(tool: string, run: () => Promise<CallToolResult>): Promise<CallToolResult>
  /** An MCP session the endpoint keeps, by its id. */
  opened(sessionId: string): void
  /** An MCP session the endpoint ended, by its id, and why. */
  ended(sessionId: string, why: McpSessionEnd): void
}

/** The characters of a refusal's sentence a line keeps. */
export const REFUSAL_CHARS = 200

/**
 * What a refusal quotes, each from its first opening mark to its last closing one, so a mark inside a quoted value
 * can't let the rest of it through.
 */
const QUOTED: [RegExp, string][] = [
  [/“[^]*”/g, '“…”'],
  [/"[^]*"/g, '"…"'],
  [/`[^]*`/g, '`…`'],
]

/** The log, writing each line to `write` and timing calls by `now`, in milliseconds. */
export function mcpLog(write: (line: string) => void, now: () => number): McpLog {
  return {
    async call(tool, run) {
      const startedAt = now()
      const result = await run()
      const refused = result.isError === true
      const refusal = refused ? { refusal: refusalStart(result) } : {}
      write(JSON.stringify({ event: 'tool call', tool, ms: Math.round(now() - startedAt), refused, ...refusal }))
      return result
    },
    opened: (sessionId) => write(JSON.stringify({ event: 'mcp session opened', session: mcpSessionName(sessionId) })),
    ended: (sessionId, why) =>
      write(JSON.stringify({ event: 'mcp session ended', session: mcpSessionName(sessionId), why })),
  }
}

/**
 * The first `REFUSAL_CHARS` characters of a refusal's sentence, with what it quotes in “…”, "…" or `…` left out: a
 * quoted value is something the agent gave or a design holds.
 */
function refusalStart(result: CallToolResult): string {
  const block = result.content.find(({ type }) => type === 'text')
  const sentence = block?.type === 'text' ? block.text : ''
  const unquoted = QUOTED.reduce((text, [quoted, mark]) => text.replace(quoted, mark), sentence)
  return [...unquoted].slice(0, REFUSAL_CHARS).join('')
}

/** What names an MCP session in the log: the start of its id's SHA-256, so its lines pair up without the id. */
function mcpSessionName(sessionId: string): string {
  return createHash('sha256').update(sessionId).digest('hex').slice(0, 12)
}
