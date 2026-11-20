// The name an agent is shown by in a design: the name its MCP client gives in `initialize`, marked as an agent's.

/** What an MCP client says of itself in `initialize` (`clientInfo`). */
export interface ClientInfo {
  name?: string | undefined
  title?: string | undefined
}

/** The name of an agent that gives none. */
export const NO_AGENT_NAME = 'AI agent'

/** The most characters of the client's own name kept, so that with the suffix the name is at most 64. */
const MAX_CLIENT_NAME = 56

/**
 * The client's title, else its name, with control and format characters taken out, trimmed and cut to 56
 * characters, then " (agent)"; "AI agent" when that leaves nothing.
 */
export function agentName(client: ClientInfo | undefined): string {
  const given = [client?.title, client?.name].map(clean).find((name) => name !== '') ?? ''
  if (given === '') return NO_AGENT_NAME
  return `${Array.from(given).slice(0, MAX_CLIENT_NAME).join('').trimEnd()} (agent)`
}

/** `name` without control and format characters, trimmed; empty when it is not a string. */
function clean(name: unknown): string {
  return typeof name === 'string' ? name.replace(/[\p{Cc}\p{Cf}]/gu, '').trim() : ''
}
