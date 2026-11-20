// What the MCP server holds each agent to, so that one busy agent can't slow the one server.

/** The largest request body taken: a bigger one is refused (413) before any of it is parsed. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024

/** The largest answer sent: the usual MCP client reads at most 10 MiB, and the rest is room for the JSON-RPC envelope. */
export const MAX_ANSWER_BYTES = 8 * 1024 * 1024

/** Room kept in an answer for what wraps a tool's text: its content block, `isError` and the JSON-RPC envelope. */
export const ANSWER_ENVELOPE_BYTES = 2 * 1024

/** How long a session lasts without a call. */
export const SESSION_IDLE_MS = 30 * 60 * 1000

/** The most sessions an agent access holds at once; a new one ends the oldest. */
export const MAX_SESSIONS_PER_ACCESS = 4
